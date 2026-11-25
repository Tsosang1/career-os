import asyncio
import base64
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import httpx
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from supabase import create_client

from app.config import settings
from app.services.gemini_parser import classify_email_batch
from app.services.entity_resolver import resolve_application_id

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

ATS_LIFECYCLE_QUERY = (
    'newer_than:90d ('
    '"thank you for applying" OR "application received" OR "received your application" '
    'OR "has been sent" OR "application has been sent" '
    'OR "your application to" OR "your application for" OR "application status" '
    'OR "thank you for your interest" OR "sova" OR "online assessment" '
    'OR "interview invitation" OR "unfortunately" OR "regret to inform" '
    'OR "isn\'t progressing" OR "not progressing" OR "not to take your application" '
    'OR from:(workday OR successfactors OR oraclecloud OR greenhouse OR lever OR smartrecruiters OR icims OR myworkdayjobs)'
    ') '
    '-from:(indeed.com OR jobalerts-noreply@linkedin.com OR jobleads.com OR jobtome.com OR redditmail.com OR medium.com OR github.com) '
    '-subject:("job alert" OR "job match" OR "new jobs" OR "is hiring" OR "may be a fit" OR "vacancies")'
)

JOB_LEADS_QUERY = (
    'newer_than:14d ('
    'from:jobalerts-noreply@linkedin.com OR subject:("job match for you" OR "New jobs posted from careers.")'
    ') -subject:("Shop Assistant" OR "Cashier" OR "Store Associate")'
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

def _get_access_token() -> str:
    if not os.path.exists("token.json"):
        raise RuntimeError("token.json missing in backend/.")
    creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open("token.json", "w") as f:
                f.write(creds.to_json())
        else:
            raise RuntimeError("Gmail token expired; re-authorize.")
    return creds.token

async def _gmail_list_and_fetch(
    token: str,
    query: str,
    max_results: int,
    skip_ids: set[str],
    fmt: str = "metadata",
) -> list[dict]:
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        list_resp = await client.get(
            f"{GMAIL_API}/messages",
            headers=headers,
            params={"q": query, "maxResults": max_results},
        )
        list_resp.raise_for_status()
        msg_ids = [
            m["id"] for m in list_resp.json().get("messages", []) if m["id"] not in skip_ids
        ]
        if not msg_ids:
            return []

        params = (
            [("format", "metadata"), ("metadataHeaders", "From"), ("metadataHeaders", "Subject")]
            if fmt == "metadata"
            else [("format", fmt)]
        )
        tasks = [
            client.get(f"{GMAIL_API}/messages/{mid}", headers=headers, params=params)
            for mid in msg_ids
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

    return [
        r.json() for r in responses if isinstance(r, httpx.Response) and r.status_code == 200
    ]

def _extract_job_url(payload: dict, msg_id: str) -> str:
    """Finds the direct job listing URL inside the email body, or falls back to the Gmail message."""
    raw_html = ""
    parts = payload.get("parts") or [payload]
    for part in parts:
        data = part.get("body", {}).get("data")
        if data:
            try:
                raw_html += base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
            except Exception:
                pass

    linkedin_match = re.search(r"https://www\.linkedin\.com/comm/jobs/view/\d+[^\s\"'<>]*", raw_html)
    if linkedin_match:
        return linkedin_match.group(0).replace("&amp;", "&")

    return f"https://mail.google.com/mail/u/0/#all/{msg_id}"

def _sync_and_fetch_leads(token: str, user_id: str, max_leads: int = 15) -> list[dict]:
    msgs = asyncio.run(
        _gmail_list_and_fetch(token, JOB_LEADS_QUERY, max_leads, set(), fmt="full")
    )

    for msg in msgs:
        payload = msg.get("payload", {})
        headers = {h["name"]: h["value"] for h in payload.get("headers", [])}
        subject = headers.get("Subject", "").strip()
        sender = headers.get("From", "")
        raw_date = headers.get("Date", "")

        received_iso = None
        if raw_date:
            try:
                received_iso = parsedate_to_datetime(raw_date).isoformat()
            except Exception:
                received_iso = None

        at_match = re.match(
            r"^(?:You may be a fit for\s+)?(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+South Africa.*)?$",
            subject,
            re.IGNORECASE,
        )
        if at_match:
            role_title = at_match.group(1).strip(" '\"")
            company_name = at_match.group(2).split(" - ")[0].strip(" '\"")
        elif "Vodafone job match" in subject:
            company_name = "Vodacom / Vodafone"
            role_title = "Graduate / Early Careers Match"
        else:
            continue

        supabase.table("job_leads").upsert(
            {
                "user_id": user_id,
                "gmail_message_id": msg["id"],
                "company_name": company_name[:80],
                "role_title": role_title[:100],
                "location_mode": "South Africa",
                "source": "LinkedIn Alert" if "linkedin" in sender.lower() else "Email Alert",
                "portal_url": _extract_job_url(payload, msg["id"]),
                "received_at": received_iso or datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="user_id,gmail_message_id",
            ignore_duplicates=True,
        ).execute()

    res = (
        supabase.table("job_leads")
        .select("id, company_name, role_title, location_mode, source, portal_url, received_at")
        .eq("user_id", user_id)
        .eq("status", "NEW")
        .order("received_at", desc=True)
        .execute()
    )
    return res.data or []

def run_gmail_sync(user_id: str, max_results: int = 40) -> dict:
    token = _get_access_token()

    events_res = (
        supabase.table("application_events")
        .select("gmail_message_id, gmail_thread_id, application_id")
        .eq("user_id", user_id)
        .execute()
    )
    existing_events = events_res.data or []
    seen_ids = {e["gmail_message_id"] for e in existing_events if e.get("gmail_message_id")}

    apps_res = (
        supabase.table("applications")
        .select("id, company_name, role_title, status")
        .eq("user_id", user_id)
        .execute()
    )
    existing_apps = apps_res.data or []

    print("[Sync 1/4] Querying & batch-fetching Gmail ATS messages via httpx...", flush=True)
    fetched_msgs = asyncio.run(
        _gmail_list_and_fetch(
            token,
            ATS_LIFECYCLE_QUERY,
            max(max_results, 60),
            seen_ids,
            fmt="metadata",
        )
    )
    print(f"[Sync 2/4] Fetched {len(fetched_msgs)} unseen messages.", flush=True)

    unseen_emails = []
    for msg in fetched_msgs:
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        unseen_emails.append(
            {
                "index": len(unseen_emails),
                "msg_id": msg["id"],
                "thread_id": msg.get("threadId", ""),
                "sender": headers.get("From", ""),
                "subject": headers.get("Subject", ""),
                "snippet": msg.get("snippet", ""),
            }
        )

    matched = 0
    staged = 0

    if unseen_emails:
        print(f"[Sync 3/4] Running batch LLM classifier on {len(unseen_emails)} messages...", flush=True)
        batch_input = [
            {
                "index": e["index"],
                "sender": e["sender"],
                "subject": e["subject"],
                "snippet": e["snippet"],
            }
            for e in unseen_emails
        ]
        classifications = classify_email_batch(batch_input)

        for item in unseen_emails:
            parsed = classifications.get(item["index"])
            if not parsed or not parsed.is_job_related or not parsed.detected_status:
                continue

            app_id = resolve_application_id(
                parsed.company_name, item["thread_id"], existing_apps, existing_events
            )

            if not app_id and parsed.company_name and parsed.confidence_score >= 0.85:
                new_app = (
                    supabase.table("applications")
                    .insert(
                        {
                            "user_id": user_id,
                            "company_name": parsed.company_name,
                            "role_title": parsed.role_title or "Graduate / Software Role",
                            "status": parsed.detected_status,
                            "source": "Gmail Sync",
                            "applied_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    .execute()
                )
                if new_app.data:
                    app_id = new_app.data[0]["id"]
                    existing_apps.append(new_app.data[0])

            is_verified = bool(app_id and parsed.confidence_score >= 0.85)

            supabase.table("application_events").insert(
                {
                    "user_id": user_id,
                    "application_id": app_id,
                    "gmail_message_id": item["msg_id"],
                    "gmail_thread_id": item["thread_id"],
                    "detected_status": parsed.detected_status,
                    "raw_subject": item["subject"],
                    "raw_snippet": item["snippet"],
                    "confidence_score": parsed.confidence_score,
                    "is_verified": is_verified,
                }
            ).execute()

            if is_verified and app_id:
                supabase.table("applications").update(
                    {"status": parsed.detected_status}
                ).eq("id", app_id).execute()
                matched += 1
            else:
                staged += 1

    print("[Sync 4/4] Syncing job alert leads...", flush=True)
    try:
        leads = _sync_and_fetch_leads(token, user_id)
    except Exception as exc:
        print(f"[Sync 4/4 Error] {exc}", flush=True)
        leads = []

    return {
        "scanned": len(unseen_emails),
        "matched": matched,
        "staged_for_review": staged,
        "leads": leads,
    }
