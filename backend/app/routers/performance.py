from __future__ import annotations

from typing import cast

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(tags=["performance"])


@router.get("/marketplace/performance")
def marketplace_performance(request: Request) -> dict[str, object]:
    return cast(dict[str, object], request.app.state.performance.get_marketplace_performance())


@router.get("/agents/{agent_id}/performance")
def agent_performance(agent_id: int, request: Request) -> dict[str, object]:
    if agent_id < 0:
        raise HTTPException(status_code=404, detail="Muppet not found")
    try:
        return cast(dict[str, object], request.app.state.performance.get_agent_performance(agent_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail="Muppet not found") from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="Performance evidence is temporarily unavailable") from error
