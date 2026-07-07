from __future__ import annotations

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    github_token: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    qwen_api_key: Optional[str] = None
    ai_provider: str = "mock"
    ai_model: str = "claude-haiku-4-5"
    database_url: str = "sqlite:///./reviewpilot.db"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
