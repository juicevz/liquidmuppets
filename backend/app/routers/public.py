from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from web3 import Web3

from app.schemas import CreatorProfileResponse, PulseCategory, PulseResponse

router = APIRouter(tags=["public records"])


@router.get("/creators/{wallet}", response_model=CreatorProfileResponse)
def creator_profile(wallet: str, request: Request) -> CreatorProfileResponse:
    if not Web3.is_address(wallet):
        raise HTTPException(status_code=422, detail="invalid wallet")
    result = request.app.state.public_data.get_creator_profile(wallet)
    return CreatorProfileResponse.model_validate(result)


@router.get("/pulse", response_model=PulseResponse)
def system_pulse(
    request: Request,
    limit: int = Query(default=100, ge=1, le=200),
    category: PulseCategory | None = None,
    creator: str | None = None,
    agent_id: int | None = Query(default=None, ge=0),
) -> PulseResponse:
    if creator is not None and not Web3.is_address(creator):
        raise HTTPException(status_code=422, detail="invalid creator wallet")
    result = request.app.state.public_data.get_pulse(
        limit=limit,
        category=category,
        creator=Web3.to_checksum_address(creator) if creator else None,
        agent_id=agent_id,
    )
    return PulseResponse.model_validate(result)
