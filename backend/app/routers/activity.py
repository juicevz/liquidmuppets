from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.schemas import ActivityItem

router = APIRouter(tags=["activity"])


@router.get("/activity", response_model=list[ActivityItem])
def activity(
    request: Request,
    limit: int = Query(default=40, ge=1, le=200),
    agent_id: int | None = Query(default=None, ge=0),
) -> list[ActivityItem]:
    rows = (
        request.app.state.activity.list_agent_activity(agent_id, limit)
        if agent_id is not None
        else request.app.state.activity.list_activity(limit)
    )
    profiles = request.app.state.database.get_wallet_profiles([str(row["actor"]) for row in rows])
    return [ActivityItem(**row, handle=profiles.get(str(row["actor"]).lower())) for row in rows]
