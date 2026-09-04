from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.schemas import TokenAccessResponse

router = APIRouter(prefix="/access", tags=["access"])


@router.get("/{wallet}", response_model=TokenAccessResponse)
def token_access(wallet: str, request: Request) -> TokenAccessResponse:
    try:
        return TokenAccessResponse(**request.app.state.token_gate.check(wallet))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
