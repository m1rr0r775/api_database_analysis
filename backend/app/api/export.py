from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Any

from app.services.excel_exporter import workbook_for_chart, workbook_for_dashboard

router = APIRouter()


class ExportChartRequest(BaseModel):
    title: str = ""
    option: Any


class ExportDashboardRequest(BaseModel):
    title: str = ""
    charts: list[ExportChartRequest]


@router.post("/export/chart/")
async def export_chart(req: ExportChartRequest):
    data, filename = workbook_for_chart(req.title, req.option or {})
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/dashboard/")
async def export_dashboard(req: ExportDashboardRequest):
    charts = [{"title": c.title, "option": c.option} for c in req.charts]
    data, filename = workbook_for_dashboard(req.title, charts)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

