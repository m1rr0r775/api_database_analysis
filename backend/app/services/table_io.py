from __future__ import annotations

"""
统一的表格读取与轻量“智能整理”入口。

目标：
- 让 CSV/Excel 读取行为稳定可控（统一编码兜底、Sheet 支持等）
- 在不引入复杂依赖的前提下，提供一套可开关的启发式清洗
- 通过 df.attrs 暴露“发生了什么”，便于前端提示与质量报告
"""

import os
import re
from typing import Any

import pandas as pd
from fastapi import HTTPException


def _safe_filename(name: str) -> str:
    base = os.path.basename(name or "").strip()
    return base or "upload"


_ID_LIKE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_TS_COL_HINT = re.compile(r"(timestamp|时间戳|毫秒|ms)", re.I)


def _dedupe_columns(cols: list[Any], strip_internal_ws: bool) -> tuple[list[str], dict[str, Any]]:
    seen: dict[str, int] = {}
    out: list[str] = []
    info: dict[str, Any] = {"had_duplicates": False, "had_whitespace": False}
    for c in cols:
        name = str(c).strip() if c is not None else ""
        if not name:
            name = "Unnamed"
        if strip_internal_ws:
            cleaned = re.sub(r"\s+", "", name)
            if cleaned != name:
                info["had_whitespace"] = True
            name = cleaned
        if name not in seen:
            seen[name] = 1
            out.append(name)
        else:
            seen[name] += 1
            info["had_duplicates"] = True
            out.append(f"{name}_{seen[name]}")
    return out, info


