from typing import Optional
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_env_path = Path(__file__).resolve().parent.parent / ".env"

class Settings(BaseSettings):
    supabase_url: str = Field(default="")
    supabase_service_role_key: str = Field(default="")
    gemini_api_key: str = Field(default="")
    groq_api_key: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=_env_path if _env_path.exists() else ".env",
        extra="ignore",
    )

settings = Settings()

