from __future__ import annotations

import traceback
import uuid
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _new_error_id() -> str:
    return uuid.uuid4().hex[:10]


def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    error_id = _new_error_id()
    body: dict[str, Any]
    if isinstance(exc.detail, dict):
        body = {**exc.detail}
        body.setdefault("error_id", error_id)
        if "detail" not in body:
            body["detail"] = "请求失败"
    else:
        body = {"detail": str(exc.detail), "error_id": error_id}
    return JSONResponse(status_code=exc.status_code, content=body)


def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    error_id = _new_error_id()
    return JSONResponse(
        status_code=422,
        content={
            "detail": "请求参数不合法",
            "error_id": error_id,
            "errors": exc.errors(),
        },
    )


def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    error_id = _new_error_id()
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器内部错误",
            "error_id": error_id,
            "hint": "请检查数据格式或稍后重试；如持续失败，请提供 error_id 以便定位。",
        },
    )
