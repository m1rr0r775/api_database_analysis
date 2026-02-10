from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.services.table_io import read_table


@dataclass
class CleanOp:
    id: str
    name: str
    enabled: bool = True
    severity: str = "low"


DEFAULT_OPTIONS: dict[str, Any] = {
    "remove_mapping_row": True,
    "flatten_multilevel_header": True,
    "strip_header_whitespace": True,
    "drop_empty_rows_cols": True,
    "convert_excel_dates": True,
    "convert_numeric": True,
    "convert_epoch_timestamps": True,
    "numeric_columns": [],
    "timestamp_columns": [],
    "fill_merged_cells": True,
    "trim_text_cells": True,
    "pivot_to_long": False,
}


def _merge_options(base: dict[str, Any] | None, override: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(DEFAULT_OPTIONS)
    if isinstance(base, dict):
        out.update({k: base[k] for k in base.keys()})
    if isinstance(override, dict):
        out.update({k: override[k] for k in override.keys()})
    return out


def _fill_merged_cells(df: pd.DataFrame) -> pd.DataFrame:
    d = df
    for c in d.columns:
        s = d[c]
        if pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s):
            try:
                ratio = float(s.isna().mean()) if len(s) else 0.0
                if ratio >= 0.2:
                    d[c] = s.ffill()
            except Exception:
                continue
    return d


def _trim_text_cells(df: pd.DataFrame) -> pd.DataFrame:
    d = df
    for c in d.columns:
        s = d[c]
        if pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s):
            try:
                d[c] = s.astype("string").str.strip()
            except Exception:
                continue
    return d


def _maybe_pivot_to_long(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    if df.shape[1] < 3 or df.shape[0] < 2:
        return df, False
    d = df
    first = d.columns[0]
    other_cols = list(d.columns[1:])
    numeric_like = 0
    for c in other_cols[:50]:
        try:
            ratio = float(pd.to_numeric(d[c], errors="coerce").notna().mean()) if len(d) else 0.0
            if ratio >= 0.8:
                numeric_like += 1
        except Exception:
            continue
    if numeric_like < max(2, int(min(len(other_cols), 10) * 0.6)):
        return df, False
    long_df = d.melt(id_vars=[first], var_name="字段", value_name="值")
    return long_df, True


def build_ops(options: dict[str, Any]) -> list[CleanOp]:
    ops: list[CleanOp] = [
        CleanOp(id="strip_header_whitespace", name="清理列名空格/特殊空白", enabled=bool(options.get("strip_header_whitespace", True))),
        CleanOp(id="flatten_multilevel_header", name="多级表头扁平化", enabled=bool(options.get("flatten_multilevel_header", True)), severity="medium"),
        CleanOp(id="remove_mapping_row", name="移除首行字段映射行", enabled=bool(options.get("remove_mapping_row", True)), severity="medium"),
        CleanOp(id="drop_empty_rows_cols", name="删除完全空白行/列", enabled=bool(options.get("drop_empty_rows_cols", True))),
        CleanOp(id="fill_merged_cells", name="拆分合并单元格（前向填充）", enabled=bool(options.get("fill_merged_cells", True))),
        CleanOp(id="trim_text_cells", name="去除文本前后空格", enabled=bool(options.get("trim_text_cells", True))),
        CleanOp(id="convert_excel_dates", name="识别并转换日期列", enabled=bool(options.get("convert_excel_dates", True))),
        CleanOp(id="convert_numeric", name="识别并转换数值列", enabled=bool(options.get("convert_numeric", True))),
        CleanOp(id="convert_epoch_timestamps", name="识别并转换时间戳列", enabled=bool(options.get("convert_epoch_timestamps", True)), severity="medium"),
        CleanOp(id="pivot_to_long", name="交叉表转换为长表", enabled=bool(options.get("pivot_to_long", False)), severity="medium"),
    ]
    return ops


def apply_smart_clean(file_path: str, *, smart_clean: bool, options: dict[str, Any] | None) -> tuple[pd.DataFrame, dict[str, Any], list[CleanOp]]:
    merged = _merge_options(None, options)
    ops = build_ops(merged)
    enabled = {o.id: o.enabled for o in ops}

    if not smart_clean:
        df = read_table(file_path, smart_clean=False)
        return df, merged, ops

    table_opts = {
        "remove_mapping_row": bool(enabled.get("remove_mapping_row", True)),
        "flatten_multilevel_header": bool(enabled.get("flatten_multilevel_header", True)),
        "strip_header_whitespace": bool(enabled.get("strip_header_whitespace", True)),
        "drop_empty_rows_cols": bool(enabled.get("drop_empty_rows_cols", True)),
        "convert_excel_dates": bool(enabled.get("convert_excel_dates", True)),
        "convert_numeric": bool(enabled.get("convert_numeric", True)),
        "convert_epoch_timestamps": bool(enabled.get("convert_epoch_timestamps", True)),
        "numeric_columns": merged.get("numeric_columns") or [],
        "timestamp_columns": merged.get("timestamp_columns") or [],
    }
    df = read_table(file_path, smart_clean=True, options=table_opts)

    if bool(enabled.get("fill_merged_cells", True)):
        df = _fill_merged_cells(df)
        try:
            df.attrs["merged_cells_filled"] = True
        except Exception:
            pass

    if bool(enabled.get("trim_text_cells", True)):
        df = _trim_text_cells(df)
        try:
            df.attrs["text_trimmed"] = True
        except Exception:
            pass

    if bool(enabled.get("pivot_to_long", False)):
        df2, changed = _maybe_pivot_to_long(df)
        if changed:
            df = df2
            try:
                df.attrs["pivot_to_long"] = True
            except Exception:
                pass

    return df, merged, ops


def new_plan_id() -> str:
    return uuid.uuid4().hex
