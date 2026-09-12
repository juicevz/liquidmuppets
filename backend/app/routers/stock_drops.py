from __future__ import annotations

from typing import cast

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response

from app.services.stock_drop_manifest import canonical_bytes
from app.services.stock_drops import StockDropService
from app.stock_drop_schemas import StockDropResponse

router = APIRouter(tags=["stock-drops"])


@router.get("/stock-drops", response_model=StockDropResponse)
def stock_drops(
    request: Request,
    response: Response,
    wallet: str | None = Query(default=None, pattern=r"^0x[a-fA-F0-9]{40}$"),
    before: int | None = Query(default=None, ge=0, le=1_000_000_000),
) -> StockDropResponse:
    response.headers["Cache-Control"] = "no-store"
    service = cast(StockDropService, request.app.state.stock_drops)
    return StockDropResponse.model_validate(service.read(wallet, before))


@router.get("/stock-drops/{drop_id}/manifest")
def manifest(request: Request, drop_id: int = Path(ge=0, le=1_000_000_000)) -> Response:
    service = cast(StockDropService, request.app.state.stock_drops)
    try:
        data = canonical_bytes(service.manifest(drop_id))
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=404, detail="Allocation manifest is unavailable.") from error
    return Response(content=data, media_type="application/json", headers={"Cache-Control": "no-store"})
