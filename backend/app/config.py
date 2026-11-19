from pathlib import Path
from pydantic_settings import BaseSettings

_env_path = Path(__file__).resolve().parent.parent / ".env"

class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    gemini_api_key: str

    class Config:
        env_file = _env_path if _env_path.exists() else ".env"

settings = Settings()
