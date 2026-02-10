from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from app.core.config import settings


def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        return None


class AICleanAssistant:
    def __init__(self) -> None:
        self.llm = ChatOpenAI(
            model=settings.AI_MODEL_NAME,
            api_key=settings.AI_API_KEY,
            base_url=settings.AI_BASE_URL,
            temperature=0.1,
        )

    def instruction_to_options(self, instruction: str, current_options: dict[str, Any]) -> dict[str, Any]:
        if not (settings.AI_API_KEY or "").strip():
            raise HTTPException(status_code=400, detail={"detail": "未配置 AI_API_KEY，无法使用自然语言整理指令", "hint": "请在 backend/.env 配置 AI_API_KEY"})

        template = """
你是数据整理助手。用户会用自然语言描述整理规则，你需要把它转换为 clean_options（JSON 对象），并解释原因。

当前 clean_options：
{options}

用户指令：
{instruction}

仅返回 JSON：
{{
  "options": object,
  "explain": string
}}
"""
        prompt = ChatPromptTemplate.from_template(template)
        chain = prompt | self.llm | StrOutputParser()
        out = chain.invoke({"options": json.dumps(current_options or {}, ensure_ascii=False), "instruction": instruction})
        parsed = _extract_json(out) or {}
        options = parsed.get("options")
        if not isinstance(options, dict):
            raise HTTPException(status_code=400, detail={"detail": "AI 未能生成有效的整理选项", "hint": "请换一种说法，例如“关闭移除映射行、保留空列”。"})
        return {"options": options, "explain": str(parsed.get("explain") or "").strip()}

    def infer_semantics(self, columns: list[str], sample_rows: list[dict[str, Any]]) -> dict[str, Any]:
        if not (settings.AI_API_KEY or "").strip():
            raise HTTPException(status_code=400, detail={"detail": "未配置 AI_API_KEY，无法使用语义理解", "hint": "请在 backend/.env 配置 AI_API_KEY"})

        template = """
你是数据建模专家。根据列名与少量样例行，推断字段语义与建议。

列名：
{columns}

样例行（最多 5 行）：
{rows}

仅返回 JSON：
{{
  "column_semantics": {{ "col": "语义说明" }},
  "dimensions": [string],
  "measures": [string],
  "key_candidates": [string],
  "relations_hint": [string]
}}
"""
        prompt = ChatPromptTemplate.from_template(template)
        chain = prompt | self.llm | StrOutputParser()
        out = chain.invoke({"columns": json.dumps(columns, ensure_ascii=False), "rows": json.dumps(sample_rows[:5], ensure_ascii=False)})
        parsed = _extract_json(out) or {}
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail={"detail": "AI 语义理解失败", "hint": "请稍后重试或缩小样本。"})
        return parsed


ai_clean_assistant = AICleanAssistant()

