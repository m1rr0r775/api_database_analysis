from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.path_security import ensure_within, safe_join, validate_session_id
from app.services.clean_plan_store import CleanPlan, get_plan, purge_expired, put_plan
from app.services.clean_templates import create_template, delete_template, list_templates, record_learned, recommend_options
from app.services.data_diagnostics import diagnose_df
from app.services.data_formatting import to_preview_records
from app.services.semantic_rules import infer_semantics
from app.services.smart_clean import apply_smart_clean, build_ops, new_plan_id
from app.services.ai_clean_assistant import ai_clean_assistant


router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
UPLOAD_ROOT = os.path.abspath(UPLOAD_DIR)


def _session_dir(session_id: str) -> str:
    sid = validate_session_id(session_id)
    return safe_join(UPLOAD_ROOT, sid)


def _meta_path(session_id: str) -> str:
    return safe_join(_session_dir(session_id), "meta.json")


def _load_meta(session_id: str) -> dict[str, Any]:
    path = _meta_path(session_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        with open(path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail={"detail": "会话元数据损坏或无法读取", "cause": str(e)})
    if not isinstance(meta, dict):
        raise HTTPException(status_code=500, detail={"detail": "会话元数据格式不正确"})
    meta.setdefault("session_id", session_id)
    meta.setdefault("files", [])
    return meta


def _save_meta(session_id: str, meta: dict[str, Any]) -> None:
    with open(_meta_path(session_id), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def _find_file(meta: dict[str, Any], file_id: str) -> tuple[int, dict[str, Any]]:
    files = meta.get("files") or []
    for idx, it in enumerate(files):
        if str(it.get("file_id")) == str(file_id):
            return idx, it
    raise HTTPException(status_code=404, detail="File not found")


class CleanPreviewRequest(BaseModel):
    smart_clean: bool = True
    options: dict[str, Any] = Field(default_factory=dict)
    use_learning: bool = True


@router.post("/sessions/{session_id}/files/{file_id}/clean/preview/")
async def clean_preview(session_id: str, file_id: str, body: CleanPreviewRequest):
    purge_expired()
    meta = _load_meta(session_id)
    _, entry = _find_file(meta, file_id)

    session_dir = _session_dir(session_id)
    source_path = ensure_within(session_dir, str(entry.get("path") or ""))
    if not os.path.exists(source_path):
        raise HTTPException(status_code=404, detail="File not found")

    raw_df, _, _ = apply_smart_clean(source_path, smart_clean=False, options=None)
    signature = {"columns": [str(c) for c in raw_df.columns.tolist()]}
    learned = recommend_options(signature) if body.use_learning else None
    merged_opts = dict(learned or {})
    merged_opts.update(body.options or {})

    cleaned_df, final_opts, ops = apply_smart_clean(source_path, smart_clean=bool(body.smart_clean), options=merged_opts)

    raw_preview = to_preview_records(raw_df, 10)
    cleaned_preview = to_preview_records(cleaned_df, 10)
    raw_diag = diagnose_df(raw_df)
    cleaned_diag = diagnose_df(cleaned_df)
    semantics = infer_semantics(cleaned_df)

    plan_id = new_plan_id()
    put_plan(
        CleanPlan(
            plan_id=plan_id,
            session_id=session_id,
            file_id=file_id,
            source_path=source_path,
            created_at=time.time(),
            options=final_opts,
        )
    )

    return {
        "plan_id": plan_id,
        "file_id": file_id,
        "smart_clean": bool(body.smart_clean),
        "options": final_opts,
        "ops": [o.__dict__ for o in ops],
        "raw": {"columns": raw_df.columns.tolist(), "row_count": int(len(raw_df)), "preview": raw_preview, "diagnostics": raw_diag},
        "cleaned": {
            "columns": cleaned_df.columns.tolist(),
            "row_count": int(len(cleaned_df)),
            "preview": cleaned_preview,
            "diagnostics": cleaned_diag,
            "semantics": semantics,
        },
        "recommended_options": learned,
    }


class CleanApplyRequest(BaseModel):
    plan_id: str
    options: dict[str, Any] | None = None


@router.post("/sessions/{session_id}/files/{file_id}/clean/apply/")
async def clean_apply(session_id: str, file_id: str, body: CleanApplyRequest):
    purge_expired()
    plan = get_plan(body.plan_id)
    if not plan or plan.session_id != session_id or plan.file_id != file_id:
        raise HTTPException(status_code=400, detail="无效或过期的整理方案，请重新预览")

    meta = _load_meta(session_id)
    idx, entry = _find_file(meta, file_id)
    session_dir = _session_dir(session_id)
    source_path = ensure_within(session_dir, str(entry.get("path") or ""))
    if not os.path.exists(source_path):
        raise HTTPException(status_code=404, detail="File not found")

    final_options = dict(plan.options or {})
    if isinstance(body.options, dict):
        final_options.update(body.options)

    cleaned_df, used_opts, _ = apply_smart_clean(source_path, smart_clean=True, options=final_options)

    cleaned_name = f"{file_id}_cleaned.csv"
    cleaned_path = safe_join(session_dir, cleaned_name)
    cleaned_df.to_csv(cleaned_path, index=False, encoding="utf-8-sig")

    original_path = entry.get("original_path") or source_path
    entry["original_path"] = original_path
    entry["path"] = cleaned_path
    entry["filename"] = entry.get("filename") or os.path.basename(original_path)
    entry["cleaned_path"] = cleaned_path
    entry["cleaned"] = True
    entry["clean_options"] = used_opts

    meta["files"][idx] = entry
    _save_meta(session_id, meta)

    try:
        record_learned({"columns": [str(c) for c in cleaned_df.columns.tolist()]}, used_opts)
    except Exception:
        pass

    public_entry = {k: v for k, v in entry.items() if k != "path"}
    return {"session_id": session_id, "file": public_entry}


@router.post("/sessions/{session_id}/files/{file_id}/clean/revert/")
async def clean_revert(session_id: str, file_id: str):
    meta = _load_meta(session_id)
    idx, entry = _find_file(meta, file_id)
    session_dir = _session_dir(session_id)
    original_path = entry.get("original_path")
    if not original_path:
        raise HTTPException(status_code=400, detail="该文件没有可回退的原始版本")
    original_path = ensure_within(session_dir, str(original_path))
    if not os.path.exists(original_path):
        raise HTTPException(status_code=404, detail="原始文件不存在")
    entry["path"] = original_path
    entry["cleaned"] = False
    meta["files"][idx] = entry
    _save_meta(session_id, meta)
    public_entry = {k: v for k, v in entry.items() if k != "path"}
    return {"session_id": session_id, "file": public_entry}


@router.get("/clean/templates/")
async def clean_list_templates():
    return {"templates": list_templates()}


class TemplateCreateRequest(BaseModel):
    name: str
    options: dict[str, Any] = Field(default_factory=dict)


@router.post("/clean/templates/")
async def clean_create_template(body: TemplateCreateRequest):
    t = create_template(body.name, body.options or {})
    return {"template": t}


@router.delete("/clean/templates/{template_id}/")
async def clean_delete_template(template_id: str):
    ok = delete_template(template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


class NlRequest(BaseModel):
    instruction: str
    current_options: dict[str, Any] = Field(default_factory=dict)


@router.post("/clean/nl/")
async def clean_nl(body: NlRequest):
    return ai_clean_assistant.instruction_to_options(body.instruction, body.current_options or {})


class SemanticRequest(BaseModel):
    columns: list[str] = Field(default_factory=list)
    sample_rows: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/clean/semantic/")
async def clean_semantic(body: SemanticRequest):
    return ai_clean_assistant.infer_semantics(body.columns or [], body.sample_rows or [])

