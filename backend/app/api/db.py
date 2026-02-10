from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.db_connections import create_connection, delete_connection, get_connection, list_connections
from app.services.db_query import run_query_df, validate_select_only
from app.services.data_diagnostics import diagnose_df
from app.services.data_formatting import to_preview_records
from app.services.db_schema import get_schema
from app.services.db_query_store import add_history, delete_saved_query, list_history, list_saved_queries, save_query


router = APIRouter()


class ConnectionCreate(BaseModel):
    name: str = Field(default="")
    kind: str
    host: str | None = None
    port: int | None = None
    database: str | None = None
    username: str | None = None
    password: str | None = None
    sqlite_path: str | None = None
    ssl_mode: str | None = None


class QueryRequest(BaseModel):
    sql: str
    limit: int | None = None


class SaveQueryRequest(BaseModel):
    name: str
    sql: str


@router.get("/db/connections/")
async def db_list_connections():
    return {"connections": [c.to_public() for c in list_connections()]}


@router.post("/db/connections/")
async def db_create_connection(body: ConnectionCreate):
    kind = body.kind.strip().lower()
    if kind not in ("mysql", "mariadb", "postgres", "postgresql", "sqlite"):
        raise HTTPException(status_code=400, detail="当前仅支持 MySQL/PostgreSQL/SQLite")
    conn = create_connection(body.model_dump())
    return {"connection": conn.to_public()}


@router.delete("/db/connections/{connection_id}/")
async def db_delete_connection(connection_id: str):
    ok = delete_connection(connection_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"ok": True}


@router.post("/db/connections/{connection_id}/test/")
async def db_test_connection(connection_id: str):
    conn = get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    df = run_query_df(conn, "SELECT 1 AS ok", limit=1)
    return {"ok": True, "result": df.to_dict(orient="records")}


@router.post("/db/connections/{connection_id}/query/")
async def db_run_query(connection_id: str, body: QueryRequest):
    conn = get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    sql = validate_select_only(body.sql)
    limit = int(body.limit or getattr(settings, "DB_QUERY_PREVIEW_ROWS", 1000))
    limit = min(max(limit, 1), int(getattr(settings, "DB_QUERY_SAVE_MAX_ROWS", 100000)))
    df = run_query_df(conn, sql, limit=limit)
    preview_limit = min(len(df), int(getattr(settings, "DB_QUERY_PREVIEW_ROWS", 1000)))
    preview = to_preview_records(df.head(preview_limit))
    diagnostics = diagnose_df(df)
    add_history(conn.id, sql, int(len(df)))
    return {
        "columns": df.columns.tolist(),
        "row_count": int(len(df)),
        "preview": preview,
        "diagnostics": diagnostics,
    }


@router.get("/db/connections/{connection_id}/schema/")
async def db_get_schema(connection_id: str):
    conn = get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return get_schema(conn)


@router.get("/db/connections/{connection_id}/queries/")
async def db_list_saved_queries(connection_id: str):
    conn = get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"queries": list_saved_queries(conn.id)}


@router.post("/db/connections/{connection_id}/queries/")
async def db_save_query(connection_id: str, body: SaveQueryRequest):
    conn = get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    sql = validate_select_only(body.sql)
    q = save_query(conn.id, body.name, sql)
    return {"query": q}


@router.delete("/db/queries/{query_id}/")
async def db_delete_query(query_id: str):
    ok = delete_saved_query(query_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Query not found")
    return {"ok": True}


@router.get("/db/connections/{connection_id}/history/")
async def db_list_query_history(connection_id: str):
    conn = get_connection(connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"history": list_history(conn.id)}
