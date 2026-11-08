from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    openai_realtime_model: str = "gpt-realtime"
    openai_realtime_voice: str = "alloy"
    mimu_data_dir: Path = Path.home() / ".mimu-ai"
    frontend_origin: str = "http://localhost:3000"

    @property
    def frontend_origins(self) -> list:
        return [origin.strip().rstrip("/") for origin in self.frontend_origin.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[3] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def database_path(self) -> Path:
        return Path(self.mimu_data_dir).expanduser() / "mimu.sqlite3"


settings = Settings()
