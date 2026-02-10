from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd


MAX_CATEGORY_POINTS = 200
MAX_SERIES = 30
MAX_SCATTER_POINTS = 3000
MAX_PIE_SLICES = 30


def _safe_top_n(df: pd.DataFrame, top_n: int | None) -> pd.DataFrame:
    if not top_n or top_n <= 0:
        return df
    return df.head(int(top_n))


def _to_numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")

def _normalize_col(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        v = value.strip()
        return v or None
    if isinstance(value, (list, tuple)):
        if not value:
            return None
        first = value[0]
        if isinstance(first, str):
            v = first.strip()
            return v or None
        return str(first) if first is not None else None
    return str(value)

def _maybe_datetime(series: pd.Series) -> tuple[pd.Series, bool]:
    if pd.api.types.is_datetime64_any_dtype(series):
        return series, True
    if pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series):
        try:
            converted = pd.to_datetime(series, errors="coerce")
            ratio = float(converted.notna().mean()) if len(converted) else 0.0
            if ratio >= 0.85:
                return converted, True
        except Exception:
            return series, False
    return series, False

def _dt_to_iso(series: pd.Series) -> list[str]:
    s = pd.to_datetime(series, errors="coerce")
    return s.dt.strftime("%Y-%m-%d %H:%M:%S").fillna("").tolist()

def _safe_metric_name(keys: list[str], value_col: str) -> str:
    name = value_col or "_metric_"
    if name in keys:
        name = "_metric_"
        i = 1
        while name in keys:
            i += 1
            name = f"_metric_{i}_"
    return name


def _sample_step(n: int, limit: int) -> int:
    if n <= limit:
        return 1
    return int(np.ceil(n / float(limit)))


