from __future__ import annotations

import os
import re
import uuid
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.path_security import ensure_within, safe_basename, safe_join
from app.services.data_diagnostics import diagnose_df
from app.services.data_formatting import to_preview_records
from app.services.session_meta import find_file, load_meta, save_meta, session_dir
from app.services.table_io import read_table


router = APIRouter()


def _norm(s: str) -> str:
    v = str(s or "").strip().lower()
    v = re.sub(r"\s+", "", v)
    v = v.replace("_", "")
    return v


def _col_similarity(a: str, b: str) -> float:
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.85
    sa, sb = set(na), set(nb)
    inter = len(sa & sb)
    union = len(sa | sb)
    return float(inter) / float(union) if union else 0.0


class SuggestRequest(BaseModel):
    file_ids: list[str] = Field(default_factory=list)


@router.post("/sessions/{session_id}/model/suggest/")
async def suggest_relations(session_id: str, body: SuggestRequest):
    meta = load_meta(session_id)
    ids = body.file_ids or [str(f.get("file_id")) for f in (meta.get("files") or []) if f.get("columns")]
    tables: list[dict[str, Any]] = []
    sess_dir = session_dir(session_id)

    for fid in ids:
        f = find_file(meta, fid)
        if str(f.get("kind")) == "excel_workbook":
            continue
        path = f.get("path")
        if not path:
            continue
        abs_path = ensure_within(sess_dir, str(path))
        if not os.path.exists(abs_path):
            continue
        df = read_table(abs_path, smart_clean=True)
        tables.append({"file_id": fid, "name": f.get("filename") or fid, "df": df})

    suggestions: list[dict[str, Any]] = []
    for i in range(len(tables)):
        for j in range(i + 1, len(tables)):
            a, b = tables[i], tables[j]
            a_cols = [str(c) for c in a["df"].columns.tolist()]
            b_cols = [str(c) for c in b["df"].columns.tolist()]
            pairs = []
            for ca in a_cols:
                best = None
                best_score = 0.0
                for cb in b_cols:
                    s = _col_similarity(ca, cb)
                    if s > best_score:
                        best_score = s
                        best = cb
                if best and best_score >= 0.9:
                    pairs.append((ca, best, best_score))
            if not pairs:
                continue
            ca, cb, score = sorted(pairs, key=lambda x: x[2], reverse=True)[0]

            rel_type = "unknown"
            conf = "medium"
            try:
                left_unique = int(a["df"][ca].nunique(dropna=True)) == int(len(a["df"]))
                right_unique = int(b["df"][cb].nunique(dropna=True)) == int(len(b["df"]))
                if left_unique and right_unique:
                    rel_type = "one_to_one"
                    conf = "high"
                elif left_unique and (not right_unique):
                    rel_type = "one_to_many"
                    conf = "high"
                elif (not left_unique) and right_unique:
                    rel_type = "many_to_one"
                    conf = "high"
                else:
                    rel_type = "many_to_many"
                    conf = "medium"
            except Exception:
                rel_type = "unknown"
                conf = "low"

            suggestions.append(
                {
                    "left_file_id": a["file_id"],
                    "right_file_id": b["file_id"],
                    "left_key": ca,
                    "right_key": cb,
                    "confidence": conf,
                    "relation_type": rel_type,
                }
            )

    return {"suggestions": suggestions}


class BuildJoinRequest(BaseModel):
    left_file_id: str
    right_file_id: str
    left_key: str
    right_key: str
    how: str = "left"
    name: str = ""


@router.post("/sessions/{session_id}/model/build/")
async def build_join(session_id: str, body: BuildJoinRequest):
    meta = load_meta(session_id)
    sess_dir = session_dir(session_id)
    left_entry = find_file(meta, body.left_file_id)
    right_entry = find_file(meta, body.right_file_id)

    left_path = ensure_within(sess_dir, str(left_entry.get("path") or ""))
    right_path = ensure_within(sess_dir, str(right_entry.get("path") or ""))
    if not os.path.exists(left_path) or not os.path.exists(right_path):
        raise HTTPException(status_code=404, detail="Source file missing")

    left_df = read_table(left_path, smart_clean=True)
    right_df = read_table(right_path, smart_clean=True)

    if body.left_key not in left_df.columns or body.right_key not in right_df.columns:
        raise HTTPException(status_code=400, detail={"detail": "关联字段不存在", "hint": "请检查左右表的列名是否正确。"})

    how = str(body.how or "left").lower()
    if how not in ("inner", "left", "right", "outer"):
        raise HTTPException(status_code=400, detail="how must be inner/left/right/outer")

    merged = pd.merge(
        left_df,
        right_df,
        left_on=body.left_key,
        right_on=body.right_key,
        how=how,
        suffixes=("_l", "_r"),
    )

    result_id = uuid.uuid4().hex
    base = safe_basename(body.name.strip() or "model_join")
    stored_name = f"{result_id}_{base}.csv"
    out_path = safe_join(sess_dir, stored_name)
    merged.to_csv(out_path, index=False, encoding="utf-8-sig")

    diagnostics = diagnose_df(merged)
    entry = {
        "file_id": result_id,
        "filename": stored_name,
        "path": out_path,
        "columns": merged.columns.tolist(),
        "preview": to_preview_records(merged, 10),
        "row_count": int(len(merged)),
        "status": "Model view created",
        "source": "model",
        "model": {
            "left_file_id": body.left_file_id,
            "right_file_id": body.right_file_id,
            "left_key": body.left_key,
            "right_key": body.right_key,
            "how": how,
        },
        "diagnostics": diagnostics,
    }
    meta["files"].append(entry)
    save_meta(session_id, meta)
    return {"session_id": session_id, "file": {k: v for k, v in entry.items() if k != "path"}}
