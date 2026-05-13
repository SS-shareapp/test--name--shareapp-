from __future__ import annotations

from pydantic import BaseModel
import os


class Settings(BaseModel):
    # Auth
    auth_mode: str = os.getenv("AUTH_MODE", "dev")  # dev|clerk
    clerk_jwks_url: str | None = os.getenv("CLERK_JWKS_URL")
    clerk_jwt_audience: str | None = os.getenv("CLERK_JWT_AUDIENCE")
    clerk_jwt_issuer: str | None = os.getenv("CLERK_JWT_ISSUER")

    # DB
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./dev.db")

    # S3-compatible (Cloudflare R2 recommended)
    s3_endpoint_url: str | None = os.getenv("S3_ENDPOINT_URL")
    s3_access_key_id: str | None = os.getenv("S3_ACCESS_KEY_ID")
    s3_secret_access_key: str | None = os.getenv("S3_SECRET_ACCESS_KEY")
    s3_bucket: str | None = os.getenv("S3_BUCKET")
    s3_region: str | None = os.getenv("S3_REGION", "auto")

    presign_expires_seconds: int = int(os.getenv("PRESIGN_EXPIRES_SECONDS", "3600"))


settings = Settings()

