from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Query, Request

router = APIRouter(tags=["revenue"])


@router.get("/revenue")
def revenue(
    request: Request,
    wallet: str | None = Query(default=None, pattern=r"^0x[a-fA-F0-9]{40}$"),
) -> dict[str, object]:
    return cast(dict[str, object], request.app.state.revenue.read(wallet))
