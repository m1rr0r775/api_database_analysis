from __future__ import annotations

from typing import Any

import pandas as pd


def diagnose_df(df: pd.DataFrame) -> dict[str, Any]:
    rows = int(df.shape[0])
    cols = int(df.shape[1])
    warnings: list[str] = []
    issues: list[dict[str, Any]] = []

    if rows == 0:
        warnings.append("数据表没有行（可能只有表头）。")
        issues.append({"code": "empty_rows", "severity": "high", "message": "数据表没有行", "suggestion": "请检查是否选错了Sheet/导出不完整。"})
    if cols == 0:
        warnings.append("数据表没有列（无法分析）。")
        issues.append({"code": "empty_cols", "severity": "high", "message": "数据表没有列", "suggestion": "请检查是否选错了Sheet/文件内容为空。"})
    if rows > 200000:
        warnings.append("数据行数较大，建议先在数据库侧聚合或抽样。")
        issues.append({"code": "too_many_rows", "severity": "medium", "message": "数据行数较大", "suggestion": "建议先聚合或抽样，减少AI上下文与图表点数压力。"})
    if cols > 200:
        warnings.append("列数较多，建议先筛选关键字段以提升分析质量与速度。")
        issues.append({"code": "too_many_cols", "severity": "medium", "message": "列数较多", "suggestion": "建议先筛选关键字段，避免分析噪音。"})
    try:
        if bool(getattr(df, "attrs", {}).get("mapping_row_removed")):
            warnings.append("检测到首行字段映射行，已自动移除（不影响原文件）。")
            issues.append({"code": "mapping_row_removed", "severity": "medium", "message": "检测到首行字段映射行并已移除", "suggestion": "如不希望移除，可关闭“智能数据整理”或在高级设置中关闭该选项。"})
        if bool(getattr(df, "attrs", {}).get("multilevel_header_flattened")):
            warnings.append("检测到多级表头，已自动扁平化为单行列名（不影响原文件）。")
            issues.append({"code": "multilevel_header", "severity": "medium", "message": "检测到多级表头并已扁平化", "suggestion": "如列名不符合预期，可在高级设置关闭或手动指定表头行。"})
        if bool(getattr(df, "attrs", {}).get("duplicate_headers_renamed")):
            warnings.append("检测到重复列名，已自动重命名避免冲突。")
            issues.append({"code": "dup_headers", "severity": "low", "message": "重复列名已自动重命名", "suggestion": "建议检查含 _2/_3 后缀的列是否应合并。"})
        if bool(getattr(df, "attrs", {}).get("header_whitespace_removed")):
            warnings.append("检测到列名包含多余空格，已自动清理。")
            issues.append({"code": "header_whitespace", "severity": "low", "message": "列名空格已清理", "suggestion": "如需保留原列名展示，可关闭列名清理选项。"})
        er = int(getattr(df, "attrs", {}).get("empty_rows_removed") or 0)
        ec = int(getattr(df, "attrs", {}).get("empty_cols_removed") or 0)
        if er > 0:
            warnings.append(f"已移除完全空白行：{er} 行。")
            issues.append({"code": "blank_rows_removed", "severity": "low", "message": f"已移除空白行 {er} 行", "suggestion": "如需保留空行，可在高级设置关闭该选项。"})
        if ec > 0:
            warnings.append(f"已移除完全空白列：{ec} 列。")
            issues.append({"code": "blank_cols_removed", "severity": "low", "message": f"已移除空白列 {ec} 列", "suggestion": "如需保留空列，可在高级设置关闭该选项。"})
        dt_cols = getattr(df, "attrs", {}).get("excel_date_converted_cols") or []
        if isinstance(dt_cols, list) and dt_cols:
            warnings.append(f"已自动识别并转换日期列：{', '.join([str(x) for x in dt_cols[:6]])}{'…' if len(dt_cols) > 6 else ''}")
        ts_cols = getattr(df, "attrs", {}).get("epoch_timestamp_converted_cols") or []
        if isinstance(ts_cols, list) and ts_cols:
            warnings.append(f"已自动识别并转换时间戳列：{', '.join([str(x) for x in ts_cols[:6]])}{'…' if len(ts_cols) > 6 else ''}")
        num_cols = getattr(df, "attrs", {}).get("numeric_converted_cols") or []
        if isinstance(num_cols, list) and num_cols:
            warnings.append(f"已自动识别并转换数值列：{', '.join([str(x) for x in num_cols[:6]])}{'…' if len(num_cols) > 6 else ''}")
    except Exception:
        pass

    empty_cols: list[str] = []
    try:
        for c in df.columns:
            s = df[c]
            if s.isna().all():
                empty_cols.append(str(c))
    except Exception:
        empty_cols = []

    top_nulls: list[dict[str, Any]] = []
    try:
        if rows > 0:
            ratios = []
            for c in df.columns:
                s = df[c]
                ratio = float(s.isna().mean())
                ratios.append((str(c), ratio))
            ratios.sort(key=lambda x: x[1], reverse=True)
            for name, ratio in ratios[:10]:
                if ratio >= 0.3:
                    top_nulls.append({"column": name, "null_ratio": round(ratio, 4)})
    except Exception:
        top_nulls = []

    dtypes = {}
    try:
        dtypes = {str(k): int(v) for k, v in df.dtypes.astype(str).value_counts().to_dict().items()}
    except Exception:
        dtypes = {}

    return {
        "shape": {"rows": rows, "cols": cols},
        "empty_columns": empty_cols[:30],
        "high_null_ratio": top_nulls,
        "dtypes": dtypes,
        "warnings": warnings,
        "issues": issues,
        "score": _score(warnings, issues, empty_cols, top_nulls, rows, cols),
        "severity": _severity(_score(warnings, issues, empty_cols, top_nulls, rows, cols)),
    }


def _severity(score: int) -> str:
    if score >= 80:
        return "low"
    if score >= 50:
        return "medium"
    return "high"


def _score(
    warnings: list[str],
    issues: list[dict[str, Any]],
    empty_cols: list[str],
    top_nulls: list[dict[str, Any]],
    rows: int,
    cols: int,
) -> int:
    score = 100
    codes = {str(i.get("code")) for i in (issues or [])}
    if "mapping_row_removed" in codes:
        score -= 10
    if "multilevel_header" in codes:
        score -= 15
    if "dup_headers" in codes:
        score -= 5
    if "header_whitespace" in codes:
        score -= 5
    if "blank_rows_removed" in codes:
        score -= 5
    if "blank_cols_removed" in codes:
        score -= 5
    if rows > 200000:
        score -= 10
    if cols > 200:
        score -= 10
    if empty_cols:
        score -= 10
    if top_nulls:
        score -= 5
    return max(0, min(100, int(score)))
