from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any

import jwt
import requests
from fastapi import Header, HTTPException

from .config import settings


@dataclass(frozen=True)
class Principal:
    user_id: str


_jwks_cache: dict[str, Any] | None = None
_jwks_cached_at: float = 0.0


def _get_jwks() -> dict[str, Any]:
    global _jwks_cache, _jwks_cached_at

    if settings.clerk_jwks_url is None:
        raise RuntimeError("CLERK_JWKS_URL is required when AUTH_MODE=clerk")

    # Very small cache to avoid refetching on every request.
    now = time.time()
    if _jwks_cache is not None and (now - _jwks_cached_at) < 300:
        return _jwks_cache

    resp = requests.get(settings.clerk_jwks_url, timeout=10)
    resp.raise_for_status()
    _jwks_cache = resp.json()
    _jwks_cached_at = now
    return _jwks_cache


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def get_principal(authorization: str | None = Header(default=None)) -> Principal:
    """
    Dev mode: accepts any request; uses the Bearer token value as user id,
              or defaults to "dev-user" if no token is provided.
    Clerk mode: verifies JWT against JWKS.
    """
    if settings.auth_mode == "dev":
        # Keep dev friction low; callers can still supply a stable id via header.
        user_id = "dev-user"
        token = _bearer_token(authorization)
        if token:
            # If the caller sends something like Bearer user_123, treat it as an id.
            user_id = token
        return Principal(user_id=user_id)

    if settings.auth_mode != "clerk":
        raise HTTPException(status_code=500, detail="Invalid AUTH_MODE")

    token = _bearer_token(authorization)
    if token is None:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    jwks = _get_jwks()
    try:
        # PyJWT can pick the right key from JWKS.
        decoded = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=settings.clerk_jwt_audience,
            issuer=settings.clerk_jwt_issuer,
            options={"verify_aud": settings.clerk_jwt_audience is not None},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    sub = decoded.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")

    return Principal(user_id=str(sub))

