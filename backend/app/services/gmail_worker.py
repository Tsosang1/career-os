import os
from datetime import datetime, timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from supabase import create_client

from app.config import settings
from app.services.gemini_parser import classify_ats_email
from app.services.entity_resolver import resolve_application_id

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
ATS_QUERY = (
    'newer_than:30d ('
    '"thank you for applying" OR "application received" OR "application update" '
    'OR "interview" OR "assessment" OR "unfortunately" OR "regret to inform" '
    'OR from:(workday OR successfactors OR oraclecloud OR pnet OR greenhouse OR lever)'
    ')'
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

def run_gmail_sync(user_id: str, max_results: int = 25) -> dict:
    service = get_gmail_service()

    # Fetch existing events & apps for deduplication and fuzzy matching
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
        .list(userId="me", q=ATS_QUERY, maxResults=max_results)
        .execute()
    ).get("messages", [])

    scanned = 0
    matched = 0
    staged = 0

    for item in msg_list:
        msg_id = item["id"]
        if msg_id in seen_ids:
            continue

        scanned += 1
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=msg_id, format="metadata", metadataHeaders=["From", "Subject"])
            .execute()
        )
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        sender = headers.get("From", "")
        subject = headers.get("Subject", "")
        snippet = msg.get("snippet", "")
        thread_id = msg.get("threadId", "")

        parsed = classify_ats_email(sender, subject, snippet)
        if not parsed.is_job_related or not parsed.detected_status:
            continue

        app_id = resolve_application_id(
            parsed.company_name, thread_id, existing_apps, existing_events
        )

        # Auto-create card if high confidence new application email isn't on board yet
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
                "gmail_message_id": msg_id,
                "gmail_thread_id": thread_id,
                "detected_status": parsed.detected_status,
                "raw_subject": subject,
                "raw_snippet": snippet,
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

    return {"scanned": scanned, "matched": matched, "staged_for_review": staged}
