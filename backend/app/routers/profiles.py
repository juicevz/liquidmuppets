from __future__ import annotations

from datetime import UTC, datetime

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, HTTPException, Request

from app.schemas import (
    ProfileChallengeRequest,
    ProfileChallengeResponse,
    ProfileClaimRequest,
    WalletProfile,
)

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _normalize_handle(handle: str) -> str:
    return handle.strip().lower().removeprefix("@")


@router.post("/challenge", response_model=ProfileChallengeResponse)
def create_challenge(payload: ProfileChallengeRequest, request: Request) -> ProfileChallengeResponse:
    challenge = request.app.state.database.create_profile_challenge(
        payload.wallet.lower(), _normalize_handle(payload.handle)
    )
    return ProfileChallengeResponse(**challenge)


@router.post("/claim", response_model=WalletProfile)
def claim_profile(payload: ProfileClaimRequest, request: Request) -> WalletProfile:
    database = request.app.state.database
    challenge = database.get_profile_challenge(payload.nonce)
    wallet = payload.wallet.lower()
    handle = _normalize_handle(payload.handle)
    if challenge is None:
        raise HTTPException(status_code=404, detail="profile challenge not found or already used")
    if challenge["wallet"] != wallet or challenge["handle"] != handle:
        raise HTTPException(status_code=400, detail="profile challenge does not match this wallet and handle")
    if datetime.fromisoformat(challenge["expires_at"]) <= datetime.now(UTC):
        raise HTTPException(status_code=410, detail="profile challenge expired")
    try:
        recovered = Account.recover_message(
            encode_defunct(text=challenge["message"]), signature=payload.signature
        ).lower()
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=400, detail="invalid profile signature") from error
    if recovered != wallet:
        raise HTTPException(status_code=403, detail="signature does not belong to this wallet")
    try:
        database.claim_wallet_profile(wallet, handle, payload.nonce)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    profile = database.get_wallet_profile(wallet)
    if profile is None:
        raise HTTPException(status_code=500, detail="profile was not stored")
    return WalletProfile(**profile)


@router.get("/{wallet}", response_model=WalletProfile | None)
def get_profile(wallet: str, request: Request) -> WalletProfile | None:
    if len(wallet) != 42 or not wallet.startswith("0x"):
        raise HTTPException(status_code=422, detail="invalid wallet")
    profile = request.app.state.database.get_wallet_profile(wallet)
    return WalletProfile(**profile) if profile else None
