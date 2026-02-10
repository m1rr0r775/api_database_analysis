from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any

from app.services.db_crypto import decrypt_text, encrypt_text
from app.core.paths import data_dir


def _data_dir() -> str:
    return data_dir()


def _store_path() -> str:
    return os.path.join(_data_dir(), "db_connections.json")


@dataclass(frozen=True)
class DbConnection:
    id: str
    name: str
    kind: str
    host: str | None
    port: int | None
    database: str | None
    username: str | None
    password: str | None
    sqlite_path: str | None
    ssl_mode: str | None
    created_at: int

    def to_public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "username": self.username,
            "sqlite_path": self.sqlite_path,
            "ssl_mode": self.ssl_mode,
            "created_at": self.created_at,
        }


def _load_raw() -> list[dict[str, Any]]:
    path = _store_path()
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
        if isinstance(data, list):
            return data
    return []


def _save_raw(items: list[dict[str, Any]]) -> None:
    path = _store_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def _from_raw(item: dict[str, Any]) -> DbConnection:
    return DbConnection(
        id=str(item.get("id") or ""),
        name=str(item.get("name") or ""),
        kind=str(item.get("kind") or ""),
        host=item.get("host") if item.get("host") is not None else None,
        port=int(item["port"]) if item.get("port") is not None else None,
        database=item.get("database") if item.get("database") is not None else None,
        username=item.get("username") if item.get("username") is not None else None,
        password=decrypt_text(str(item.get("password_enc") or "")) if item.get("password_enc") else None,
        sqlite_path=item.get("sqlite_path") if item.get("sqlite_path") is not None else None,
        ssl_mode=item.get("ssl_mode") if item.get("ssl_mode") is not None else None,
        created_at=int(item.get("created_at") or 0),
    )


def list_connections() -> list[DbConnection]:
    return [_from_raw(x) for x in _load_raw()]


def get_connection(conn_id: str) -> DbConnection | None:
    for c in list_connections():
        if c.id == conn_id:
            return c
    return None


def create_connection(payload: dict[str, Any]) -> DbConnection:
    conn_id = uuid.uuid4().hex
    now = int(time.time())
    kind = str(payload.get("kind") or "").strip().lower()
    item: dict[str, Any] = {
        "id": conn_id,
        "name": str(payload.get("name") or "").strip() or f"{kind}_{conn_id[:6]}",
        "kind": kind,
        "host": (str(payload.get("host")).strip() if payload.get("host") is not None else None),
        "port": int(payload["port"]) if payload.get("port") is not None else None,
        "database": (str(payload.get("database")).strip() if payload.get("database") is not None else None),
        "username": (str(payload.get("username")).strip() if payload.get("username") is not None else None),
        "password_enc": encrypt_text(str(payload.get("password") or "")) if payload.get("password") else "",
        "sqlite_path": (str(payload.get("sqlite_path")).strip() if payload.get("sqlite_path") is not None else None),
        "ssl_mode": (str(payload.get("ssl_mode")).strip() if payload.get("ssl_mode") is not None else None),
        "created_at": now,
    }
    items = _load_raw()
    items.append(item)
    _save_raw(items)
    return _from_raw(item)


def delete_connection(conn_id: str) -> bool:
    items = _load_raw()
    before = len(items)
    items = [x for x in items if str(x.get("id") or "") != conn_id]
    if len(items) == before:
        return False
    _save_raw(items)
    return True
