from __future__ import annotations

from fastapi import HTTPException, Request

from app.core.config import settings


def verify_api_key(request: Request) -> None:
    expected = (getattr(settings, "API_KEY", "") or "").strip()
    if not expected:
        return
    provided = (request.headers.get("X-API-Key") or "").strip()
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

