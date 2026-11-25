import asyncio
import base64
import html as html_lib
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import unquote
import httpx
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from supabase import create_client

from app.config import settings
from app.services.gemini_parser import classify_email_batch
from app.services.entity_resolver import resolve_application_id

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

STAGE_RANK = {
    "RADAR": 0,
    "APPLIED": 1,
    "ASSESSMENT": 2,
    "INTERVIEW": 3,
    "OFFER": 4,
    "CLOSED": 5,
}

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
    'from:jobalerts-noreply@linkedin.com '
    'OR from:alert@indeed.com '
    'OR from:alerts@pnet.co.za '
    'OR subject:("job match for you" OR "New jobs posted from careers." OR "jobs in" OR "job alert" OR "new jobs matching")'
    ')'
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

def _normalize_lead_key(company: str, role: str) -> tuple[str, str]:
    c = re.sub(r"\b(limited|ltd|pty|south africa)\b", "", company.lower())
    c = re.sub(r"[^a-z0-9]", "", c)
    r = re.sub(r"[^a-z0-9]", "", role.lower())
    return (c, r)

def _extract_html_body(payload: dict) -> str:
    if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data"):
        return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="ignore")
    for part in payload.get("parts", []) or []:
        found = _extract_html_body(part)
        if found:
            return found
    return ""

def _extract_job_url(payload: dict, msg_id: str) -> str:
    """Finds the direct job listing URL inside the email body, or falls back to the Gmail message."""
    raw_html = _extract_html_body(payload)

    linkedin_match = re.search(r"https://www\.linkedin\.com/comm/jobs/view/\d+[^\s\"'<>]*", raw_html)
    if linkedin_match:
        return linkedin_match.group(0).replace("&amp;", "&")

    return f"https://mail.google.com/mail/u/0/#all/{msg_id}"

def _parse_alert_items(msg: dict) -> list[dict]:
    """
    Returns 1 item for single-job alerts, or N items for multi-job digests,
    with ZERO hardcoded role blocklists.
    """
    msg_id = msg["id"]
    payload = msg.get("payload", {})
    headers = {h["name"]: h["value"] for h in payload.get("headers", [])}
    subject = headers.get("Subject", "").strip()
    sender = headers.get("From", "")
    raw_date = headers.get("Date", "")

    received_iso = datetime.now(timezone.utc).isoformat()
    if raw_date:
        try:
            received_iso = parsedate_to_datetime(raw_date).isoformat()
        except Exception:
            pass

    source_label = (
        "LinkedIn Alert" if "linkedin" in sender.lower()
        else "Indeed Alert" if "indeed" in sender.lower()
        else "PNet Alert" if "pnet" in sender.lower()
        else "Email Alert"
    )
    fallback_url = f"https://mail.google.com/mail/u/0/#all/{msg_id}"

    # 1. Single-role subject patterns (e.g. "Java Developer (Junior) at Discovery Limited")
    at_match = re.match(
        r"^(?:You may be a fit for\s+)?(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+South Africa.*)?$",
        subject,
        re.IGNORECASE,
    )
    if at_match:
        return [{
            "lead_key_id": msg_id,
            "company_name": at_match.group(2).split(" - ")[0].strip(" '\"")[0:80],
            "role_title": at_match.group(1).strip(" '\"")[0:100],
            "location_mode": "South Africa",
            "source": source_label,
            "portal_url": _extract_job_url(payload, msg_id) or fallback_url,
            "received_at": received_iso,
        }]

    if "vodafone job match" in subject.lower():
        return [{
            "lead_key_id": msg_id,
            "company_name": "Vodacom / Vodafone",
            "role_title": "Graduate / Early Careers Match",
            "location_mode": "South Africa",
            "source": source_label,
            "portal_url": _extract_job_url(payload, msg_id) or fallback_url,
            "received_at": received_iso,
        }]

    # 2. Multi-job digest extraction (e.g. Indeed / LinkedIn multi-posting HTML emails)
    html_body = _extract_html_body(payload)
    if not html_body:
        return []

    # Match <a href="URL">Role Title</a> followed closely by Company text
    anchor_matches = re.findall(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        html_body,
        flags=re.IGNORECASE | re.DOTALL,
    )

    NAV_NOISE = re.compile(
        r"^(sign in|unsubscribe|view all( results)?|see more|see all jobs|manage (job )?alerts|edit alerts|"
        r"privacy( policy)?|help( center)?|click here|logo|apply now|read more|view job|try premium.*|learn why.*|"
        r"upload cv|run search|jobs|job placements|your job alert.*|change the job agent frequency.*|careers\..*)$",
        re.IGNORECASE,
    )

    extracted = []
    for href, inner_html in anchor_matches:
        clean_title = re.sub(r"<[^>]+>", " ", inner_html)
        clean_title = html_lib.unescape(re.sub(r"\s+", " ", clean_title)).strip()
        clean_title = clean_title.replace("â€“", "–").replace("â€™", "’")
        if len(clean_title) < 4 or len(clean_title) > 95 or NAV_NOISE.match(clean_title):
            continue
        if not any(d in href.lower() for d in ("indeed.com", "linkedin.com/comm/jobs", "pnet.co.za", "careers", "job")):
            continue

        # Grab the text immediately following the closing </a> tag to infer the company name
        after_idx = html_body.find(inner_html)
        company_guess = source_label.replace(" Alert", "")
        if after_idx != -1:
            snippet_after = re.sub(r"<[^>]+>", "\n", html_body[after_idx + len(inner_html) : after_idx + len(inner_html) + 350])
            lines = [html_lib.unescape(line).strip() for line in snippet_after.splitlines() if line.strip()]
            if lines and 2 <= len(lines[0]) <= 70:
                company_guess = lines[0].replace("â€“", "–").replace("â€™", "’")

        extracted.append({
            "lead_key_id": f"{msg_id}:{len(extracted)}",
            "company_name": company_guess[:80],
            "role_title": clean_title[:100],
            "location_mode": "South Africa",
            "source": source_label,
            "portal_url": html_lib.unescape(unquote(href)) if href.startswith("http") else fallback_url,
            "received_at": received_iso,
        })
        if len(extracted) >= 12:
            break

    return extracted

