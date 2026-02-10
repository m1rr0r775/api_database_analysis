import os
import json
import re
import pandas as pd
from fastapi import HTTPException
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from app.core.config import settings
from app.services.table_io import read_table
from typing import Any
from app.services.chart_generator import generate_echarts_option
from app.services.chart_rules import apply_chart_rules

class AIService:
    def __init__(self):
        # Configure LLM based on settings
        self.llm = ChatOpenAI(
            model=settings.AI_MODEL_NAME,
            api_key=settings.AI_API_KEY,
            base_url=settings.AI_BASE_URL,
            temperature=0.2
        )
        
    def _extract_json_object(self, text: str) -> dict | None:
        if not text:
            return None
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            return None
        candidate = match.group(0)
        try:
            return json.loads(candidate)
        except Exception:
            return None

    def analyze_files(self, files: list[dict[str, Any]], user_query: str, history: list[dict[str, Any]] | None = None) -> dict:
        try:
            tables: dict[str, pd.DataFrame] = {}
            context_blocks: list[str] = []
            load_errors: list[str] = []
            for f in files:
                table_key = str(f.get("table", "")).strip()
                file_path = str(f.get("path", "")).strip()
                display_name = str(f.get("name", "")).strip() or table_key

                if not table_key or not file_path:
                    continue

                try:
                    df = read_table(file_path)
                except Exception as e:
                    load_errors.append(f"{display_name}: {e}")
                    continue

                tables[table_key] = df
                columns = df.columns.tolist()
                max_cols = 60
                cols_for_preview = columns[:max_cols]
                preview_df = df[cols_for_preview].head(settings.AI_CONTEXT_ROWS)
                preview = preview_df.to_string()
                data_info = df.dtypes.to_string()
                if len(columns) > max_cols:
                    display_cols = cols_for_preview + [f"...(+{len(columns) - max_cols} cols)"]
                else:
                    display_cols = columns
                context_blocks.append(
                    f"""Table Key: {table_key}
Original Name: {display_name}
Row Count: {len(df)}
Columns: {display_cols}
Data Types:
{data_info}

Data Preview (First {settings.AI_CONTEXT_ROWS} rows):
{preview}
"""
                )

            if not tables:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": "未能读取任何数据表",
                        "hint": "请确认文件未损坏且为 CSV/Excel；如为 CSV 建议使用 UTF-8 编码。也可以先在页面预览确认数据是否可读。",
                        "tables": load_errors[:10],
                    },
                )

            context = "\n---\n".join(context_blocks)

            history_lines: list[str] = []
            for msg in (history or []):
                role = str(msg.get("role", "")).strip()
                content = str(msg.get("content", "")).strip()
                if role in ("user", "assistant") and content:
                    history_lines.append(f"{role}: {content}")
            history_text = "\n".join(history_lines[-20:])
            
            template = """
            You are an expert Data Analyst. You are given multiple tables (each has a Table Key), and a user query.
            
            Tables Context:
            {context}

            Conversation History (may be empty):
            {history}
            
            User Query: {query}
            
            Return ONLY valid JSON with the following schema:
            {{
              "answer": string,
              "need_chart": boolean,
              "chart_spec": object | null,
              "dashboard": {{
                "title": string,
                "charts": [
                  {{
                    "id": string,
                    "title": string,
                    "table": string,
                    "spec": object
                  }}
                ]
              }} | null
            }}
            
            Rules:
            - Use only the provided Table Key values in fields "table".
            - If the user asks for a dashboard or comprehensive analysis, set dashboard with 2-6 charts and keep need_chart=false.
            - Otherwise, if the user asks for visualization, set need_chart=true with chart_spec (and dashboard=null).
            - If no chart is needed, set need_chart=false and chart_spec=null and dashboard=null.
            - chart_spec/spec must be a chart recipe, not raw data. The backend will compute the series from the full data.
            - Supported chart types: bar, stacked_bar, line, area, pie, scatter, histogram, boxplot.
            - For bar/line/area/stacked_bar: use x (category column), y (numeric column), optional series (category), agg (sum/mean/count), optional top_n.
            - For pie: use x as category, y as numeric (or omit y to count), agg (sum/mean/count), optional top_n.
            - For scatter: use x and y numeric, optional series.
            - For histogram: use x numeric, optional bins.
            - For boxplot: use y numeric, optional x category.
            - Do not wrap JSON in markdown fences.
            """
            
            prompt = ChatPromptTemplate.from_template(template)
            chain = prompt | self.llm | StrOutputParser()
            
            response = chain.invoke({
                "context": context,
                "history": history_text,
                "query": user_query
            })

            parsed = self._extract_json_object(response)
            if not isinstance(parsed, dict) or "answer" not in parsed:
                return self._fallback_result(tables=tables, user_query=user_query, answer_text=response)

            answer = str(parsed.get("answer", ""))
            need_chart = bool(parsed.get("need_chart", False))

            chart_option = None
            chart_spec = parsed.get("chart_spec", None)
            if need_chart and isinstance(chart_spec, dict):
                table_key = str(chart_spec.get("table", "")).strip()
                spec = chart_spec.get("spec") if isinstance(chart_spec.get("spec"), dict) else chart_spec
                df = tables.get(table_key)
                if df is not None and isinstance(spec, dict):
                    spec2, notes = apply_chart_rules(df, spec)
                    if notes:
                        answer = (answer + "\n\n" + "\n".join(notes)).strip()
                    chart_option = generate_echarts_option(df, spec2)

            dashboard = None
            if isinstance(parsed.get("dashboard"), dict):
                dash = parsed.get("dashboard") or {}
                charts_out: list[dict[str, Any]] = []
                dash_notes: list[str] = []
                for c in (dash.get("charts") or []):
                    if not isinstance(c, dict):
                        continue
                    table_key = str(c.get("table", "")).strip()
                    spec = c.get("spec")
                    if not isinstance(spec, dict):
                        continue
                    df = tables.get(table_key)
                    if df is None:
                        continue
                    spec2, notes = apply_chart_rules(df, spec)
                    if notes:
                        dash_notes.extend([f"【{str(c.get('title') or '') or table_key}】{n}" for n in notes])
                    option = generate_echarts_option(df, {**spec2, "title": c.get("title")})
                    charts_out.append(
                        {
                            "id": str(c.get("id") or ""),
                            "title": str(c.get("title") or ""),
                            "table": table_key,
                            "option": option,
                        }
                    )
                dashboard = {"title": str(dash.get("title") or ""), "charts": charts_out}
                if dash_notes:
                    answer = (answer + "\n\n" + "\n".join(dash_notes)).strip()

            if (not dashboard or not (dashboard.get("charts") or [])) and self._looks_like_dashboard_request(user_query):
                return self._fallback_result(tables=tables, user_query=user_query, answer_text=answer)

            return {
                "answer": answer,
                "need_chart": need_chart and chart_option is not None,
                "chart_option": chart_option,
                "dashboard": dashboard,
            }

        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            raise HTTPException(
                status_code=500,
                detail={
                    "detail": "AI 分析失败",
                    "hint": "请尝试缩小数据范围（减少列/行）、先做 LIMIT 预览、或更换提问方式（例如先让 AI 描述字段与数据质量）。",
                    "cause": str(e),
                },
            )

    def _looks_like_dashboard_request(self, query: str) -> bool:
        q = (query or "").lower()
        return ("仪表板" in q) or ("dashboard" in q) or ("看板" in q)

    def _fallback_result(self, tables: dict[str, pd.DataFrame], user_query: str, answer_text: str) -> dict:
        if not self._looks_like_dashboard_request(user_query):
            return {"answer": answer_text, "need_chart": False, "chart_option": None, "dashboard": None}

        first_key = next(iter(tables.keys()))
        df = tables[first_key]
        cols = df.columns.tolist()
        numeric_cols = [c for c in cols if pd.api.types.is_numeric_dtype(df[c])]
        cat_cols = [c for c in cols if not pd.api.types.is_numeric_dtype(df[c])]

        charts: list[dict[str, Any]] = []
        if numeric_cols:
            charts.append(
                {
                    "id": "auto_histogram",
                    "title": f"{numeric_cols[0]} 分布",
                    "table": first_key,
                    "option": generate_echarts_option(df, {"type": "histogram", "x": numeric_cols[0], "title": f"{numeric_cols[0]} 分布"}),
                }
            )
        if cat_cols:
            charts.append(
                {
                    "id": "auto_count_bar",
                    "title": f"{cat_cols[0]} 人数统计",
                    "table": first_key,
                    "option": generate_echarts_option(df, {"type": "bar", "x": cat_cols[0], "y": None, "agg": "count", "title": f"{cat_cols[0]} 人数统计"}),
                }
            )
        if numeric_cols and cat_cols:
            charts.append(
                {
                    "id": "auto_boxplot",
                    "title": f"{numeric_cols[0]} 按 {cat_cols[0]} 分布",
                    "table": first_key,
                    "option": generate_echarts_option(df, {"type": "boxplot", "x": cat_cols[0], "y": numeric_cols[0], "title": f"{numeric_cols[0]} 按 {cat_cols[0]} 分布"}),
                }
            )

        dashboard = {"title": "默认综合仪表板（可继续对话调整）", "charts": charts}
        return {"answer": "已生成默认综合仪表板。你可以继续说：换成堆叠柱状图 / 改成蓝色系主题 / 增加相关性分析。", "need_chart": False, "chart_option": None, "dashboard": dashboard}

    def analyze_data(self, file_path: str, user_query: str, history: list[dict[str, Any]] | None = None) -> dict:
        return self.analyze_files(
            files=[{"table": "t1", "name": os.path.basename(file_path), "path": file_path}],
            user_query=user_query,
            history=history,
        )

ai_service = AIService()
