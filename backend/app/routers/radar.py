from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas import MarketRadarResponse
from app.services.market_radar import build_market_radar

router = APIRouter(tags=["market-radar"])


@router.get("/market-radar", response_model=MarketRadarResponse)
def market_radar(request: Request) -> MarketRadarResponse:
    return build_market_radar(
        request.app.state.database.list_marketplace_performance(),
        explorer_url=request.app.state.settings.explorer_url,
    )
