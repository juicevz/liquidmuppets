from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

TaskId = Literal[0, 1, 2]
StrategyAction = Literal["allocate", "hold", "recall"]
ExecutionMode = Literal["active", "reserve"]


class SafetyGate(BaseModel):
    label: str
    value: str


class StrategyTask(BaseModel):
    id: TaskId
    slug: str
    label: str
    deposit_asset: str
    share_prefix: str
    production_route: str
    testnet_route: str
    target_allocation_bps: int
    protocol_fee_bps: int
    live: bool
    execution_mode: ExecutionMode
    execution_note: str
    safety_gates: list[SafetyGate]


class PoolCandidate(BaseModel):
    id: str = Field(min_length=2, max_length=80)
    venue: str = Field(min_length=2, max_length=80)
    allowed: bool = False
    liquidity_usd: float = Field(ge=0)
    estimated_net_apy_bps: int = Field(ge=-100_000, le=100_000)
    oracle_age_seconds: int = Field(ge=0)
    utilization_bps: int | None = Field(default=None, ge=0, le=10_000)
    pool_age_seconds: int | None = Field(default=None, ge=0)
    volume_24h_usd: float | None = Field(default=None, ge=0)


class StrategyPreviewRequest(BaseModel):
    task_id: TaskId
    total_assets: int = Field(ge=0)
    idle_assets: int = Field(ge=0)
    deployed_assets: int = Field(ge=0)
    vault_value_usd: float | None = Field(default=None, ge=0)
    candidates: list[PoolCandidate] = Field(default_factory=list, max_length=20)

    @field_validator("idle_assets", "deployed_assets")
    @classmethod
    def integer_asset_values(cls, value: int) -> int:
        if isinstance(value, bool):
            raise ValueError("asset values must be integers")
        return value


class CandidateDecision(BaseModel):
    id: str
    accepted: bool
    score: int
    reasons: list[str]


class StrategyPreviewResponse(BaseModel):
    task: StrategyTask
    action: StrategyAction
    amount: int
    target_deployed_assets: int
    selected_pool_id: str | None
    reason: str
    candidates: list[CandidateDecision]


class KeeperRunRequest(BaseModel):
    vault: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")


class KeeperRunResponse(BaseModel):
    vault: str
    action: StrategyAction
    amount: int
    reason: str
    tx_hash: str | None
    status: str


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    environment: str
    chain_id: int
    chain_name: str
    rpc_connected: bool
    latest_block: int | None
    contracts_configured: bool
    keeper_configured: bool


class ProfileChallengeRequest(BaseModel):
    wallet: str = Field(pattern=r"^0x[a-fA-F0-9]{40}$")
    handle: str = Field(pattern=r"^@?[a-zA-Z0-9_]{3,20}$")


class ProfileChallengeResponse(BaseModel):
    nonce: str
    message: str
    expires_at: datetime


class ProfileClaimRequest(ProfileChallengeRequest):
    nonce: str = Field(min_length=20, max_length=80)
    signature: str = Field(pattern=r"^(?:0x)?[a-fA-F0-9]{130}$")


class WalletProfile(BaseModel):
    wallet: str
    handle: str
    created_at: datetime
    updated_at: datetime


ActivityDirection = Literal["positive", "negative", "neutral"]


class ActivityItem(BaseModel):
    id: str
    tx_hash: str
    block_number: int
    timestamp: datetime
    action: str
    actor: str
    handle: str | None
    agent_id: int | None = None
    agent_name: str | None = None
    key_symbol: str | None = None
    quantity: str | None = None
    value: str | None = None
    value_symbol: str | None = None
    direction: ActivityDirection
