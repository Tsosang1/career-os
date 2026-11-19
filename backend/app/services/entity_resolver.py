from typing import Optional
from rapidfuzz import fuzz, process

def resolve_application_id(
    company_name: Optional[str],
    thread_id: str,
    existing_apps: list[dict],
    existing_events: list[dict],
) -> Optional[str]:
    # 1. Exact Gmail thread match first
    for ev in existing_events:
        if ev.get("gmail_thread_id") == thread_id and ev.get("application_id"):
            return ev["application_id"]

    if not company_name or not existing_apps:
        return None

    # 2. Fuzzy company name match against active applications
    choices = {app["id"]: app["company_name"] for app in existing_apps}
    match = process.extractOne(
        company_name,
        choices,
        scorer=fuzz.WRatio,
        score_cutoff=78,
    )
    if match:
        # match tuple is (matched_string, score, dict_key)
        return match[2]

    return None
