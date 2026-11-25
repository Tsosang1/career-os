from typing import Optional

def resolve_application_id(
    company_name: Optional[str],
    thread_id: str,
    existing_apps: list[dict],
    existing_events: list[dict],
) -> Optional[str]:
    # 1. Exact Gmail thread match
    if thread_id:
        for ev in existing_events:
            if ev.get("gmail_thread_id") == thread_id and ev.get("application_id"):
                return ev["application_id"]

    # 2. Normalized company name match (prefer active cards over already-closed ones)
    if company_name:
        target = company_name.strip().lower()
        active_matches = [
            a for a in existing_apps
            if a.get("company_name") and target in a["company_name"].strip().lower() and a.get("status") != "CLOSED"
        ]
        if active_matches:
            return active_matches[0]["id"]

        all_matches = [
            a for a in existing_apps
            if a.get("company_name") and target in a["company_name"].strip().lower()
        ]
        if all_matches:
            return all_matches[0]["id"]

    return None
