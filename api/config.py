from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = (
        "postgresql+psycopg2://anupalan:anupalan@localhost:5432/anupalan"
    )

    jwt_secret: str = "anupalan-dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720

    storage_dir: Path = API_DIR / "storage"
    cors_origins: str = "http://localhost:5173"

    # MiniLM: 384-dim. Matches VECTOR(384) in models.py — change both or neither.
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384

    # YOLOv8n, pretrained. Downloads on first use — cache before travelling.
    vision_model: str = "yolov8n.pt"

    risk_model_path: Path = API_DIR / "seed" / "risk_model.joblib"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.storage_dir.mkdir(parents=True, exist_ok=True)
    return s


settings = get_settings()
