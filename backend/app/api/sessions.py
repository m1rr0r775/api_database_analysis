import json
import os
import uuid
from fastapi import APIRouter, UploadFile, File, HTTPException
import shutil
from pydantic import BaseModel, Field
from app.core.config import settings
from app.core.path_security import safe_basename, safe_join
from app.services.data_diagnostics import diagnose_df
from app.services.data_formatting import to_preview_records
from app.services.upload_validation import parse_allowed_ext, save_upload_file_limited, validate_upload
from app.services.db_connections import get_connection
from app.services.db_query import run_query_df, validate_select_only
from app.services.excel_sheets import list_excel_sheets
from app.services.session_meta import load_meta, save_meta, session_dir, strip_paths
from app.services.table_io import read_table, safe_filename

router = APIRouter()


@router.post("/sessions/")
async def create_session():
    session_id = uuid.uuid4().hex
    os.makedirs(session_dir(session_id), exist_ok=True)
    save_meta(session_id, {"session_id": session_id, "files": []})
    return {"session_id": session_id}


@router.get("/sessions/{session_id}/files/")
async def list_files(session_id: str):
    if not os.path.exists(session_dir(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    meta = load_meta(session_id, allow_missing=True)
    files = strip_paths(meta.get("files", []))
    return {"session_id": session_id, "files": files}


@router.post("/sessions/{session_id}/files/")
async def upload_files(
    session_id: str,
    files: list[UploadFile] = File(...),
    smart_clean: bool = True,
    clean_options: str | None = None,
):
    if not os.path.exists(session_dir(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")

    meta = load_meta(session_id, allow_missing=True)
    existing_files: list[dict] = meta.get("files", [])

    results: list[dict] = []
    options: dict | None = None
    if clean_options:
        try:
            parsed = json.loads(clean_options)
            if isinstance(parsed, dict):
                options = parsed
        except Exception:
            options = None
    allowed_ext = parse_allowed_ext(getattr(settings, "UPLOAD_ALLOWED_EXT", ".csv,.xls,.xlsx"))
    for file in files:
        validate_upload(file, allowed_ext=allowed_ext, max_bytes=int(getattr(settings, "UPLOAD_MAX_BYTES", 0)))
        file_id = uuid.uuid4().hex
        original_name = safe_filename(file.filename or "")
        stored_name = f"{file_id}_{original_name}"
        file_location = safe_join(session_dir(session_id), stored_name)

        save_upload_file_limited(file, file_location, max_bytes=int(getattr(settings, "UPLOAD_MAX_BYTES", 0)))

        if original_name.lower().endswith((".xls", ".xlsx")):
            sheets = list_excel_sheets(file_location, max_sheets=20)
            if sum(1 for s in sheets if s.get("index", -1) >= 0) > 1:
                entry = {
                    "file_id": file_id,
                    "filename": original_name,
                    "path": file_location,
                    "kind": "excel_workbook",
                    "sheets": sheets,
                    "columns": [],
                    "preview": [],
                    "row_count": 0,
                    "status": "Excel uploaded (select sheets to extract)",
                }
                existing_files.append(entry)
                results.append(entry)
                continue
            df_raw = read_table(file_location, smart_clean=False)
            df = read_table(file_location, smart_clean=smart_clean, options=options)
        elif original_name.lower().endswith(".csv"):
            df_raw = read_table(file_location, smart_clean=False)
            df = read_table(file_location, smart_clean=smart_clean, options=options)
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
        raw_preview = to_preview_records(df_raw, settings.UPLOAD_PREVIEW_ROWS)
        raw_columns = df_raw.columns.tolist()
        entry = {
            "file_id": file_id,
            "filename": original_name,
            "path": file_location,
            "columns": columns,
            "preview": preview,
            "row_count": int(len(df)),
            "status": "Uploaded successfully",
            "diagnostics": diagnostics,
            "raw_columns": raw_columns,
            "raw_preview": raw_preview,
            "raw_row_count": int(len(df_raw)),
            "smart_clean": bool(smart_clean),
        }
        existing_files.append(entry)
        results.append(entry)

    meta["files"] = existing_files
    save_meta(session_id, meta)

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
    if not os.path.exists(session_dir(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")

    conn = get_connection(body.connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    sql = validate_select_only(body.sql)
    max_rows = int(getattr(settings, "DB_QUERY_SAVE_MAX_ROWS", 100000))
    limit = int(body.limit or max_rows)
    limit = min(max(limit, 1), max_rows)

    df = run_query_df(conn, sql, limit=limit)

    meta = load_meta(session_id, allow_missing=True)
    existing_files: list[dict] = meta.get("files", [])

    file_id = uuid.uuid4().hex
    safe_name = safe_basename((body.name or "").strip() or conn.name or "db_query")
    stored_name = f"{file_id}_{safe_name}.csv"
    file_location = safe_join(session_dir(session_id), stored_name)
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
    save_meta(session_id, meta)

    response_file = {k: v for k, v in entry.items() if k != "path"}
    return {"session_id": session_id, "files": [response_file]}
