from __future__ import annotations

import os
import re

from fastapi import HTTPException


_SESSION_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def validate_session_id(session_id: str) -> str:
    sid = str(session_id or "").strip().lower()
    if not _SESSION_ID_RE.fullmatch(sid):
        raise HTTPException(status_code=400, detail="session_id 不合法")
    return sid


def safe_basename(name: str) -> str:
    base = os.path.basename(str(name or "").strip())
    base = base.replace("\x00", "")
    if not base or base in (".", ".."):
        raise HTTPException(status_code=400, detail="文件名不合法")
    return base


def safe_join(base_dir: str, *parts: str) -> str:
    base = os.path.abspath(base_dir)
    path = os.path.abspath(os.path.join(base, *[str(p) for p in parts]))
    if os.path.commonpath([base, path]) != base:
        raise HTTPException(status_code=400, detail="路径不合法")
    return path


def ensure_within(base_dir: str, path: str) -> str:
    base = os.path.abspath(base_dir)
    p = os.path.abspath(str(path or ""))
    if os.path.commonpath([base, p]) != base:
        raise HTTPException(status_code=400, detail="路径不合法")
    return p

