import json
import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException
import shutil
from pydantic import BaseModel, Field
from app.core.config import settings
from app.core.path_security import safe_basename, safe_join, validate_session_id
from app.services.data_diagnostics import diagnose_df
from app.services.data_formatting import to_preview_records
from app.services.upload_validation import parse_allowed_ext, save_upload_file_limited, validate_upload
from app.services.db_connections import get_connection
from app.services.db_query import run_query_df, validate_select_only
from app.services.table_io import read_table, safe_filename

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
UPLOAD_ROOT = os.path.abspath(UPLOAD_DIR)


def _session_dir(session_id: str) -> str:
    sid = validate_session_id(session_id)
    return safe_join(UPLOAD_ROOT, sid)


def _meta_path(session_id: str) -> str:
    return safe_join(_session_dir(session_id), "meta.json")


def _load_meta(session_id: str) -> dict:
    path = _meta_path(session_id)
    if not os.path.exists(path):
        return {"session_id": session_id, "files": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
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


def _save_meta(session_id: str, meta: dict) -> None:
    os.makedirs(_session_dir(session_id), exist_ok=True)
    with open(_meta_path(session_id), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


@router.post("/sessions/")
async def create_session():
    session_id = uuid.uuid4().hex
    os.makedirs(_session_dir(session_id), exist_ok=True)
    _save_meta(session_id, {"session_id": session_id, "files": []})
    return {"session_id": session_id}


@router.get("/sessions/{session_id}/files/")
async def list_files(session_id: str):
    if not os.path.exists(_session_dir(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    meta = _load_meta(session_id)
    files = [{k: v for k, v in f.items() if k != "path"} for f in meta.get("files", [])]
    return {"session_id": session_id, "files": files}


@router.post("/sessions/{session_id}/files/")
async def upload_files(session_id: str, files: list[UploadFile] = File(...)):
    if not os.path.exists(_session_dir(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")

    meta = _load_meta(session_id)
    existing_files: list[dict] = meta.get("files", [])

    results: list[dict] = []
    allowed_ext = parse_allowed_ext(getattr(settings, "UPLOAD_ALLOWED_EXT", ".csv,.xls,.xlsx"))
    for file in files:
        validate_upload(file, allowed_ext=allowed_ext, max_bytes=int(getattr(settings, "UPLOAD_MAX_BYTES", 0)))
        file_id = uuid.uuid4().hex
        original_name = safe_filename(file.filename or "")
        stored_name = f"{file_id}_{original_name}"
        file_location = safe_join(_session_dir(session_id), stored_name)

        save_upload_file_limited(file, file_location, max_bytes=int(getattr(settings, "UPLOAD_MAX_BYTES", 0)))

        if original_name.lower().endswith((".csv", ".xls", ".xlsx")):
            df = read_table(file_location)
        else:
            entry = {
                "file_id": file_id,
                "filename": original_name,
                "path": file_location,
                "columns": [],
                "preview": [],
                "row_count": 0,
                "status": "Uploaded (unsupported for preview)",
            }
            existing_files.append(entry)
            results.append(entry)
            continue

        preview = to_preview_records(df, settings.UPLOAD_PREVIEW_ROWS)
        columns = df.columns.tolist()
        diagnostics = diagnose_df(df)
        entry = {
            "file_id": file_id,
            "filename": original_name,
            "path": file_location,
            "columns": columns,
            "preview": preview,
            "row_count": int(len(df)),
            "status": "Uploaded successfully",
            "diagnostics": diagnostics,
        }
        existing_files.append(entry)
        results.append(entry)

    meta["files"] = existing_files
    _save_meta(session_id, meta)

    response_files = [
        {k: v for k, v in f.items() if k != "path"}
        for f in results
    ]
    return {"session_id": session_id, "files": response_files}


class DbQueryToSessionRequest(BaseModel):
    connection_id: str
    sql: str
    name: str = Field(default="")
    limit: int | None = None


@router.post("/sessions/{session_id}/db_query/")
async def add_db_query_result(session_id: str, body: DbQueryToSessionRequest):
    if not os.path.exists(_session_dir(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")

    conn = get_connection(body.connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    sql = validate_select_only(body.sql)
    max_rows = int(getattr(settings, "DB_QUERY_SAVE_MAX_ROWS", 100000))
    limit = int(body.limit or max_rows)
    limit = min(max(limit, 1), max_rows)

    df = run_query_df(conn, sql, limit=limit)

    meta = _load_meta(session_id)
    existing_files: list[dict] = meta.get("files", [])

    file_id = uuid.uuid4().hex
    safe_name = safe_basename((body.name or "").strip() or conn.name or "db_query")
    stored_name = f"{file_id}_{safe_name}.csv"
    file_location = safe_join(_session_dir(session_id), stored_name)
    df.to_csv(file_location, index=False, encoding="utf-8-sig")

    preview = to_preview_records(df, settings.UPLOAD_PREVIEW_ROWS)
    columns = df.columns.tolist()
    diagnostics = diagnose_df(df)
    entry = {
        "file_id": file_id,
        "filename": stored_name,
        "path": file_location,
        "columns": columns,
        "preview": preview,
        "row_count": int(len(df)),
        "status": "DB query saved",
        "source": "db",
        "connection_id": conn.id,
        "connection_name": conn.name,
        "diagnostics": diagnostics,
    }
    existing_files.append(entry)
    meta["files"] = existing_files
    _save_meta(session_id, meta)

    response_file = {k: v for k, v in entry.items() if k != "path"}
    return {"session_id": session_id, "files": [response_file]}
