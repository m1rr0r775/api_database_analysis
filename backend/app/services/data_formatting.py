from __future__ import annotations

from typing import Any

import pandas as pd


def to_preview_records(df: pd.DataFrame, rows: int) -> list[dict[str, Any]]:
    head = df.head(rows).copy()

    for col in head.columns:
        s = head[col]
        if pd.api.types.is_datetime64_any_dtype(s):
            head[col] = s.dt.strftime("%Y-%m-%d %H:%M:%S")
        elif pd.api.types.is_timedelta64_dtype(s):
            head[col] = s.astype("string")
        elif pd.api.types.is_period_dtype(s):
            head[col] = s.astype("string")
        elif pd.api.types.is_object_dtype(s):
            try:
                converted = pd.to_datetime(s, errors="coerce")
                ratio = float(converted.notna().mean()) if len(converted) else 0.0
                if ratio >= 0.85:
                    head[col] = converted.dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                pass

    head = head.where(pd.notna(head), None)
    return head.to_dict(orient="records")
