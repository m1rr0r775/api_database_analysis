from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

from app.core.paths import data_dir


def _data_dir() -> str:
    return data_dir()


def _queries_path() -> str:
    return os.path.join(_data_dir(), "db_saved_queries.json")


def _history_path() -> str:
    return os.path.join(_data_dir(), "db_query_history.json")


def _load_list(path: str) -> list[dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
        if isinstance(data, list):
            return data
    return []


def _save_list(path: str, items: list[dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def list_saved_queries(connection_id: str) -> list[dict[str, Any]]:
    items = _load_list(_queries_path())
    return [x for x in items if str(x.get("connection_id") or "") == connection_id]


def save_query(connection_id: str, name: str, sql: str) -> dict[str, Any]:
    qid = uuid.uuid4().hex
    now = int(time.time())
    item = {
        "id": qid,
        "connection_id": connection_id,
        "name": (name or "").strip() or f"query_{qid[:6]}",
        "sql": sql,
        "created_at": now,
        "updated_at": now,
    }
    items = _load_list(_queries_path())
    items.append(item)
    _save_list(_queries_path(), items)
    return item


def delete_saved_query(query_id: str) -> bool:
    items = _load_list(_queries_path())
    before = len(items)
    items = [x for x in items if str(x.get("id") or "") != query_id]
    if len(items) == before:
        return False
    _save_list(_queries_path(), items)
    return True


def add_history(connection_id: str, sql: str, row_count: int) -> None:
    items = _load_list(_history_path())
    items.insert(
        0,
        {
            "connection_id": connection_id,
            "sql": sql,
            "row_count": int(row_count),
            "created_at": int(time.time()),
        },
    )
    items = items[:200]
    _save_list(_history_path(), items)


def list_history(connection_id: str) -> list[dict[str, Any]]:
    items = _load_list(_history_path())
    return [x for x in items if str(x.get("connection_id") or "") == connection_id][:50]
