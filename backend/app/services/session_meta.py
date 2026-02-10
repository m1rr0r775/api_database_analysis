from __future__ import annotations

import json
import os
from typing import Any

from fastapi import HTTPException

from app.core.path_security import safe_join, validate_session_id


UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
UPLOAD_ROOT = os.path.abspath(UPLOAD_DIR)


def session_dir(session_id: str) -> str:
    sid = validate_session_id(session_id)
    return safe_join(UPLOAD_ROOT, sid)


def meta_path(session_id: str) -> str:
    return safe_join(session_dir(session_id), "meta.json")


def load_meta(session_id: str, *, allow_missing: bool = False) -> dict[str, Any]:
    """
    读取会话元数据（meta.json）。

    - allow_missing=True：若 meta 不存在则返回默认结构（用于兼容老会话或极端情况下的容错）
    - allow_missing=False：若 meta 不存在则返回 404（用于依赖会话已创建的接口）
    """
    p = meta_path(session_id)
    if not os.path.exists(p):
        if allow_missing:
            return {"session_id": session_id, "files": []}
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        with open(p, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "detail": "会话元数据损坏或无法读取",
                "hint": "请删除该会话并重新上传/导入数据；如需保留数据，可先备份 uploads/<session_id>/ 目录。",
                "cause": str(e),
            },
        )
    if not isinstance(meta, dict):
        raise HTTPException(
            status_code=500,
            detail={
                "detail": "会话元数据格式不正确",
                "hint": "请删除该会话并重新上传/导入数据。",
            },
        )
    meta.setdefault("session_id", session_id)
    meta.setdefault("files", [])
    return meta


def save_meta(session_id: str, meta: dict[str, Any]) -> None:
    os.makedirs(session_dir(session_id), exist_ok=True)
    with open(meta_path(session_id), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def find_file(meta: dict[str, Any], file_id: str) -> dict[str, Any]:
    for f in meta.get("files") or []:
        if str(f.get("file_id")) == str(file_id):
            return f
    raise HTTPException(status_code=404, detail="File not found")


def strip_paths(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in f.items() if k != "path"} for f in (files or [])]

