from __future__ import annotations

import re
import uuid
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.path_security import ensure_within, safe_basename, safe_join
from app.services.data_diagnostics import diagnose_df
from app.services.data_formatting import to_preview_records
from app.services.excel_sheets import list_excel_sheets
from app.services.session_meta import find_file, load_meta, save_meta, session_dir
from app.services.table_io import read_table


router = APIRouter()


def _normalize_cols(cols: list[str]) -> list[str]:
    out: list[str] = []
    for c in cols:
        s = str(c or "")
        s = re.sub(r"\s+", "", s).lower()
        s = s.replace("_", "")
        out.append(s)
    return out


def _similarity(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return float(len(sa & sb)) / float(len(sa | sb))


class SheetPreviewRequest(BaseModel):
    sheet: str
    smart_clean: bool = True
    options: dict[str, Any] = Field(default_factory=dict)


@router.get("/sessions/{session_id}/excel/{file_id}/sheets/")
async def list_sheets(session_id: str, file_id: str):
    meta = load_meta(session_id)
    f = find_file(meta, file_id)
    if str(f.get("kind")) != "excel_workbook":
        raise HTTPException(status_code=400, detail="Not an excel workbook entry")
    path = ensure_within(session_dir(session_id), str(f.get("path") or ""))
    sheets = list_excel_sheets(path, max_sheets=20)
    f["sheets"] = sheets
    save_meta(session_id, meta)
    return {"file_id": file_id, "sheets": sheets}


@router.post("/sessions/{session_id}/excel/{file_id}/preview/")
async def preview_sheet(session_id: str, file_id: str, body: SheetPreviewRequest):
    meta = load_meta(session_id)
    f = find_file(meta, file_id)
    path = ensure_within(session_dir(session_id), str(f.get("path") or ""))
    df_raw = read_table(path, sheet_name=body.sheet, smart_clean=False)
    df = read_table(path, sheet_name=body.sheet, smart_clean=bool(body.smart_clean), options=body.options or {})
    return {
        "sheet": body.sheet,
        "raw": {
            "columns": df_raw.columns.tolist(),
            "row_count": int(len(df_raw)),
            "preview": to_preview_records(df_raw, 10),
        },
        "cleaned": {
            "columns": df.columns.tolist(),
            "row_count": int(len(df)),
            "preview": to_preview_records(df, 10),
            "diagnostics": diagnose_df(df),
        },
    }


class ExtractRequest(BaseModel):
    sheets: list[str] = Field(default_factory=list)
    smart_clean: bool = True
    options: dict[str, Any] = Field(default_factory=dict)
    stack_similar: bool = False
    add_sheet_column: bool = True


@router.post("/sessions/{session_id}/excel/{file_id}/extract/")
async def extract_sheets(session_id: str, file_id: str, body: ExtractRequest):
    meta = load_meta(session_id)
    f = find_file(meta, file_id)
    if str(f.get("kind")) != "excel_workbook":
        raise HTTPException(status_code=400, detail="Not an excel workbook entry")
    sess_dir = session_dir(session_id)
    path = ensure_within(sess_dir, str(f.get("path") or ""))
    all_sheets = [s.get("name") for s in (f.get("sheets") or []) if s.get("index", -1) >= 0]
    chosen = body.sheets or [str(n) for n in all_sheets if n]
    if not chosen:
        raise HTTPException(status_code=400, detail="No sheets selected")

    dfs: list[tuple[str, pd.DataFrame]] = []
    metas: list[dict[str, Any]] = []
    for s in chosen:
        df = read_table(path, sheet_name=s, smart_clean=bool(body.smart_clean), options=body.options or {})
        dfs.append((s, df))
        metas.append({"sheet": s, "columns": df.columns.tolist(), "row_count": int(len(df))})

    created: list[dict[str, Any]] = []
    if body.stack_similar and len(dfs) >= 2:
        groups: list[list[tuple[str, pd.DataFrame]]] = []
        for name, df in dfs:
            cols_n = _normalize_cols(df.columns.tolist())
            placed = False
            for g in groups:
                g_cols_n = _normalize_cols(g[0][1].columns.tolist())
                if _similarity(cols_n, g_cols_n) >= 0.9:
                    g.append((name, df))
                    placed = True
                    break
            if not placed:
                groups.append([(name, df)])

        for g in groups:
            if len(g) == 1:
                name, df = g[0]
                sheet_id = uuid.uuid4().hex
                stored_name = f"{sheet_id}_{safe_basename(str(name))}.csv"
                file_location = safe_join(sess_dir, stored_name)
                df.to_csv(file_location, index=False, encoding="utf-8-sig")
                diagnostics = diagnose_df(df)
                entry = {
                    "file_id": sheet_id,
                    "filename": stored_name,
                    "path": file_location,
                    "columns": df.columns.tolist(),
                    "preview": to_preview_records(df, 10),
                    "row_count": int(len(df)),
                    "status": "Sheet extracted",
                    "source": "excel_sheet",
                    "workbook_file_id": file_id,
                    "sheet": name,
                    "diagnostics": diagnostics,
                }
                meta["files"].append(entry)
                created.append({k: v for k, v in entry.items() if k != "path"})
                continue

            frames = []
            for sheet_name, df in g:
                d = df.copy()
                if body.add_sheet_column:
                    d["__sheet__"] = sheet_name
                frames.append(d)
            merged_df = pd.concat(frames, ignore_index=True)
            merged_id = uuid.uuid4().hex
            stored_name = f"{merged_id}_stacked.csv"
            file_location = safe_join(sess_dir, stored_name)
            merged_df.to_csv(file_location, index=False, encoding="utf-8-sig")
            diagnostics = diagnose_df(merged_df)
            entry = {
                "file_id": merged_id,
                "filename": stored_name,
                "path": file_location,
                "columns": merged_df.columns.tolist(),
                "preview": to_preview_records(merged_df, 10),
                "row_count": int(len(merged_df)),
                "status": "Sheets stacked",
                "source": "excel_stacked",
                "workbook_file_id": file_id,
                "sheets": [n for n, _ in g],
                "diagnostics": diagnostics,
            }
            meta["files"].append(entry)
            created.append({k: v for k, v in entry.items() if k != "path"})
    else:
        for sheet_name, df in dfs:
            sheet_id = uuid.uuid4().hex
            stored_name = f"{sheet_id}_{safe_basename(str(sheet_name))}.csv"
            file_location = safe_join(sess_dir, stored_name)
            df.to_csv(file_location, index=False, encoding="utf-8-sig")
            diagnostics = diagnose_df(df)
            entry = {
                "file_id": sheet_id,
                "filename": stored_name,
                "path": file_location,
                "columns": df.columns.tolist(),
                "preview": to_preview_records(df, 10),
                "row_count": int(len(df)),
                "status": "Sheet extracted",
                "source": "excel_sheet",
                "workbook_file_id": file_id,
                "sheet": sheet_name,
                "diagnostics": diagnostics,
            }
            meta["files"].append(entry)
            created.append({k: v for k, v in entry.items() if k != "path"})

    save_meta(session_id, meta)
    return {"session_id": session_id, "files": created}
