import json
from fastapi import APIRouter, UploadFile, File, HTTPException
import os
from typing import List
from app.core.config import settings
from app.core.path_security import safe_basename, safe_join
from app.services.data_diagnostics import diagnose_df
from app.services.data_formatting import to_preview_records
from app.services.upload_validation import parse_allowed_ext, save_upload_file_limited, validate_upload
from app.services.table_io import read_table, safe_filename

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
UPLOAD_ROOT = os.path.abspath(UPLOAD_DIR)

@router.post("/upload/")
async def upload_file(file: UploadFile = File(...), smart_clean: bool = True, clean_options: str | None = None):
    allowed_ext = parse_allowed_ext(getattr(settings, "UPLOAD_ALLOWED_EXT", ".csv,.xls,.xlsx"))
    validate_upload(file, allowed_ext=allowed_ext, max_bytes=int(getattr(settings, "UPLOAD_MAX_BYTES", 0)))
    filename = safe_basename(safe_filename(file.filename or ""))
    file_location = safe_join(UPLOAD_ROOT, filename)
    save_upload_file_limited(file, file_location, max_bytes=int(getattr(settings, "UPLOAD_MAX_BYTES", 0)))

    options: dict | None = None
    if clean_options:
        try:
            parsed = json.loads(clean_options)
            if isinstance(parsed, dict):
                options = parsed
        except Exception:
            options = None
    df_raw = read_table(file_location, smart_clean=False)
    df = read_table(file_location, smart_clean=smart_clean, options=options)
    preview = to_preview_records(df, settings.UPLOAD_PREVIEW_ROWS)
    columns = df.columns.tolist()
    diagnostics = diagnose_df(df)
    raw_preview = to_preview_records(df_raw, settings.UPLOAD_PREVIEW_ROWS)
    raw_columns = df_raw.columns.tolist()

    return {
        "filename": filename,
        "status": "Uploaded successfully",
        "columns": columns,
        "preview": preview,
        "row_count": int(len(df)),
        "diagnostics": diagnostics,
        "raw_columns": raw_columns,
        "raw_preview": raw_preview,
        "raw_row_count": int(len(df_raw)),
        "smart_clean": bool(smart_clean),
    }
