import os
import re
import socket
import base64
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from supabase import create_client

from app.config import settings
from app.services.gemini_parser import classify_email_batch
from app.services.entity_resolver import resolve_application_id

socket.setdefaulttimeout(15)  # Prevent googleapiclient / httplib2 from hanging forever

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# 1. Pure ATS lifecycle query — excludes all job-alert spam so real receipts & rejections always surface
ATS_LIFECYCLE_QUERY = (
    'newer_than:90d ('
    '"thank you for applying" OR "application received" OR "received your application" '
    'OR "your application to" OR "your application for" OR "application status" '
    'OR "thank you for your interest" OR "sova" OR "online assessment" '
    'OR "interview invitation" OR "unfortunately" OR "regret to inform" '
    'OR from:(workday OR successfactors OR oraclecloud OR greenhouse OR lever OR smartrecruiters OR icims)'
    ') '
    '-from:(indeed.com OR jobalerts-noreply@linkedin.com OR jobleads.com OR jobtome.com) '
    '-subject:("job alert" OR "job match" OR "new jobs" OR "is hiring" OR "may be a fit" OR "vacancies")'
)

# 2. Curated job-alert leads query (for the drag-to-Radar strip underneath the board)
JOB_LEADS_QUERY = (
    'newer_than:14d ('
    'from:jobalerts-noreply@linkedin.com OR subject:("job match for you" OR "New jobs posted from careers.")'
    ') -subject:("Shop Assistant" OR "Cashier" OR "Store Associate")'
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

def get_gmail_service():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            with open("token.json", "w") as token:
                token.write(creds.to_json())
        else:
            raise RuntimeError(
                "Gmail token.json is missing or expired. Re-authorize via CLI before syncing."
            )
    return build("gmail", "v1", credentials=creds)

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

    # Look for LinkedIn job view links or external career links
    linkedin_match = re.search(r"https://www\.linkedin\.com/comm/jobs/view/\d+[^\s\"'<>]*", raw_html)
    if linkedin_match:
        return linkedin_match.group(0).replace("&amp;", "&")

    return f"https://mail.google.com/mail/u/0/#all/{msg_id}"

def _sync_and_fetch_leads(service, user_id: str, max_leads: int = 15) -> list[dict]:
    msg_list = (
        service.users()
        .messages()
        .list(userId="me", q=JOB_LEADS_QUERY, maxResults=max_leads)
        .execute()
    ).get("messages", [])

    # Check known lead IDs in job_leads to skip redundant network calls
    existing_leads_res = (
        supabase.table("job_leads")
        .select("gmail_message_id")
        .eq("user_id", user_id)
        .execute()
    )
    known_lead_ids = {r["gmail_message_id"] for r in (existing_leads_res.data or []) if r.get("gmail_message_id")}
    new_items = [item for item in msg_list if item["id"] not in known_lead_ids]

    def _fetch_lead_detail(item):
        try:
            return service.users().messages().get(userId="me", id=item["id"], format="full").execute()
        except Exception as exc:
            print(f"[Lead Fetch Error] id {item['id']}: {exc}", flush=True)
            return None

    if new_items:
        with ThreadPoolExecutor(max_workers=8) as executor:
            fetched_msgs = list(executor.map(_fetch_lead_detail, new_items))

        for msg in fetched_msgs:
            if not msg:
                continue
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
        .order("received_at", ascending=False)
        .execute()
    )
    return res.data or []

def run_gmail_sync(user_id: str, max_results: int = 40) -> dict:
    service = get_gmail_service()

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

    print("[Sync 1/4] Querying Gmail ATS messages...", flush=True)
    msg_list = (
        service.users()
        .messages()
        .list(userId="me", q=ATS_LIFECYCLE_QUERY, maxResults=max_results)
        .execute()
    ).get("messages", [])

    candidate_items = [item for item in msg_list if item["id"] not in seen_ids]
    print(f"[Sync 2/4] Batch-fetching {len(candidate_items)} unseen messages...", flush=True)

    def _fetch_msg_metadata(item):
        msg_id = item["id"]
        try:
            msg = (
                service.users()
                .messages()
                .get(userId="me", id=msg_id, format="metadata", metadataHeaders=["From", "Subject"])
                .execute()
            )
            headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
            return {
                "msg_id": msg_id,
                "thread_id": msg.get("threadId", ""),
                "sender": headers.get("From", ""),
                "subject": headers.get("Subject", ""),
                "snippet": msg.get("snippet", ""),
            }
        except Exception as exc:
            print(f"[Msg Metadata Error] id {msg_id}: {exc}", flush=True)
            return None

    unseen_emails = []
    if candidate_items:
        with ThreadPoolExecutor(max_workers=8) as executor:
            fetched_metadata = list(executor.map(_fetch_msg_metadata, candidate_items))
        for m in fetched_metadata:
            if m:
                m["index"] = len(unseen_emails)
                unseen_emails.append(m)

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
    leads = _sync_and_fetch_leads(service, user_id)

    return {
        "scanned": len(unseen_emails),
        "matched": matched,
        "staged_for_review": staged,
        "leads": leads,
    }
