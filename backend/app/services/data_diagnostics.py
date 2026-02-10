from __future__ import annotations

from typing import Any

import pandas as pd


def diagnose_df(df: pd.DataFrame) -> dict[str, Any]:
    rows = int(df.shape[0])
    cols = int(df.shape[1])
    warnings: list[str] = []

    if rows == 0:
        warnings.append("数据表没有行（可能只有表头）。")
    if cols == 0:
        warnings.append("数据表没有列（无法分析）。")
    if rows > 200000:
        warnings.append("数据行数较大，建议先在数据库侧聚合或抽样。")
    if cols > 200:
        warnings.append("列数较多，建议先筛选关键字段以提升分析质量与速度。")

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
    }

