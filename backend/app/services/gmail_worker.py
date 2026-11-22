import os
import re
from datetime import datetime, timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from supabase import create_client

from app.config import settings
from app.services.gemini_parser import classify_email_batch
from app.services.entity_resolver import resolve_application_id

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
        else:
            if not os.path.exists("credentials.json"):
                raise FileNotFoundError(
                    "Place Google Cloud OAuth credentials.json inside backend/ first."
                )
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=0)
        with open("token.json", "w") as token:
            token.write(creds.to_json())
    return build("gmail", "v1", credentials=creds)

def _extract_leads(service, max_leads: int = 12) -> list[dict]:
    """Extracts clean role + company pairs from curated LinkedIn / company alert subjects."""
    msg_list = (
        service.users()
        .messages()
        .list(userId="me", q=JOB_LEADS_QUERY, maxResults=max_leads)
        .execute()
    ).get("messages", [])

    leads = []
    seen_titles = set()

    for item in msg_list:
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=item["id"], format="metadata", metadataHeaders=["From", "Subject"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        subject = headers.get("Subject", "").strip()
        sender = headers.get("From", "")

        # Parse patterns like: "Internship: Network Engineer at Council for Scientific and Industrial Research (CSIR)"
        at_match = re.match(r"^(?:You may be a fit for\s+)?(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+South Africa.*)?$", subject, re.IGNORECASE)
        if at_match:
            role_title = at_match.group(1).strip(" '\"")
            company_name = at_match.group(2).split(" - ")[0].strip(" '\"")
        elif "Vodafone job match" in subject:
            company_name = "Vodacom / Vodafone"
            role_title = "Graduate / Early Careers Match"
        else:
            continue

        dedup_key = f"{company_name.lower()}::{role_title.lower()}"
        if dedup_key in seen_titles:
            continue
        seen_titles.add(dedup_key)

        leads.append(
            {
                "id": item["id"],
                "company_name": company_name[:80],
                "role_title": role_title[:100],
                "location_mode": "South Africa",
                "source": "LinkedIn Alert" if "linkedin" in sender.lower() else "Email Alert",
                "subject": subject,
            }
        )

    return leads

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

    msg_list = (
        service.users()
        .messages()
        .list(userId="me", q=ATS_LIFECYCLE_QUERY, maxResults=max_results)
        .execute()
    ).get("messages", [])

    unseen_emails = []
    for item in msg_list:
        msg_id = item["id"]
        if msg_id in seen_ids:
            continue

        msg = (
            service.users()
            .messages()
            .get(userId="me", id=msg_id, format="metadata", metadataHeaders=["From", "Subject"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        unseen_emails.append(
            {
                "index": len(unseen_emails),
                "msg_id": msg_id,
                "thread_id": msg.get("threadId", ""),
                "sender": headers.get("From", ""),
                "subject": headers.get("Subject", ""),
                "snippet": msg.get("snippet", ""),
            }
        )

    matched = 0
    staged = 0

    if unseen_emails:
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

    leads = _extract_leads(service)

    return {
        "scanned": len(unseen_emails),
        "matched": matched,
        "staged_for_review": staged,
        "leads": leads,
    }
