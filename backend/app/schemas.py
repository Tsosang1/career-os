from typing import Literal, Optional
from pydantic import BaseModel, Field

ApplicationStatus = Literal[
    "RADAR", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "CLOSED"
]

class ParsedAtsEmail(BaseModel):
    is_job_related: bool = Field(
        description="True only if this email is a job application confirmation, assessment, interview invite, offer, or rejection."
    )
    company_name: Optional[str] = Field(
        default=None,
        description="Normalized employer name (e.g. 'BMW Group South Africa' -> 'BMW')."
    )
    role_title: Optional[str] = Field(
        default=None,
        description="Job title mentioned in the email, if present."
    )
    detected_status: Optional[ApplicationStatus] = Field(
        default=None,
        description="APPLIED for receipt confirmations, ASSESSMENT for coding tests/psychometrics, INTERVIEW for scheduling/invites, OFFER for offers, CLOSED for rejections."
    )
    confidence_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Confidence from 0.0 to 1.0 that this email belongs to a specific company and stage."
    )
    summary: str = Field(
        default="",
        description="One-sentence summary of the update."
    )

class SyncRequest(BaseModel):
    user_id: str
    max_results: int = 25

class SyncResponse(BaseModel):
    scanned: int
    matched: int
    staged_for_review: int
