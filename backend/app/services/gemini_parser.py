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

GROQ_MODELS = ["openai/gpt-oss-20b", "qwen/qwen3-32b"]

NOISE_PATTERNS = re.compile(
    r"(new jobs matching|job alert|jobs you might be interested in|recommended jobs|top jobs for you|digest|reddit)",
    re.IGNORECASE,
)

BATCH_SYSTEM_PROMPT = """
You are an ATS (Applicant Tracking System) email parser for a South African software engineering graduate job seeker.
You will receive a JSON list of emails, each with "index", "sender", "subject", and "snippet".
Return ONLY a valid JSON object with a single key "results" containing an array of objects matching each "index":
{
  "results": [
    {
      "index": 0,
      "is_job_related": true,
      "company_name": "Capitec",
      "role_title": "Graduate / Early Careers",
      "detected_status": "APPLIED",
      "confidence_score": 0.95,
      "summary": "Application confirmation from Capitec Careers."
    }
  ]
}

Rules:
1. Ignore newsletters, Reddit/Medium digests, university admin emails, and job alerts -> is_job_related = false.
2. Only mark is_job_related = true for actual job application lifecycle updates:
   - Receipt / thank you for applying / thank you for your interest -> "APPLIED"
   - Online assessment, Sova, coding test, HackerRank, Codility -> "ASSESSMENT"
   - Interview invitation, phone screen, technical loop -> "INTERVIEW"
   - Job offer -> "OFFER"
   - Unsuccessful / regret / application update rejecting candidate -> "CLOSED"
3. Normalize company names cleanly (e.g., 'Capitec Careers' -> 'Capitec', 'Vodacom Early Career' -> 'Vodacom').
4. Set confidence_score >= 0.88 when company_name and stage are clear.
"""

def classify_email_batch(emails: list[dict]) -> dict[int, ParsedAtsEmail]:
    results: dict[int, ParsedAtsEmail] = {}
    to_classify = []

    for item in emails:
        text = f"{item['sender']} {item['subject']} {item['snippet']}"
        if NOISE_PATTERNS.search(text):
            results[item["index"]] = ParsedAtsEmail(is_job_related=False)
        else:
            to_classify.append(item)

    if not to_classify:
        return results

    print(f"[Parser] Batch-classifying {len(to_classify)} emails...", flush=True)
    user_payload = json.dumps(to_classify, ensure_ascii=False)

    if groq_client:
        for model_name in GROQ_MODELS:
            try:
                completion = groq_client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": BATCH_SYSTEM_PROMPT},
                        {"role": "user", "content": user_payload},
                    ],
                    response_format={"type": "json_object"},
                )
                raw = completion.choices[0].message.content or "{}"
                parsed_json = json.loads(raw)
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

    try:
        response = gemini_client.models.generate_content(
            model="gemini-3.8-flash-lite",
            contents=user_payload,
            config=types.GenerateContentConfig(
                system_instruction=BATCH_SYSTEM_PROMPT,
                response_mime_type="application/json",
                temperature=0.1,
            ),
        )
        parsed_json = json.loads(response.text or "{}")
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
    except Exception as exc:
        print(f"[Parser] Gemini fallback failed: {exc}", flush=True)

    return results

def classify_ats_email(sender: str, subject: str, snippet: str) -> ParsedAtsEmail:
    batch = classify_email_batch([
        {"index": 0, "sender": sender, "subject": subject, "snippet": snippet}
    ])
    return batch.get(0, ParsedAtsEmail(is_job_related=False))
