from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

TaskId = Literal[0, 1, 2, 3, 4, 5, 6]
StrategyAction = Literal["allocate", "hold", "recall"]
ExecutionMode = Literal["active", "reserve", "review"]
RadarStatus = Literal["live", "review", "rejected"]
RadarAvailability = Literal["available", "not_exposed", "not_applicable"]


class SafetyGate(BaseModel):
    label: str
    value: str


class RiskPreset(BaseModel):
    id: Literal["defensive", "balanced", "active"]
    max_single_bps: int
    max_daily_bps: int
    max_allocation_bps: int
    cooldown_seconds: int


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
    risk_presets: list[RiskPreset] = Field(default_factory=list)


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


class RadarMetric(BaseModel):
    availability: RadarAvailability
    value: str | None = None
    unit: str | None = None
    detail: str
    source: str


class RadarOracle(BaseModel):
    status: str
    updated_at: datetime | None = None
    age_seconds: int | None = None
    detail: str


class RadarCosts(BaseModel):
    protocol_fee_bps: int
    max_execution_slippage_bps: int | None = None
    estimate: RadarMetric
    detail: str


class MarketRadarRoute(BaseModel):
    id: str
    task_id: TaskId
    task_label: str
    route: str
    asset_address: str | None = None
    asset_symbol: str
    venue: str
    pair: str | None = None
    pool: str | None = None
    market_id: str | None = None
    approved: bool
    read_only: bool
    status: RadarStatus
    reason: str
    health_status: str
    health_detail: str
    observed_at: datetime | None = None
    refresh_failed_at: datetime | None = None
    monitored_muppets: int
    cached_observations: int
    liquidity: RadarMetric
    volume_24h: RadarMetric
    pool_age: RadarMetric
    capacity: RadarMetric
    oracle: RadarOracle
    costs: RadarCosts
    checks: list[SafetyGate]


class MarketRadarResponse(BaseModel):
    generated_at: datetime
    explorer_url: str
    boundary: str
    routes: list[MarketRadarRoute]


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
    rpc_source: Literal["primary", "fallback"]
    rpc_endpoint_count: int
    latest_block: int | None
    contracts_configured: bool
    rwa_reserve_configured: bool
    keeper_configured: bool
    activity_status: Literal["available", "cached", "stale", "unavailable"]


class TokenAccessResponse(BaseModel):
    wallet: str
    feature: Literal["agent_launch"]
    configured: bool
    eligible: bool
    tokenAddress: str | None
    tokenSymbol: str
    minimum: str
    enforcement: Literal["app_and_api", "onchain"]
    decimals: int | None
    balance: str | None
    balanceRaw: str | None
    minimumRaw: str | None
    slotSize: str
    slotSizeRaw: str | None
    slotCount: int | None
    slotsUsed: int | None
    slotsAvailable: int | None
    featuredSlots: int | None
    overCapacity: int | None
    nextSlotThreshold: str | None
    nextSlotThresholdRaw: str | None
    requiredForNextLaunch: str | None
    requiredForNextLaunchRaw: str | None
    reason: Literal[
        "eligible",
        "below_minimum",
        "capacity_full",
        "token_not_configured",
        "access_check_unavailable",
    ]
    source: str


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
    creator: str | None = None
    handle: str | None
    agent_id: int | None = None
    agent_name: str | None = None
    key_symbol: str | None = None
    quantity: str | None = None
    value: str | None = None
    value_symbol: str | None = None
    direction: ActivityDirection


PulseCategory = Literal["muppet", "vault", "keeper", "range", "keys", "reserve"]
PulseSource = Literal["chain", "keeper"]


class PulseItem(BaseModel):
    id: str
    source: PulseSource
    category: PulseCategory
    facets: list[PulseCategory]
    timestamp: datetime
    action: str
    actor: str | None = None
    actor_handle: str | None = None
    creator: str | None = None
    creator_handle: str | None = None
    agent_id: int | None = None
    agent_name: str | None = None
    key_symbol: str | None = None
    quantity: str | None = None
    value: str | None = None
    value_symbol: str | None = None
    direction: ActivityDirection
    reason: str | None = None
    status: str | None = None
    tx_hash: str | None = None
    block_number: int | None = None
    proof_id: str | None = None
    proof_url: str | None = None


class PulseSourceStatus(BaseModel):
    chain: Literal["available", "cached", "stale", "unavailable"]
    keeper: Literal["available"]


class PulseResponse(BaseModel):
    generated_at: datetime
    explorer_url: str
    latest_chain_record_at: datetime | None
    limit: int
    source_status: PulseSourceStatus
    items: list[PulseItem]


ProofKind = Literal[
    "muppet_launch",
    "first_deposit",
    "keeper_action",
    "keeper_daily_summary",
    "range_change",
    "nav_milestone",
    "agent_key_fill",
    "reserve_purchase",
]


class ProofSubject(BaseModel):
    agent_id: int | None
    name: str
    pet_id: int | None
    creator: str | None
    performance_url: str | None


class ProofAsset(BaseModel):
    symbol: str
    address: str | None


class ProofMarketRange(BaseModel):
    status: str
    position_key: str | None
    lower_tick: int
    upper_tick: int
    current_tick: int
    in_range: bool | None


class ProofMarket(BaseModel):
    venue: str
    pair: str | None
    pool: str | None
    market_id: str | None
    range: ProofMarketRange | None
    health_status: str
    health_detail: str
    observed_at: datetime | None


class ProofReceipt(BaseModel):
    state: Literal["confirmed", "no_transaction"]
    tx_hash: str | None
    url: str | None
    block_number: int | None


class ProofFact(BaseModel):
    label: str
    value: str


class ProofCard(BaseModel):
    id: str
    kind: ProofKind
    category_label: str
    title: str
    summary: str
    timestamp: datetime
    action: str
    reason: str | None
    event_count: int
    subject: ProofSubject
    asset: ProofAsset
    market: ProofMarket
    receipt: ProofReceipt
    facts: list[ProofFact]
    token_symbol: str
    token_address: str | None
    public_url: str
    app_url: str
    image_url: str
    share_text: str
    boundary: str
    no_apy_projection: Literal[True]


class ProofListResponse(BaseModel):
    generated_at: datetime
    boundary: str
    items: list[ProofCard]


class CreatorAssetTotal(BaseModel):
    address: str
    symbol: str
    decimals: int
    agent_count: int
    total_assets_raw: str
    deployed_assets_raw: str
    idle_assets_raw: str


class CreatorProfileResponse(BaseModel):
    generated_at: datetime
    explorer_url: str
    wallet: str
    handle: str | None
    profile_claimed_at: datetime | None
    tracking_started_at: datetime | None
    captured_at: datetime | None
    activity_status: Literal["available", "cached", "stale", "unavailable"]
    receipt_count: int | None
    creator_capacity: TokenAccessResponse
    featured_agent_ids: list[int]
    asset_totals: list[CreatorAssetTotal]
    agents: list[dict[str, Any]]
