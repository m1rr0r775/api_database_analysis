from __future__ import annotations

import os
from typing import Any

import pandas as pd
from fastapi import HTTPException

from app.services.table_io import read_table


def list_excel_sheets(file_path: str, *, max_sheets: int = 20) -> list[dict[str, Any]]:
    path = str(file_path or "").strip()
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    low = path.lower()
    if not low.endswith((".xls", ".xlsx")):
        raise HTTPException(status_code=400, detail="仅支持 Excel 文件")
    try:
        with pd.ExcelFile(path) as xf:
            names = list(xf.sheet_names or [])
    except Exception as e:
        raise HTTPException(status_code=400, detail={"detail": "读取Sheet列表失败", "cause": str(e)})

    out: list[dict[str, Any]] = []
    for idx, name in enumerate(names[: max_sheets]):
        try:
            df = read_table(path, sheet_name=name, smart_clean=False)
            rows, cols = int(df.shape[0]), int(df.shape[1])
            out.append(
                {
                    "index": idx,
                    "name": str(name),
                    "row_count": rows,
                    "col_count": cols,
                    "is_empty": rows < 5 or cols == 0,
                }
            )
        except Exception:
            out.append({"index": idx, "name": str(name), "row_count": 0, "col_count": 0, "is_empty": True})
    if len(names) > max_sheets:
        out.append({"index": -1, "name": f"...(+{len(names) - max_sheets} sheets)", "row_count": 0, "col_count": 0, "is_empty": True})
    return out
