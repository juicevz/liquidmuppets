from __future__ import annotations

from fastapi import APIRouter

from app.schemas import StrategyPreviewRequest, StrategyPreviewResponse, StrategyTask
from app.services.strategy import list_tasks, preview_strategy

router = APIRouter(tags=["strategies"])


@router.get("/strategies", response_model=list[StrategyTask])
def strategies() -> list[StrategyTask]:
    return list_tasks()


@router.post("/strategies/preview", response_model=StrategyPreviewResponse)
def strategy_preview(payload: StrategyPreviewRequest) -> StrategyPreviewResponse:
    return preview_strategy(payload)

