from __future__ import annotations

import re
from typing import Any

import pandas as pd


_DATE_HINT = re.compile(r"(date|time|日期|时间|timestamp|创建|更新|注册|登录|支付|下单)", re.I)
_ID_HINT = re.compile(r"(id|编号|订单|uid|用户|玩家)", re.I)
_AMOUNT_HINT = re.compile(r"(amount|金额|成交|收入|支出|利息|逾期|价格|price|sum|总额)", re.I)
_GEO_HINT = re.compile(r"(省|市|区|县|地址|region|province|city|address)", re.I)


def infer_semantics(df: pd.DataFrame) -> dict[str, Any]:
    cols = [str(c) for c in df.columns]
    col_types: dict[str, str] = {}
    measures: list[str] = []
    dims: list[str] = []
    keys: list[str] = []
    geos: list[str] = []

    for c in cols:
        s = df[c]
        dtype = "text"
        if pd.api.types.is_datetime64_any_dtype(s):
            dtype = "datetime"
        elif pd.api.types.is_numeric_dtype(s):
            dtype = "numeric"
        else:
            try:
                converted = pd.to_datetime(s, errors="coerce")
                if len(converted) and float(converted.notna().mean()) >= 0.85:
                    dtype = "datetime"
                else:
                    num = pd.to_numeric(s, errors="coerce")
                    if len(num) and float(num.notna().mean()) >= 0.85:
                        dtype = "numeric"
            except Exception:
                pass
        col_types[c] = dtype

        if dtype == "numeric":
            measures.append(c)
        elif dtype == "datetime":
            dims.append(c)
        else:
            dims.append(c)

        name = c
        if _GEO_HINT.search(name):
            geos.append(c)
        if _ID_HINT.search(name):
            keys.append(c)
        if _AMOUNT_HINT.search(name) and c not in measures:
            measures.append(c)

    key_candidates: list[str] = []
    try:
        for c in cols:
            s = df[c]
            if len(df) == 0:
                continue
            nunique = int(s.nunique(dropna=True))
            if nunique == len(df) and nunique > 1:
                key_candidates.append(c)
    except Exception:
        key_candidates = []

    return {
        "column_types": col_types,
        "dimensions": list(dict.fromkeys(dims))[:50],
        "measures": list(dict.fromkeys(measures))[:50],
        "geo_columns": list(dict.fromkeys(geos))[:20],
        "key_candidates": list(dict.fromkeys(key_candidates + keys))[:20],
    }

