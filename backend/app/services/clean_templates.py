from __future__ import annotations

import json
import time
import uuid
from typing import Any

from fastapi import HTTPException

from app.core.paths import data_dir


def _templates_path() -> str:
    return f"{data_dir()}/clean_templates.json"


def _load() -> dict[str, Any]:
    path = _templates_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            data.setdefault("templates", [])
            data.setdefault("learned", [])
            return data
    except Exception:
        return {"templates": [], "learned": []}
    return {"templates": [], "learned": []}


def _save(data: dict[str, Any]) -> None:
    path = _templates_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def list_templates() -> list[dict[str, Any]]:
    return list(_load().get("templates") or [])


def create_template(name: str, options: dict[str, Any]) -> dict[str, Any]:
    n = (name or "").strip()
    if not n:
        raise HTTPException(status_code=400, detail="模板名称不能为空")
    data = _load()
    t = {
        "id": uuid.uuid4().hex,
        "name": n,
        "options": options or {},
        "created_at": int(time.time()),
    }
    templates = list(data.get("templates") or [])
    templates.append(t)
    data["templates"] = templates
    _save(data)
    return t


def delete_template(template_id: str) -> bool:
    data = _load()
    templates = list(data.get("templates") or [])
    before = len(templates)
    templates = [t for t in templates if str(t.get("id")) != str(template_id)]
    data["templates"] = templates
    _save(data)
    return len(templates) != before


def record_learned(signature: dict[str, Any], options: dict[str, Any]) -> None:
    data = _load()
    learned = list(data.get("learned") or [])
    learned.append({"id": uuid.uuid4().hex, "signature": signature or {}, "options": options or {}, "created_at": int(time.time())})
    learned = learned[-200:]
    data["learned"] = learned
    _save(data)


def recommend_options(signature: dict[str, Any]) -> dict[str, Any] | None:
    sig_cols = set([str(c) for c in (signature or {}).get("columns", []) if c])
    if not sig_cols:
        return None
    data = _load()
    learned = list(data.get("learned") or [])
    best = None
    best_score = 0.0
    for item in learned:
        cols = set([str(c) for c in (item.get("signature") or {}).get("columns", []) if c])
        if not cols:
            continue
        inter = len(sig_cols & cols)
        union = len(sig_cols | cols)
        score = float(inter) / float(union) if union else 0.0
        if score > best_score:
            best_score = score
            best = item
    if best and best_score >= 0.6:
        return best.get("options") or {}
    return None

