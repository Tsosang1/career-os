import json
import re
from openai import OpenAI
from google import genai
from google.genai import types
from app.config import settings
from app.schemas import ParsedAtsEmail

groq_client = (
    OpenAI(
        api_key=settings.groq_api_key,
        base_url="https://api.groq.com/openai/v1",
        timeout=12.0,
        max_retries=0,
    )
    if settings.groq_api_key
    else None
)
gemini_client = genai.Client(api_key=settings.gemini_api_key)

NOISE_PATTERNS = re.compile(
    r"(new jobs matching|job alert|jobs you might be interested in|recommended jobs|top jobs for you|digest|reddit)",
    re.IGNORECASE,
)

REJECTION_PATTERNS = re.compile(
    r"(regret to inform|unable to offer you employment|unsuccessful|not been selected|not moving forward|position has been filled)",
    re.IGNORECASE,
)

BATCH_SYSTEM_PROMPT = """
You are an ATS email parser for a South African software engineering graduate job seeker.
You will receive a JSON array of emails with "index", "sender", "subject", and "snippet".
Return ONLY raw JSON (no markdown fences, no commentary) formatted as:
{"results": [{"index": 0, "is_job_related": true, "company_name": "Thoughtware", "role_title": "Junior Developer", "detected_status": "CLOSED", "confidence_score": 0.96, "summary": "Rejection notice from Thoughtware."}]}

Rules:
1. Ignore newsletters, digests, university admin emails, and job alerts -> is_job_related = false.
2. Valid detected_status values:
   - "APPLIED": application received / thank you for applying / thank you for your interest
   - "ASSESSMENT": online assessment, Sova, coding test, HackerRank, Codility
   - "INTERVIEW": interview invite, phone screen, technical loop
   - "OFFER": job offer
   - "CLOSED": regret to inform, unable to offer employment, unsuccessful
3. Normalize company names cleanly (e.g., 'Thoughtware <recruitment@thoughtware.co.za>' -> 'Thoughtware', 'Capitec Careers' -> 'Capitec').
"""

def _extract_company_from_sender(sender: str) -> str:
    display = sender.split("<")[0].strip(" '\"")
    if display:
        return re.sub(r"\b(careers|recruitment|talent|hr|jobs|team)\b", "", display, flags=re.IGNORECASE).strip() or display
    domain_match = re.search(r"@([a-zA-Z0-9-]+)\.", sender)
    return domain_match.group(1).capitalize() if domain_match else "Unknown Company"

def _extract_role_from_subject(subject: str) -> str:
    cleaned = re.sub(r"^(application update|your application|re:|fwd:)\s*[-–:]\s*", "", subject, flags=re.IGNORECASE).strip()
    return cleaned[:90] if cleaned else "Graduate / Software Role"

def _parse_json_object(raw_text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text.strip())
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1:
        cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)

def classify_email_batch(emails: list[dict]) -> dict[int, ParsedAtsEmail]:
    results: dict[int, ParsedAtsEmail] = {}
    to_classify = []

    for item in emails:
        text = f"{item['sender']} {item['subject']} {item['snippet']}"
        if NOISE_PATTERNS.search(text):
            results[item["index"]] = ParsedAtsEmail(is_job_related=False)
        elif REJECTION_PATTERNS.search(text):
            company = _extract_company_from_sender(item["sender"])
            role = _extract_role_from_subject(item["subject"])
            results[item["index"]] = ParsedAtsEmail(
                is_job_related=True,
                company_name=company,
                role_title=role,
                detected_status="CLOSED",
                confidence_score=0.96,
                summary=f"Application update ({role}) from {company}.",
            )
        else:
            to_classify.append(item)

    if not to_classify:
        return results

    print(f"[Parser] Batch-classifying {len(to_classify)} remaining emails...", flush=True)
    user_payload = json.dumps(to_classify, ensure_ascii=False)

    # 1. Try active Groq models without strict json_object schema validation
    if groq_client:
        try:
            active_models = [
                m.id for m in groq_client.models.list().data
                if "whisper" not in m.id and "guard" not in m.id and "tts" not in m.id
            ]
        except Exception:
            active_models = ["openai/gpt-oss-20b"]

        for model_name in active_models[:2]:
            try:
                completion = groq_client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": BATCH_SYSTEM_PROMPT},
                        {"role": "user", "content": user_payload},
                    ],
                )
                raw = completion.choices[0].message.content or "{}"
                parsed_json = _parse_json_object(raw)
                for row in parsed_json.get("results", []):
                    idx = int(row["index"])
                    results[idx] = ParsedAtsEmail(
                        is_job_related=bool(row.get("is_job_related", False)),
                        company_name=row.get("company_name"),
                        role_title=row.get("role_title"),
                        detected_status=row.get("detected_status"),
                        confidence_score=float(row.get("confidence_score", 0.0)),
                        summary=row.get("summary", ""),
                    )
                print(f"[Parser] Groq ({model_name}) succeeded!", flush=True)
                return results
            except Exception as exc:
                print(f"[Parser] Groq {model_name} failed: {exc}", flush=True)

    # 2. Valid Gemini 2.5 Flash fallback
    try:
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=user_payload,
            config=types.GenerateContentConfig(
                system_instruction=BATCH_SYSTEM_PROMPT,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        parsed_json = _parse_json_object(response.text or "{}")
        for row in parsed_json.get("results", []):
            idx = int(row["index"])
            results[idx] = ParsedAtsEmail(
                is_job_related=bool(row.get("is_job_related", False)),
                company_name=row.get("company_name"),
                role_title=row.get("role_title"),
                detected_status=row.get("detected_status"),
                confidence_score=float(row.get("confidence_score", 0.0)),
                summary=row.get("summary", ""),
            )
        print("[Parser] Gemini 2.5 Flash fallback succeeded!", flush=True)
    except Exception as exc:
        print(f"[Parser] Gemini fallback failed: {exc}", flush=True)

    return results

def classify_ats_email(sender: str, subject: str, snippet: str) -> ParsedAtsEmail:
    batch = classify_email_batch([
        {"index": 0, "sender": sender, "subject": subject, "snippet": snippet}
    ])
    return batch.get(0, ParsedAtsEmail(is_job_related=False))