def _sync_and_fetch_leads(token: str, user_id: str, max_leads: int = 20) -> list[dict]:
    existing_res = (
        supabase.table("job_leads")
        .select("gmail_message_id, company_name, role_title")
        .eq("user_id", user_id)
        .execute()
    )
    existing_rows = existing_res.data or []
    known_msg_prefixes = {r["gmail_message_id"].split(":")[0] for r in existing_rows if r.get("gmail_message_id")}
    known_pairs = {
        _normalize_lead_key(r["company_name"], r["role_title"])
        for r in existing_rows
        if r.get("company_name") and r.get("role_title")
    }

    raw_msgs = asyncio.run(
        _gmail_list_and_fetch(
            token,
            JOB_LEADS_QUERY,
            max_results=max_leads,
            skip_ids=known_msg_prefixes,
            fmt="full",
        )
    )

    for msg in raw_msgs:
        for item in _parse_alert_items(msg):
            pair = _normalize_lead_key(item["company_name"], item["role_title"])
            if pair in known_pairs:
                continue
            known_pairs.add(pair)

            supabase.table("job_leads").upsert(
                {
                    "user_id": user_id,
                    "gmail_message_id": item["lead_key_id"],
                    "company_name": item["company_name"],
                    "role_title": item["role_title"],
                    "location_mode": item["location_mode"],
                    "source": item["source"],
                    "portal_url": item["portal_url"],
                    "received_at": item["received_at"],
                },
                on_conflict="user_id,gmail_message_id",
                ignore_duplicates=True,
            ).execute()

    res = (
        supabase.table("job_leads")
        .select("id, gmail_message_id, company_name, role_title, location_mode, source, portal_url, received_at")
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

            email_link = f"https://mail.google.com/mail/u/0/#all/{item['msg_id']}"

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
                            "portal_url": email_link,
                            "applied_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    .execute()
                )
                if new_app.data:
                    app_id = new_app.data[0]["id"]
                    existing_apps.append(new_app.data[0])

            is_verified = bool(
                app_id and (
                    parsed.confidence_score >= 0.85
                    or (parsed.detected_status == "CLOSED" and parsed.confidence_score >= 0.75)
                )
            )

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
                current_status = next(
                    (a["status"] for a in existing_apps if a["id"] == app_id),
                    "RADAR",
                )
                if STAGE_RANK.get(parsed.detected_status, 0) >= STAGE_RANK.get(current_status, 0):
                    supabase.table("applications").update(
                        {"status": parsed.detected_status, "portal_url": email_link}
                    ).eq("id", app_id).execute()
                    for a in existing_apps:
                        if a["id"] == app_id:
                            a["status"] = parsed.detected_status
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
