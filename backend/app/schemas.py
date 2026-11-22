from typing import Literal, Optional
from pydantic import BaseModel, Field

ApplicationStatus = Literal[
    "RADAR", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "CLOSED"
]

class ParsedAtsEmail(BaseModel):
    is_job_related: bool = Field(
        description="True only if this email is a job application confirmation, assessment, interview invite, offer, or rejection."
    )
    company_name: Optional[str] = Field(default=None)
    role_title: Optional[str] = Field(default=None)
    detected_status: Optional[ApplicationStatus] = Field(default=None)
    confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    summary: str = Field(default="")

class JobLead(BaseModel):
    id: str
    company_name: str
    role_title: str
    location_mode: Optional[str] = None
    source: str = "Email Alert"
    subject: str
    portal_url: Optional[str] = None
    received_at: Optional[str] = None

class SyncRequest(BaseModel):
    user_id: str
    max_results: int = 40

class SyncResponse(BaseModel):
    scanned: int
    matched: int
    staged_for_review: int
    leads: list[JobLead] = []
