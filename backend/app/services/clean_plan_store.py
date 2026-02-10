from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any


@dataclass
class CleanPlan:
    plan_id: str
    session_id: str
    file_id: str
    source_path: str
    created_at: float
    options: dict[str, Any]


_PLANS: dict[str, CleanPlan] = {}


def put_plan(plan: CleanPlan) -> None:
    _PLANS[plan.plan_id] = plan


def get_plan(plan_id: str) -> CleanPlan | None:
    return _PLANS.get(plan_id)


def purge_expired(ttl_seconds: int = 3600) -> None:
    now = time.time()
    expired = [k for k, v in _PLANS.items() if (now - float(v.created_at)) > ttl_seconds]
    for k in expired:
        _PLANS.pop(k, None)

