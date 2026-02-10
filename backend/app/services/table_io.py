from __future__ import annotations

import os
import re
from typing import Any

import pandas as pd
from fastapi import HTTPException


def _safe_filename(name: str) -> str:
    base = os.path.basename(name or "").strip()
    return base or "upload"


_ID_LIKE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _dedupe_columns(cols: list[Any]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for c in cols:
        name = str(c).strip() if c is not None else ""
        if not name:
            name = "Unnamed"
        name = re.sub(r"\s+", "", name)
        if name not in seen:
            seen[name] = 1
            out.append(name)
        else:
            seen[name] += 1
            out.append(f"{name}_{seen[name]}")
    return out


def _maybe_drop_mapping_row(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    if df.shape[0] < 2 or df.shape[1] < 2:
        return df, False
    first = df.iloc[0]
    vals = [first[c] for c in df.columns]
    str_vals = [v for v in vals if isinstance(v, str)]
    if len(str_vals) < max(2, int(len(vals) * 0.6)):
        return df, False
    id_like = [v for v in str_vals if _ID_LIKE.fullmatch(v.strip())]
    if len(id_like) < max(2, int(len(vals) * 0.6)):
        return df, False
    return df.iloc[1:].reset_index(drop=True), True


def _maybe_convert_excel_date(df: pd.DataFrame) -> pd.DataFrame:
    d = df
    for col in d.columns:
        name = str(col)
        if ("日期" not in name) and ("时间" not in name):
            continue
        s = d[col]
        if not (pd.api.types.is_integer_dtype(s) or pd.api.types.is_float_dtype(s)):
            continue
        try:
            non_na = pd.to_numeric(s, errors="coerce").dropna()
            if non_na.empty:
                continue
            med = float(non_na.median())
            mx = float(non_na.max())
            if 20000 <= med <= 80000 and mx < 200000:
                converted = pd.to_datetime(s, unit="D", origin="1899-12-30", errors="coerce")
                ratio = float(converted.notna().mean()) if len(converted) else 0.0
                if ratio >= 0.85:
                    d[col] = converted
        except Exception:
            continue
    return d


def _maybe_convert_numeric(df: pd.DataFrame) -> pd.DataFrame:
    d = df
    for col in d.columns:
        s = d[col]
        if not (pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s)):
            continue
        try:
            converted = pd.to_numeric(s, errors="coerce")
            ratio = float(converted.notna().mean()) if len(converted) else 0.0
            if ratio >= 0.85:
                d[col] = converted
        except Exception:
            continue
    return d


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
    df, dropped_mapping = _maybe_drop_mapping_row(df)
    if dropped_mapping:
        try:
            df.attrs["mapping_row_removed"] = True
        except Exception:
            pass
    df = _maybe_convert_excel_date(df)
    df = _maybe_convert_numeric(df)
    return df


def safe_filename(name: str) -> str:
    return _safe_filename(name)
