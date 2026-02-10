from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import inspect

from app.services.db_connections import DbConnection
from app.services.db_query import build_engine


def get_schema(conn: DbConnection, max_tables: int = 200) -> dict[str, Any]:
    engine = build_engine(conn)
    try:
        insp = inspect(engine)
        try:
            schemas = insp.get_schema_names()
        except Exception:
            schemas = []

        default_schema = None
        if conn.kind in ("postgres", "postgresql"):
            default_schema = "public"
        elif conn.kind in ("mysql", "mariadb"):
            default_schema = conn.database

        tables_out: list[dict[str, Any]] = []

        if conn.kind == "sqlite":
            table_names = insp.get_table_names()
            for t in table_names[:max_tables]:
                cols = insp.get_columns(t)
                tables_out.append(
                    {
                        "name": t,
                        "schema": None,
                        "columns": [
                            {
                                "name": c.get("name"),
                                "type": str(c.get("type")),
                                "nullable": bool(c.get("nullable")),
                            }
                            for c in cols
                        ],
                    }
                )
            return {"default_schema": None, "schemas": [], "tables": tables_out}

        target_schema = default_schema
        if target_schema:
            table_names = insp.get_table_names(schema=target_schema)
            for t in table_names[:max_tables]:
                cols = insp.get_columns(t, schema=target_schema)
                tables_out.append(
                    {
                        "name": t,
                        "schema": target_schema,
                        "columns": [
                            {
                                "name": c.get("name"),
                                "type": str(c.get("type")),
                                "nullable": bool(c.get("nullable")),
                            }
                            for c in cols
                        ],
                    }
                )
            return {"default_schema": target_schema, "schemas": schemas, "tables": tables_out}

        table_names = insp.get_table_names()
        for t in table_names[:max_tables]:
            cols = insp.get_columns(t)
            tables_out.append(
                {
                    "name": t,
                    "schema": None,
                    "columns": [
                        {
                            "name": c.get("name"),
                            "type": str(c.get("type")),
                            "nullable": bool(c.get("nullable")),
                        }
                        for c in cols
                    ],
                }
            )
        return {"default_schema": None, "schemas": schemas, "tables": tables_out}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"读取表结构失败: {e}")
    finally:
        try:
            engine.dispose()
        except Exception:
            pass

