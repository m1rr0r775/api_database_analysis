from __future__ import annotations

import os
from typing import Any

import pandas as pd
from fastapi import HTTPException


def _safe_filename(name: str) -> str:
    base = os.path.basename(name or "").strip()
    return base or "upload"


def _dedupe_columns(cols: list[Any]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for c in cols:
        name = str(c).strip() if c is not None else ""
        if not name:
            name = "Unnamed"
        if name not in seen:
            seen[name] = 1
            out.append(name)
        else:
            seen[name] += 1
            out.append(f"{name}_{seen[name]}")
    return out


def read_table(file_path: str) -> pd.DataFrame:
    path = str(file_path or "").strip()
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")

    low = path.lower()
    try:
        if low.endswith(".csv"):
            last_err: Exception | None = None
            for enc in ("utf-8", "utf-8-sig", "gbk"):
                try:
                    df = pd.read_csv(path, encoding=enc, on_bad_lines="skip")
                    break
                except Exception as e:
                    last_err = e
            else:
                raise last_err or Exception("CSV 解析失败")
        elif low.endswith((".xls", ".xlsx")):
            df = pd.read_excel(path)
        else:
            raise HTTPException(status_code=400, detail="不支持的文件类型（仅支持 CSV/Excel）")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "文件解析失败",
                "hint": "请确认文件未损坏、表头完整；CSV 建议使用 UTF-8 编码，Excel 建议另存为 .xlsx。",
                "cause": str(e),
            },
        )

    if df is None or not isinstance(df, pd.DataFrame):
        raise HTTPException(status_code=400, detail="文件解析失败：无法读取为表格数据")
    if df.shape[0] == 0 and df.shape[1] == 0:
        raise HTTPException(status_code=400, detail="文件为空或没有可识别的表格数据")

    df = df.copy()
    df.columns = _dedupe_columns(list(df.columns))
    return df


def safe_filename(name: str) -> str:
    return _safe_filename(name)

