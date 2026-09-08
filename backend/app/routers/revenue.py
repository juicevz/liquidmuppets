from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Path, Query, Request

router = APIRouter(tags=["revenue"])


@router.get("/revenue")
def revenue(
    request: Request,
    wallet: str | None = Query(default=None, pattern=r"^0x[a-fA-F0-9]{40}$"),
) -> dict[str, object]:
    return cast(dict[str, object], request.app.state.revenue.read(wallet))


@router.get("/revenue/keys/{key}")
def key_revenue(
    request: Request,
    key: str = Path(pattern=r"^0x[a-fA-F0-9]{40}$"),
    legacy_market: bool = Query(default=False),
) -> dict[str, object]:
    return cast(dict[str, object], request.app.state.revenue.read_key(key, legacy_market=legacy_market))