def generate_echarts_option(df: pd.DataFrame, spec: dict[str, Any]) -> dict[str, Any]:
    chart_type = str(spec.get("type", "")).strip().lower()
    x_col = _normalize_col(spec.get("x"))
    y_col = _normalize_col(spec.get("y"))
    series_col = _normalize_col(spec.get("series"))
    agg = str(spec.get("agg", "sum")).strip().lower() if spec.get("agg") else "sum"
    top_n = spec.get("top_n")

    title = str(spec.get("title", "")).strip()

    if chart_type in ("bar", "stacked_bar", "line", "area"):
        if not x_col or (not y_col and agg != "count"):
            return {"title": {"text": title or "Invalid chart spec"}, "series": []}

        d = df.copy()
        if x_col not in d.columns:
            return {"title": {"text": title or "Invalid column"}, "series": []}
        if series_col and series_col == x_col:
            series_col = None
        d[x_col], x_is_dt = _maybe_datetime(d[x_col])

        if agg == "count":
            d["_value_"] = 1
            value_col = "_value_"
        else:
            value_col = y_col
            try:
                d[value_col] = _to_numeric(d[value_col])
            except Exception:
                return {"title": {"text": title or "Invalid numeric column"}, "series": []}

        if series_col:
            if series_col not in d.columns:
                return {"title": {"text": title or "Invalid column"}, "series": []}
            keys = [x_col, series_col]
            metric_col = _safe_metric_name(keys, value_col)
            try:
                agg_series = d.groupby(keys, dropna=False)[value_col].agg("count" if agg == "count" else agg)
                grouped = agg_series.reset_index(name=metric_col)
            except ValueError:
                series_col = None
                grouped = None
            series_list: list[dict[str, Any]] = []
            if grouped is None:
                pass
            elif x_is_dt and chart_type in ("line", "area"):
                grouped = grouped.sort_values(x_col)
                for name, g in grouped.groupby(series_col):
                    xs = _dt_to_iso(g[x_col])
                    ys = g[metric_col].fillna(0).tolist()
                    step = _sample_step(len(xs), MAX_CATEGORY_POINTS * 5)
                    if step > 1:
                        xs = xs[::step]
                        ys = ys[::step]
                    series_list.append(
                        {
                            "name": str(name),
                            "type": "line",
                            "areaStyle": {} if chart_type == "area" else None,
                            "data": [[x, y] for x, y in zip(xs, ys) if x],
                        }
                    )
                for s in series_list:
                    if s.get("areaStyle") is None:
                        s.pop("areaStyle", None)
                return {
                    "title": {"text": title or f"{y_col} by {x_col}"},
                    "tooltip": {"trigger": "axis"},
                    "legend": {"type": "scroll"},
                    "xAxis": {"type": "time"},
                    "yAxis": {"type": "value"},
                    "series": series_list,
                }

            if grouped is not None:
                pivot = grouped.pivot(index=x_col, columns=series_col, values=metric_col).fillna(0)
                if pivot.shape[1] > MAX_SERIES:
                    sums = pivot.sum(axis=0).sort_values(ascending=False)
                    keep = list(sums.index[:MAX_SERIES])
                    other_cols = [c for c in pivot.columns if c not in set(keep)]
                    if other_cols:
                        pivot["其他"] = pivot[other_cols].sum(axis=1)
                    pivot = pivot[keep + (["其他"] if other_cols else [])]
                if pivot.shape[0] > MAX_CATEGORY_POINTS:
                    row_sums = pivot.sum(axis=1).sort_values(ascending=False)
                    pivot = pivot.loc[row_sums.index[:MAX_CATEGORY_POINTS]]
                pivot = pivot.sort_index()
                x_vals = pivot.index.astype(str).tolist()
                for col in pivot.columns:
                    series_list.append(
                        {
                            "name": str(col),
                            "type": "bar" if chart_type in ("bar", "stacked_bar") else "line",
                            "stack": "total" if chart_type == "stacked_bar" else None,
                            "areaStyle": {} if chart_type == "area" else None,
                            "data": pivot[col].tolist(),
                        }
                    )
                for s in series_list:
                    if s.get("stack") is None:
                        s.pop("stack", None)
                    if s.get("areaStyle") is None:
                        s.pop("areaStyle", None)
                option = {
                    "title": {"text": title or f"{y_col} by {x_col}"},
                    "tooltip": {"trigger": "axis"},
                    "legend": {"type": "scroll"},
                    "xAxis": {"type": "category", "data": x_vals},
                    "yAxis": {"type": "value"},
                    "series": series_list,
                }
                return option
            series_col = None

        keys = [x_col]
        metric_col = _safe_metric_name(keys, value_col)
        try:
            grouped = d.groupby(x_col, dropna=False)[value_col].agg("count" if agg == "count" else agg).reset_index(name=metric_col)
        except ValueError:
            return {"title": {"text": title or "Invalid chart spec"}, "series": []}
        if x_is_dt and chart_type in ("line", "area"):
            grouped = grouped.sort_values(x_col)
            xs = _dt_to_iso(grouped[x_col])
            ys = grouped[metric_col].fillna(0).tolist()
            step = _sample_step(len(xs), MAX_CATEGORY_POINTS * 5)
            if step > 1:
                xs = xs[::step]
                ys = ys[::step]
            return {
                "title": {"text": title or (f"{agg}({y_col}) by {x_col}" if agg != "count" else f"count by {x_col}")},
                "tooltip": {"trigger": "axis"},
                "xAxis": {"type": "time"},
                "yAxis": {"type": "value"},
                "series": [
                    {
                        "type": "line",
                        "areaStyle": {} if chart_type == "area" else None,
                        "data": [[x, y] for x, y in zip(xs, ys) if x],
                    }
                ],
            }

        grouped = grouped.sort_values(metric_col, ascending=False)
        grouped[x_col] = grouped[x_col].astype(str)
        grouped = _safe_top_n(grouped, int(top_n) if top_n else None)
        if grouped.shape[0] > MAX_CATEGORY_POINTS:
            grouped = grouped.head(MAX_CATEGORY_POINTS)

        option = {
            "title": {"text": title or (f"{agg}({y_col}) by {x_col}" if agg != "count" else f"count by {x_col}")},
            "tooltip": {"trigger": "axis"},
            "xAxis": {"type": "category", "data": grouped[x_col].tolist()},
            "yAxis": {"type": "value"},
            "series": [
                {
                    "type": "bar" if chart_type in ("bar", "stacked_bar") else "line",
                    "areaStyle": {} if chart_type == "area" else None,
                    "data": grouped[metric_col].fillna(0).tolist(),
                }
            ],
        }
        if option["series"][0].get("areaStyle") is None:
            option["series"][0].pop("areaStyle", None)
        return option

    if chart_type == "pie":
        if not x_col:
            return {"title": {"text": title or "Invalid chart spec"}, "series": []}

        d = df.copy()
        value_col = y_col
        if value_col:
            try:
                d[value_col] = _to_numeric(d[value_col])
            except Exception:
                value_col = None
        if not value_col or agg == "count":
            d["_value_"] = 1
            value_col = "_value_"
            agg = "sum"

        keys = [x_col]
        metric_col = _safe_metric_name(keys, value_col)
        try:
            grouped = d.groupby(x_col, dropna=False)[value_col].agg(agg).reset_index(name=metric_col).sort_values(metric_col, ascending=False)
        except ValueError:
            return {"title": {"text": title or "Invalid chart spec"}, "series": []}
        grouped[x_col] = grouped[x_col].astype(str)
        grouped = _safe_top_n(grouped, int(top_n) if top_n else None)
        if grouped.shape[0] > MAX_PIE_SLICES:
            head = grouped.head(MAX_PIE_SLICES).copy()
            tail = grouped.iloc[MAX_PIE_SLICES:]
            other_sum = float(tail[metric_col].fillna(0).sum())
            if other_sum > 0:
                head.loc[len(head)] = {x_col: "其他", metric_col: other_sum}
            grouped = head

        option = {
            "title": {
                "text": title or (f"{agg}({y_col}) by {x_col}" if y_col else f"count by {x_col}"),
                "left": "center",
                "top": 8,
            },
            "tooltip": {"trigger": "item"},
            "legend": {
                "type": "scroll",
                "orient": "vertical",
                "right": 8,
                "top": 40,
                "bottom": 12,
            },
            "series": [
                {
                    "type": "pie",
                    "radius": ["40%", "70%"],
                    "center": ["35%", "58%"],
                    "data": [
                        {"name": n, "value": v}
                        for n, v in zip(grouped[x_col].tolist(), grouped[metric_col].fillna(0).tolist())
                    ],
                }
            ],
        }
        return option

    if chart_type == "scatter":
        if not x_col or not y_col:
            return {"title": {"text": title or "Invalid chart spec"}, "series": []}

        d = df.copy()
        try:
            d[x_col] = _to_numeric(d[x_col])
            d[y_col] = _to_numeric(d[y_col])
        except Exception:
            return {"title": {"text": title or "Invalid numeric column"}, "series": []}
        d = d.dropna(subset=[x_col, y_col])
        if len(d) > MAX_SCATTER_POINTS:
            d = d.sample(n=MAX_SCATTER_POINTS, random_state=0)

        if series_col and series_col in d.columns:
            series_list: list[dict[str, Any]] = []
            groups = list(d.groupby(series_col))
            if len(groups) > MAX_SERIES:
                groups.sort(key=lambda kv: len(kv[1]), reverse=True)
                groups = groups[:MAX_SERIES]
            per_group = max(50, int(MAX_SCATTER_POINTS / max(1, len(groups))))
            for name, g in groups:
                if len(g) > per_group:
                    g = g.sample(n=per_group, random_state=0)
                series_list.append(
                    {
                        "name": str(name),
                        "type": "scatter",
                        "data": g[[x_col, y_col]].values.tolist(),
                    }
                )
            return {
                "title": {"text": title or f"{y_col} vs {x_col}"},
                "tooltip": {"trigger": "item"},
                "legend": {"type": "scroll"},
                "xAxis": {"type": "value", "name": str(x_col)},
                "yAxis": {"type": "value", "name": str(y_col)},
                "series": series_list,
            }

        return {
            "title": {"text": title or f"{y_col} vs {x_col}"},
            "tooltip": {"trigger": "item"},
            "xAxis": {"type": "value", "name": str(x_col)},
            "yAxis": {"type": "value", "name": str(y_col)},
            "series": [{"type": "scatter", "data": d[[x_col, y_col]].values.tolist()}],
        }

    if chart_type == "histogram":
        if not x_col:
            return {"title": {"text": title or "Invalid chart spec"}, "series": []}

        try:
            s = _to_numeric(df[x_col]).dropna()
        except Exception:
            return {"title": {"text": title or "Invalid numeric column"}, "series": []}
        if s.empty:
            return {"title": {"text": title or "No numeric data"}, "series": []}
        bins = int(spec.get("bins", 20) or 20)
        counts, edges = np.histogram(s.values, bins=bins)
        labels = [f"{edges[i]:.2f}-{edges[i+1]:.2f}" for i in range(len(edges) - 1)]
        return {
            "title": {"text": title or f"{x_col} histogram"},
            "tooltip": {"trigger": "axis"},
            "xAxis": {"type": "category", "data": labels, "axisLabel": {"interval": 1, "rotate": 45}},
            "yAxis": {"type": "value"},
            "series": [{"type": "bar", "data": counts.tolist()}],
        }

    if chart_type == "boxplot":
        if not y_col:
            return {"title": {"text": title or "Invalid chart spec"}, "series": []}

        d = df.copy()
        try:
            d[y_col] = _to_numeric(d[y_col])
        except Exception:
            return {"title": {"text": title or "Invalid numeric column"}, "series": []}
        d = d.dropna(subset=[y_col])
        if d.empty:
            return {"title": {"text": title or "No numeric data"}, "series": []}

        if x_col and x_col in d.columns:
            categories: list[str] = []
            data: list[list[float]] = []
            groups = list(d.groupby(x_col))
            if len(groups) > MAX_CATEGORY_POINTS:
                groups.sort(key=lambda kv: len(kv[1]), reverse=True)
                groups = groups[:MAX_CATEGORY_POINTS]
            for name, g in groups:
                values = g[y_col].dropna().values
                if len(values) == 0:
                    continue
                q1 = float(np.percentile(values, 25))
                q2 = float(np.percentile(values, 50))
                q3 = float(np.percentile(values, 75))
                low = float(np.min(values))
                high = float(np.max(values))
                categories.append(str(name))
                data.append([low, q1, q2, q3, high])
            return {
                "title": {"text": title or f"{y_col} boxplot by {x_col}"},
                "tooltip": {"trigger": "item"},
                "xAxis": {"type": "category", "data": categories},
                "yAxis": {"type": "value"},
                "series": [{"type": "boxplot", "data": data}],
            }

        values = d[y_col].values
        q1 = float(np.percentile(values, 25))
        q2 = float(np.percentile(values, 50))
        q3 = float(np.percentile(values, 75))
        low = float(np.min(values))
        high = float(np.max(values))
        return {
            "title": {"text": title or f"{y_col} boxplot"},
            "tooltip": {"trigger": "item"},
            "xAxis": {"type": "category", "data": [str(y_col)]},
            "yAxis": {"type": "value"},
            "series": [{"type": "boxplot", "data": [[low, q1, q2, q3, high]]}],
        }

    return {"title": {"text": title or f"Unsupported chart type: {chart_type}"}, "series": []}
