from __future__ import annotations

from typing import Any

import pandas as pd


def apply_chart_rules(df: pd.DataFrame, spec: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(spec, dict):
        return spec, []

    notes: list[str] = []
    t = str(spec.get("type", "")).strip().lower()
    x = spec.get("x")
    y = spec.get("y")
    series = spec.get("series")

    if t in ("bar", "stacked_bar", "line", "area", "scatter", "histogram", "boxplot"):
        x_col = str(x[0]).strip() if isinstance(x, (list, tuple)) and x else str(x or "").strip()
        series_col = str(series[0]).strip() if isinstance(series, (list, tuple)) and series else str(series or "").strip()
        y_col = str(y[0]).strip() if isinstance(y, (list, tuple)) and y else str(y or "").strip()

        if x_col and series_col and x_col == series_col:
            new_spec = dict(spec)
            new_spec.pop("series", None)
            notes.append("检测到分组列与X轴列相同，已自动取消分组以避免图表计算冲突。")
            spec = new_spec

        if x_col and y_col and x_col == y_col and str(spec.get("agg") or "").strip().lower() != "count":
            new_spec = dict(spec)
            new_spec["agg"] = "count"
            new_spec["y"] = None
            notes.append("检测到X轴列与数值列相同，已自动改为计数统计以避免聚合冲突。")
            spec = new_spec

    return spec, notes
