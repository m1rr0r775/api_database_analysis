from __future__ import annotations

import os

from app.core.config import settings


def backend_root_dir() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def data_dir() -> str:
    cfg = (getattr(settings, "DATA_DIR", "") or "").strip()
    path = cfg if cfg else os.path.join(backend_root_dir(), "data")
    os.makedirs(path, exist_ok=True)
    return path

