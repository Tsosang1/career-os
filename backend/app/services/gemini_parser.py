from google import genai
from google.genai import types
from app.config import settings
from app.schemas import ParsedAtsEmail

client = genai.Client(api_key=settings.gemini_api_key)

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
"""

def classify_ats_email(sender: str, subject: str, snippet: str) -> ParsedAtsEmail:
    prompt = f"Sender: {sender}\nSubject: {subject}\nBody Snippet: {snippet}"

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=ParsedAtsEmail,
            temperature=0.1,
        ),
    )

    if response.parsed:
        return response.parsed
    return ParsedAtsEmail(is_job_related=False)