def _maybe_drop_mapping_row(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    """
    识别“首行字段映射行”并移除。

    典型场景：第一行是程序字段名（如 user_id/pay_time），第二行才是中文表头，
    或第一行是字段映射说明行。这里用“多数单元格为 ID-like 字符串”做启发式判断。
    """
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


def _maybe_flatten_multilevel_header(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    cols = [str(c) for c in df.columns]
    unnamed = [c for c in cols if c.lower().startswith("unnamed")]
    if len(unnamed) < max(2, int(len(cols) * 0.3)):
        return df, False
    if df.shape[0] < 2:
        return df, False
    first = df.iloc[0]
    vals = [first[c] for c in df.columns]
    str_vals = [v for v in vals if isinstance(v, str) and v.strip()]
    if len(str_vals) < max(2, int(len(vals) * 0.6)):
        return df, False
    new_cols: list[str] = []
    for c in df.columns:
        base = str(c)
        v = first[c]
        v_str = str(v).strip() if isinstance(v, str) else ""
        if base.lower().startswith("unnamed") and v_str:
            new_cols.append(v_str)
        elif v_str and v_str not in (base, "nan"):
            new_cols.append(f"{base}_{v_str}")
        else:
            new_cols.append(base)
    next_df = df.iloc[1:].reset_index(drop=True).copy()
    next_df.columns = new_cols
    return next_df, True


def _drop_empty_rows_cols(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    before_rows, before_cols = int(df.shape[0]), int(df.shape[1])
    d = df.dropna(axis=0, how="all")
    d = d.dropna(axis=1, how="all")
    after_rows, after_cols = int(d.shape[0]), int(d.shape[1])
    return d, {"rows_removed": before_rows - after_rows, "cols_removed": before_cols - after_cols}

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
                    try:
                        cols = d.attrs.get("excel_date_converted_cols", [])
                        if isinstance(cols, list):
                            cols.append(str(col))
                            d.attrs["excel_date_converted_cols"] = cols
                    except Exception:
                        pass
        except Exception:
            continue
    return d


def _looks_like_epoch_ms(s: pd.Series) -> bool:
    """
    判断某列“像不像毫秒时间戳（epoch ms）”。

    用中位数做判别，避免被少量异常值影响：
    - 1e11 ~ 2e13 基本覆盖 1973~2600 年的毫秒时间戳范围
    """
    try:
        non_na = pd.to_numeric(s, errors="coerce").dropna()
        if non_na.empty:
            return False
        med = float(non_na.median())
        return 1.0e11 <= med <= 2.0e13
    except Exception:
        return False


def _maybe_convert_epoch_timestamps(df: pd.DataFrame, only_cols: list[str] | None) -> pd.DataFrame:
    """
    将“时间戳列”从 epoch(ms) 转为 datetime。

    默认只对列名包含 timestamp/时间戳/ms/毫秒 的列尝试转换；
    也支持通过 only_cols 指定仅转换哪些列。
    """
    d = df
    converted_cols: list[str] = []
    for col in d.columns:
        name = str(col)
        if only_cols is not None and name not in only_cols:
            continue
        if not _TS_COL_HINT.search(name):
            continue
        s = d[col]
        if not (
            pd.api.types.is_integer_dtype(s)
            or pd.api.types.is_float_dtype(s)
            or pd.api.types.is_object_dtype(s)
            or pd.api.types.is_string_dtype(s)
        ):
            continue
        if not _looks_like_epoch_ms(s):
            continue
        try:
            converted = pd.to_datetime(pd.to_numeric(s, errors="coerce"), unit="ms", errors="coerce")
            ratio = float(converted.notna().mean()) if len(converted) else 0.0
            if ratio >= 0.85:
                d[col] = converted
                converted_cols.append(name)
        except Exception:
            continue
    if converted_cols:
        try:
            d.attrs["epoch_timestamp_converted_cols"] = converted_cols
        except Exception:
            pass
    return d


def _maybe_convert_numeric(df: pd.DataFrame, only_cols: list[str] | None, exclude_cols: list[str] | None) -> pd.DataFrame:
    """
    将 object/string 列尝试转为数值列（当可转比例足够高）。

    - only_cols: 指定后只转换这些列
    - exclude_cols: 显式排除（例如已被识别为时间戳并转换的列）
    - 默认还会跳过“疑似时间戳列名”，避免把时间戳当普通数值列误转
    """
    d = df
    for col in d.columns:
        name = str(col)
        if only_cols is not None and name not in only_cols:
            continue
        if only_cols is None and _TS_COL_HINT.search(name):
            continue
        if exclude_cols is not None and name in exclude_cols:
            continue
        s = d[col]
        if not (pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s)):
            continue
        try:
            converted = pd.to_numeric(s, errors="coerce")
            ratio = float(converted.notna().mean()) if len(converted) else 0.0
            if ratio >= 0.85:
                d[col] = converted
                try:
                    cols = d.attrs.get("numeric_converted_cols", [])
                    if isinstance(cols, list):
                        cols.append(name)
                        d.attrs["numeric_converted_cols"] = cols
                except Exception:
                    pass
        except Exception:
            continue
    return d


def _read_raw(file_path: str, *, sheet_name: str | int | None = None) -> pd.DataFrame:
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
            df = pd.read_excel(path, sheet_name=sheet_name if sheet_name is not None else 0)
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
    return df


def read_table(
    file_path: str,
    *,
    sheet_name: str | int | None = None,
    smart_clean: bool = True,
    options: dict[str, Any] | None = None,
) -> pd.DataFrame:
    """
    读取 CSV/Excel 并按 options 进行启发式清洗。

    参数说明：
    - sheet_name: Excel 读取哪个 Sheet（None 表示第 0 个）
    - smart_clean: 是否启用清洗（关闭时只做列名去重）
    - options（常用）：
      - remove_mapping_row: bool
      - flatten_multilevel_header: bool
      - strip_header_whitespace: bool
      - drop_empty_rows_cols: bool
      - convert_excel_dates: bool（Excel 序列日期）
      - convert_epoch_timestamps: bool（毫秒时间戳）
      - timestamp_columns: list[str]（仅转换这些时间戳列；空=自动识别）
      - convert_numeric: bool
      - numeric_columns: list[str]（仅转换这些数值列；空=自动识别）
    """
    df = _read_raw(file_path, sheet_name=sheet_name).copy()

    opts = options or {}
    if not isinstance(opts, dict):
        opts = {}

    strip_internal_ws = bool(opts.get("strip_header_whitespace", True)) if smart_clean else False
    cols, info = _dedupe_columns(list(df.columns), strip_internal_ws=strip_internal_ws)
    df.columns = cols
    try:
        df.attrs["header_whitespace_removed"] = bool(info.get("had_whitespace"))
        df.attrs["duplicate_headers_renamed"] = bool(info.get("had_duplicates"))
    except Exception:
        pass

    if not smart_clean:
        return df

    if bool(opts.get("flatten_multilevel_header", True)):
        df, flattened = _maybe_flatten_multilevel_header(df)
        if flattened:
            try:
                df.attrs["multilevel_header_flattened"] = True
            except Exception:
                pass

    if bool(opts.get("remove_mapping_row", True)):
        df, dropped_mapping = _maybe_drop_mapping_row(df)
        if dropped_mapping:
            try:
                df.attrs["mapping_row_removed"] = True
            except Exception:
                pass

    if bool(opts.get("drop_empty_rows_cols", True)):
        df, counts = _drop_empty_rows_cols(df)
        try:
            if counts.get("rows_removed"):
                df.attrs["empty_rows_removed"] = int(counts["rows_removed"])
            if counts.get("cols_removed"):
                df.attrs["empty_cols_removed"] = int(counts["cols_removed"])
        except Exception:
            pass

    if bool(opts.get("convert_excel_dates", True)):
        df = _maybe_convert_excel_date(df)
    if bool(opts.get("convert_epoch_timestamps", True)):
        only_ts = opts.get("timestamp_columns")
        if isinstance(only_ts, list) and only_ts:
            df = _maybe_convert_epoch_timestamps(df, [str(x) for x in only_ts])
        else:
            df = _maybe_convert_epoch_timestamps(df, None)
    if bool(opts.get("convert_numeric", True)):
        only = opts.get("numeric_columns")
        only_cols = [str(x) for x in only] if isinstance(only, list) and only else None
        exclude_cols = []
        try:
            exclude_cols.extend([str(x) for x in (df.attrs.get("epoch_timestamp_converted_cols") or [])])
        except Exception:
            pass
        df = _maybe_convert_numeric(df, only_cols, exclude_cols or None)
    return df


def safe_filename(name: str) -> str:
    return _safe_filename(name)
