from __future__ import annotations

import os
import re
from typing import Any

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.services.db_connections import DbConnection
from app.core.config import settings
from app.core.paths import data_dir


_DANGEROUS = re.compile(r"\b(drop|truncate|delete|update|insert|alter|create|grant|revoke)\b", re.IGNORECASE)


def _normalize_sql(sql: str) -> str:
    s = (sql or "").strip()
    while s.endswith(";"):
        s = s[:-1].rstrip()
    return s


def validate_select_only(sql: str) -> str:
    s = _normalize_sql(sql)
    if not s:
        raise HTTPException(status_code=400, detail="SQL 不能为空")
    low = s.lstrip().lower()
    if not (low.startswith("select") or low.startswith("with")):
        raise HTTPException(status_code=400, detail="仅允许执行 SELECT/CTE 查询")
    if ";" in s:
        raise HTTPException(status_code=400, detail="不允许多语句 SQL（包含分号）")
    if _DANGEROUS.search(s):
        raise HTTPException(status_code=400, detail="检测到潜在危险 SQL 关键字，已拦截")
    return s


def build_engine(conn: DbConnection) -> Engine:
    kind = (conn.kind or "").lower()
    timeout_s = int(getattr(settings, "DB_QUERY_TIMEOUT_SECONDS", 15))
    if kind in ("postgres", "postgresql"):
        if not conn.host or not conn.database:
            raise HTTPException(status_code=400, detail="连接配置不完整")
        user = conn.username or ""
        pwd = conn.password or ""
        port = conn.port or 5432
        url = f"postgresql+psycopg2://{user}:{pwd}@{conn.host}:{port}/{conn.database}"
        return create_engine(
            url,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 5, "options": f"-c statement_timeout={timeout_s * 1000}"},
        )
    if kind in ("mysql", "mariadb"):
        if not conn.host or not conn.database:
            raise HTTPException(status_code=400, detail="连接配置不完整")
        user = conn.username or ""
        pwd = conn.password or ""
        port = conn.port or 3306
        url = f"mysql+pymysql://{user}:{pwd}@{conn.host}:{port}/{conn.database}?charset=utf8mb4"
        return create_engine(
            url,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 5, "read_timeout": timeout_s, "write_timeout": timeout_s},
        )
    if kind == "sqlite":
        path = conn.sqlite_path or ""
        if not path:
            raise HTTPException(status_code=400, detail="sqlite_path 不能为空")
        if not os.path.isabs(path):
            path = os.path.join(data_dir(), path)
        url = f"sqlite+pysqlite:///{path}"
        return create_engine(url, pool_pre_ping=True, connect_args={"timeout": timeout_s})
    raise HTTPException(status_code=400, detail=f"暂不支持的数据库类型: {conn.kind}")


def run_query_df(conn: DbConnection, sql: str, limit: int) -> pd.DataFrame:
    safe_sql = validate_select_only(sql)
    limit = int(limit)
    if limit <= 0:
        limit = 1000
    q = safe_sql
    low = q.lower()
    if " limit " not in low and not low.rstrip().endswith("limit"):
        q = f"{q} LIMIT :_limit"
    engine = build_engine(conn)
    try:
        with engine.connect() as c:
            df = pd.read_sql_query(text(q), c, params={"_limit": limit})
        return df
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "查询失败",
                "hint": "请检查 SQL 语法、表/字段名是否存在；也可先用 LIMIT 10 进行小结果预览。",
                "cause": str(e),
            },
        )
    finally:
        try:
            engine.dispose()
        except Exception:
            pass
