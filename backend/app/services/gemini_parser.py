import time
import json
from app.config import settings
from app.schemas import ParsedAtsEmail

# Use Groq's instant non-reasoning model first, fallback to Gemini
GROQ_MODELS = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"]
GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.8-flash-lite", "gemini-2.5-flash-lite"]

groq_client = None
if settings.groq_api_key:
    try:
        from groq import Groq
        groq_client = Groq(api_key=settings.groq_api_key)
    except Exception as exc:
        print(f"[Parser] Could not initialize Groq client: {exc}", flush=True)

gemini_client = None
if settings.gemini_api_key:
    try:
        from google import genai
        gemini_client = genai.Client(api_key=settings.gemini_api_key)
    except Exception as exc:
        print(f"[Parser] Could not initialize Gemini client: {exc}", flush=True)

SYSTEM_PROMPT = """
You are an ATS (Applicant Tracking System) email parser for a South African software engineering graduate job seeker.
Analyze the email sender, subject, and body snippet.
1. Ignore newsletters, job alerts ("New jobs matching your search"), marketing, and LinkedIn connection requests -> set is_job_related = false.
2. Only mark is_job_related = true for actual application lifecycle updates:
   - Application received / thank you for applying -> APPLIED
   - Online assessment, coding challenge, HackerRank, Codility, psychometric test -> ASSESSMENT
   - Interview invitation, phone screen, technical loop -> INTERVIEW
   - Job offer -> OFFER
   - Unsuccessful / regret / position filled -> CLOSED
3. Normalize company names cleanly (e.g., 'careers@bmw.co.za' or 'BMW Group' -> 'BMW').
4. Set confidence_score < 0.85 if the company name or stage is ambiguous.
Output strict JSON with fields: is_job_related (bool), company_name (str or null), role_title (str or null), detected_status (str or null: APPLIED|ASSESSMENT|INTERVIEW|OFFER|CLOSED), confidence_score (float 0.0-1.0), reason (str or null).
"""

def _classify_with_groq(prompt: str) -> ParsedAtsEmail | None:
    if not groq_client:
        return None
    for model_name in GROQ_MODELS:
        try:
            chat_completion = groq_client.chat.completions.create(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                model=model_name,
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            raw = chat_completion.choices[0].message.content
            data = json.loads(raw)
            parsed = ParsedAtsEmail(**data)
            print(f"  -> {model_name} (Groq): job={parsed.is_job_related} | {parsed.company_name} ({parsed.detected_status})", flush=True)
            return parsed
        except Exception as exc:
            print(f"  -> Groq {model_name} error: {exc}", flush=True)
            continue
    return None

def _classify_with_gemini(prompt: str) -> ParsedAtsEmail | None:
    if not gemini_client:
        return None
    from google.genai import types
    from google.genai.errors import APIError

    for model_name in GEMINI_MODELS:
        for attempt in range(2):
            try:
                response = gemini_client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        response_schema=ParsedAtsEmail,
                        temperature=0.1,
                    ),
                )
                if isinstance(response.parsed, ParsedAtsEmail):
                    print(f"  -> {model_name} (Gemini): job={response.parsed.is_job_related} | {response.parsed.company_name} ({response.parsed.detected_status})", flush=True)
                    return response.parsed
                return ParsedAtsEmail(is_job_related=False)
            except APIError as exc:
                if exc.code in (429, 503):
                    time.sleep(0.8 * (attempt + 1))
                    continue
                if exc.code == 404:
                    break
                raise
            except Exception as exc:
                print(f"  -> Gemini {model_name} error: {exc}", flush=True)
                break
    return None

def _classify_single(sender: str, subject: str, snippet: str) -> ParsedAtsEmail:
    prompt = f"Sender: {sender}\nSubject: {subject}\nBody Snippet: {snippet}"
    print(f"[Parser] Classifying: {subject[:60]}...", flush=True)

    # 1. Fast Groq inference (~0.4s)
    result = _classify_with_groq(prompt)
    if result is not None:
        return result

    # 2. Fallback to Gemini
    result = _classify_with_gemini(prompt)
    if result is not None:
        return result

    print("  -> All models temporarily busy, skipping message for next sync.", flush=True)
    return ParsedAtsEmail(is_job_related=False)

def classify_email_batch(emails: list[dict]) -> dict[int, ParsedAtsEmail]:
    results: dict[int, ParsedAtsEmail] = {}
    for item in emails:
        idx = int(item.get("index", 0))
        results[idx] = _classify_single(
            sender=item.get("sender", ""),
            subject=item.get("subject", ""),
            snippet=item.get("snippet", ""),
        )
    return results

def classify_ats_email(sender: str, subject: str, snippet: str) -> ParsedAtsEmail:
    batch = classify_email_batch([
        {"index": 0, "sender": sender, "subject": subject, "snippet": snippet}
    ])
    return batch.get(0, ParsedAtsEmail(is_job_related=False))
