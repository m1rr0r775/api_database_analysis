from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from typing import Any, Optional
from app.services.ai_service import ai_service
import json
import anyio
from app.core.path_security import ensure_within, safe_basename, safe_join, validate_session_id

router = APIRouter()

class HistoryMessage(BaseModel):
    role: str
    content: str

class AnalysisRequest(BaseModel):
    filename: str | None = None
    session_id: str | None = None
    file_ids: list[str] = []
    query: str
    history: list[HistoryMessage] = []

class AnalysisResponse(BaseModel):
    answer: str
    need_chart: bool = False
    chart_option: Optional[Any] = None
    dashboard: Optional[Any] = None

UPLOAD_DIR = "uploads"
UPLOAD_ROOT = os.path.abspath(UPLOAD_DIR)

@router.post("/analyze/", response_model=AnalysisResponse)
async def analyze_data(request: AnalysisRequest):
    history = [m.model_dump() for m in request.history]

    if request.session_id:
        sid = validate_session_id(request.session_id)
        session_dir = safe_join(UPLOAD_ROOT, sid)
        meta_path = safe_join(session_dir, "meta.json")
        if not os.path.exists(meta_path):
            raise HTTPException(status_code=404, detail="Session not found")
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
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
        all_files: list[dict] = meta.get("files", [])
        selected = (
            [f for f in all_files if str(f.get("file_id")) in set(request.file_ids)]
            if request.file_ids
            else all_files
        )
        if not selected:
            raise HTTPException(status_code=404, detail="No files selected")
        files_for_ai: list[dict[str, Any]] = []
        for idx, f in enumerate(selected, start=1):
            path = str(f.get("path", "")).strip()
            name = str(f.get("filename", "")).strip()
            if not path:
                continue
            safe_path = ensure_within(session_dir, path)
            if not os.path.exists(safe_path):
                continue
            files_for_ai.append({"table": f"t{idx}", "name": name, "path": safe_path})
        if not files_for_ai:
            raise HTTPException(status_code=404, detail="No valid files found")
        result = await anyio.to_thread.run_sync(
            ai_service.analyze_files, files_for_ai, request.query, history
        )
    else:
        if not request.filename:
            raise HTTPException(status_code=400, detail="filename or session_id is required")
        filename = safe_basename(request.filename)
        file_path = safe_join(UPLOAD_ROOT, filename)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        result = await anyio.to_thread.run_sync(
            ai_service.analyze_data, file_path, request.query, history
        )

    return {
        "answer": result.get("answer", ""),
        "need_chart": bool(result.get("need_chart", False)),
        "chart_option": result.get("chart_option", None),
        "dashboard": result.get("dashboard", None),
    }
