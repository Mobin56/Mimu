from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


NETLIFY_SITE_ORIGIN = "https://remarkable-ganache-1b165b.netlify.app"


class Settings(BaseSettings):
    ai_provider: str = "openai"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    openai_realtime_model: str = "gpt-realtime"
    openai_realtime_voice: str = "alloy"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    mimu_data_dir: Path = Path.home() / ".mimu-ai"
    frontend_origin: str = "http://localhost:3000"

    @property
    def frontend_origins(self) -> list:
        configured = [
            origin.strip().rstrip("/")
            for origin in self.frontend_origin.split(",")
            if origin.strip()
        ]
        return list(dict.fromkeys(configured + [NETLIFY_SITE_ORIGIN]))

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[3] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def database_path(self) -> Path:
        return Path(self.mimu_data_dir).expanduser() / "mimu.sqlite3"

    @property
    def selected_ai_provider(self) -> str:
        return self.ai_provider.strip().lower()

    @property
    def selected_ai_api_key(self) -> str:
        if self.selected_ai_provider == "gemini":
            return self.gemini_api_key
        if self.selected_ai_provider == "openai":
            return self.openai_api_key
        return ""

    @property
    def selected_ai_model(self) -> str:
        if self.selected_ai_provider == "gemini":
            return self.gemini_model
        if self.selected_ai_provider == "openai":
            return self.openai_model
        return ""

    @property
    def ai_configured(self) -> bool:
        return bool(self.selected_ai_api_key)


settings = Settings()
