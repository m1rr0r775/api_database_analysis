from __future__ import annotations

import os
from typing import Iterable

from fastapi import HTTPException, UploadFile


def _ext(filename: str) -> str:
    base = os.path.basename(filename or "")
    _, ext = os.path.splitext(base)
    return ext.lower()


def parse_allowed_ext(value: str) -> set[str]:
    parts = [p.strip().lower() for p in (value or "").split(",")]
    return {p if p.startswith(".") else f".{p}" for p in parts if p}


def validate_upload(file: UploadFile, allowed_ext: set[str], max_bytes: int) -> None:
    filename = file.filename or ""
    ext = _ext(filename)
    if not ext or ext not in allowed_ext:
        allowed = ", ".join(sorted(allowed_ext))
        raise HTTPException(status_code=400, detail=f"不支持的文件类型：{ext or filename}，仅支持：{allowed}")
    if max_bytes <= 0:
        return


def save_upload_file_limited(file: UploadFile, dst_path: str, max_bytes: int) -> int:
    total = 0
    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    try:
        with open(dst_path, "wb") as out:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if max_bytes > 0 and total > max_bytes:
                    raise HTTPException(status_code=413, detail=f"文件过大，最大支持 {max_bytes // (1024 * 1024)}MB")
                out.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="上传失败：文件为空")
    except HTTPException:
        try:
            if os.path.exists(dst_path):
                os.remove(dst_path)
        finally:
            raise
    return total
