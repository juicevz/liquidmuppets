from __future__ import annotations

from dataclasses import dataclass

from app.schemas import (
    CandidateDecision,
    PoolCandidate,
    RiskPreset,
    SafetyGate,
    StrategyPreviewRequest,
    StrategyPreviewResponse,
    StrategyTask,
)

RANGE_PRESETS = [
    RiskPreset(
        id="defensive",
        max_single_bps=2_000,
        max_daily_bps=3_000,
        max_allocation_bps=6_000,
        cooldown_seconds=86_400,
    ),
    RiskPreset(
        id="balanced",
        max_single_bps=3_500,
        max_daily_bps=5_000,
        max_allocation_bps=7_500,
        cooldown_seconds=43_200,
    ),
    RiskPreset(
        id="active",
        max_single_bps=5_000,
        max_daily_bps=7_500,
        max_allocation_bps=8_500,
        cooldown_seconds=21_600,
    ),
]

TASKS: dict[int, StrategyTask] = {
    0: StrategyTask(
        id=0,
        slug="stable-yield",
        label="Stable yield",
        deposit_asset="USDG",
        share_prefix="mUSDG",
        production_route="Morpho Blue USDe / USDG market c845…cddd6",
        testnet_route="LiquidMuppets USDG test pool",
        target_allocation_bps=9_000,
        protocol_fee_bps=0,
        live=True,
        execution_mode="active",
        execution_note="USDG can be allocated into the fixed Morpho market now.",
        safety_gates=[
            SafetyGate(label="route", value="immutable Morpho market c845…cddd6"),
            SafetyGate(label="market supply", value="at least 10,000,000 USDG onchain"),
            SafetyGate(label="utilization", value="95% maximum onchain"),
            SafetyGate(label="oracle", value="must return a nonzero price"),
            SafetyGate(label="vault cap", value="10,000 USDG per vault"),
        ],
    ),
    1: StrategyTask(
        id=1,
        slug="eth-range",
        label="ETH range",
        deposit_asset="WETH",
        share_prefix="mETH",
        production_route="EZManager position in canonical Uniswap WETH / USDG 0.01% pool",
        testnet_route="EZManager WETH / USDG range fork",
        target_allocation_bps=8_500,
        protocol_fee_bps=40,
        live=True,
        execution_mode="active",
        execution_note="WETH can open a separately-accounted concentrated range now.",
        safety_gates=[
            SafetyGate(label="idle reserve", value="at least 15% WETH"),
            SafetyGate(label="venue", value="canonical WETH / USDG 0.01% Uniswap pool"),
            SafetyGate(label="range", value="about 12.7% either side of its opening price"),
            SafetyGate(label="execution", value="3% maximum swap slippage; 6 hour cycle cooldown"),
            SafetyGate(label="vault cap", value="1 WETH per vault while unaudited"),
        ],
        risk_presets=RANGE_PRESETS,
    ),
    2: StrategyTask(
        id=2,
        slug="launch-liquidity",
        label="Launch pool",
        deposit_asset="WETH",
        share_prefix="mLAUNCH",
        production_route="isolated WETH launch reserve",
        testnet_route="isolated WETH launch reserve",
        target_allocation_bps=1_000,
        protocol_fee_bps=0,
        live=True,
        execution_mode="reserve",
        execution_note="Up to 10% can be staged as recallable WETH in the isolated reserve.",
        safety_gates=[
            SafetyGate(label="idle reserve", value="at least 90% WETH"),
            SafetyGate(label="staging cap", value="10% of vault assets"),
            SafetyGate(label="vault cap", value="0.25 WETH per vault while unaudited"),
            SafetyGate(label="asset behavior", value="no external pool execution"),
        ],
    ),
    3: StrategyTask(
        id=3,
        slug="aapl-usdg-range",
        label="AAPL range",
        deposit_asset="USDG",
        share_prefix="mAAPL",
        production_route="candidate AAPL / USDG 0.05% pool 0xAae0…2d6D",
        testnet_route="AAPL / USDG mainnet-fork review",
        target_allocation_bps=6_000,
        protocol_fee_bps=40,
        live=False,
        execution_mode="review",
        execution_note=(
            "FactoryV2 support is implemented. Activation waits for EZManager pool approval and fork review."
        ),
        safety_gates=[
            SafetyGate(label="pool", value="exact AAPL / USDG pool and 0.05% fee"),
            SafetyGate(label="oracle", value="positive, complete and no older than 3 days"),
            SafetyGate(label="venue", value="must be approved and not deprecated by EZManager"),
            SafetyGate(label="vault cap", value="2,500 USDG per vault after approval"),
            SafetyGate(label="status", value="disabled until the route passes fork tests"),
        ],
        risk_presets=RANGE_PRESETS,
    ),
    4: StrategyTask(
        id=4,
        slug="nvda-usdg-range",
        label="NVDA range",
        deposit_asset="USDG",
        share_prefix="mNVDA",
        production_route="candidate NVDA / USDG 0.05% pool 0xd4EB…14a3",
        testnet_route="NVDA / USDG mainnet-fork review",
        target_allocation_bps=7_500,
        protocol_fee_bps=40,
        live=False,
        execution_mode="review",
        execution_note=(
            "The pool is venue-allowlisted and its adapter exit passed a mainnet-fork test. Activation waits for "
            "FactoryV2 verification and multisig approval."
        ),
        safety_gates=[
            SafetyGate(label="pool", value="exact NVDA / USDG pool and 0.05% fee"),
            SafetyGate(label="oracle", value="positive, complete and no older than 3 days"),
            SafetyGate(label="venue", value="approved and not deprecated by EZManager"),
            SafetyGate(label="vault cap", value="2,500 USDG per vault"),
            SafetyGate(label="exit path", value="full deposit, allocation and redemption passed on a mainnet fork"),
            SafetyGate(label="status", value="disabled until the verified FactoryV2 migration is approved"),
        ],
        risk_presets=RANGE_PRESETS,
    ),
    5: StrategyTask(
        id=5,
        slug="spy-usdg-range",
        label="SPY range",
        deposit_asset="USDG",
        share_prefix="mSPY",
        production_route="candidate SPY / USDG 0.05% pool 0xa7Bb…9167",
        testnet_route="SPY / USDG mainnet-fork review",
        target_allocation_bps=6_000,
        protocol_fee_bps=40,
        live=False,
        execution_mode="review",
        execution_note=(
            "FactoryV2 support is implemented. Activation waits for EZManager pool approval and fork review."
        ),
        safety_gates=[
            SafetyGate(label="pool", value="exact SPY / USDG pool and 0.05% fee"),
            SafetyGate(label="oracle", value="positive, complete and no older than 3 days"),
            SafetyGate(label="venue", value="must be approved and not deprecated by EZManager"),
            SafetyGate(label="vault cap", value="2,500 USDG per vault after approval"),
            SafetyGate(label="status", value="disabled until the route passes fork tests"),
        ],
        risk_presets=RANGE_PRESETS,
    ),
    6: StrategyTask(
        id=6,
        slug="screened-meme-weth-range",
        label="Meme range",
        deposit_asset="USDG",
        share_prefix="mMEME",
        production_route="candidate meme / WETH pool selected through FactoryV2 review",
        testnet_route="candidate pool mainnet-fork review",
        target_allocation_bps=6_000,
        protocol_fee_bps=40,
        live=False,
        execution_mode="review",
        execution_note=(
            "No meme pool is approved. A route needs liquidity, age, volume, oracle and exit-path evidence first."
        ),
        safety_gates=[
            SafetyGate(label="liquidity", value="at least $250,000 and 5x intended vault value"),
            SafetyGate(label="pool age", value="at least 30 days"),
            SafetyGate(label="volume", value="at least $50,000 over 24 hours"),
            SafetyGate(label="oracle", value="independent fresh price evidence required"),
            SafetyGate(label="vault cap", value="1,000 USDG per vault if a route is approved"),
            SafetyGate(label="status", value="no pool approved"),
        ],
        risk_presets=RANGE_PRESETS,
    ),
}

ALLOCATION_TOLERANCE_BPS = 10


@dataclass(frozen=True)
class ScoredCandidate:
    candidate: PoolCandidate
    decision: CandidateDecision


def list_tasks() -> list[StrategyTask]:
    return list(TASKS.values())


def preview_strategy(request: StrategyPreviewRequest) -> StrategyPreviewResponse:
    task = TASKS[request.task_id]
    if not task.live:
        return _hold(
            task,
            request.total_assets * task.target_allocation_bps // 10_000,
            "this route is not live on mainnet",
            [],
        )
    if request.idle_assets + request.deployed_assets > request.total_assets:
        return StrategyPreviewResponse(
            task=task,
            action="hold",
            amount=0,
            target_deployed_assets=request.total_assets * task.target_allocation_bps // 10_000,
            selected_pool_id=None,
            reason="vault accounting is inconsistent",
            candidates=[],
        )

    target = request.total_assets * task.target_allocation_bps // 10_000
    if request.total_assets == 0:
        return _hold(task, target, "vault has no assets", [])
    if request.deployed_assets >= target:
        return _hold(
            task,
            target,
            "target allocation is already met",
            _score_candidates(task.id, request.candidates, request.vault_value_usd),
        )

    allocation_gap = target - request.deployed_assets
    tolerance = max(1, request.total_assets * ALLOCATION_TOLERANCE_BPS // 10_000)
    if allocation_gap <= tolerance:
        return _hold(
            task,
            target,
            "target allocation is within 0.1% tolerance",
            _score_candidates(task.id, request.candidates, request.vault_value_usd),
        )

    max_action_bps = 1_000 if task.id == 2 else task.target_allocation_bps
    amount = min(request.idle_assets, allocation_gap, request.total_assets * max_action_bps // 10_000)
    if amount == 0:
        return _hold(
            task,
            target,
            "no idle assets are available",
            _score_candidates(task.id, request.candidates, request.vault_value_usd),
        )

    scored = _score_candidates(task.id, request.candidates, request.vault_value_usd)
    if task.id == 2:
        return StrategyPreviewResponse(
            task=task,
            action="allocate",
            amount=amount,
            target_deployed_assets=target,
            selected_pool_id="launch-reserve",
            reason="WETH can be staged in the isolated launch reserve",
            candidates=scored,
        )
    accepted = [item for item in scored if item.accepted]
    selected = max(accepted, key=lambda item: item.score, default=None)

    if request.candidates and selected is None:
        return _hold(task, target, "every candidate failed a hard safety gate", scored)

    default_route = "morpho-c845da65" if task.id == 0 else "ezmanager-weth-usdg-100"
    selected_id = selected.id if selected else default_route
    return StrategyPreviewResponse(
        task=task,
        action="allocate",
        amount=amount,
        target_deployed_assets=target,
        selected_pool_id=selected_id,
        reason="idle assets can move into the highest-scoring allowlisted route",
        candidates=scored,
    )


def _hold(task: StrategyTask, target: int, reason: str, candidates: list[CandidateDecision]) -> StrategyPreviewResponse:
    return StrategyPreviewResponse(
        task=task,
        action="hold",
        amount=0,
        target_deployed_assets=target,
        selected_pool_id=None,
        reason=reason,
        candidates=candidates,
    )


def _score_candidates(
    task_id: int,
    candidates: list[PoolCandidate],
    vault_value_usd: float | None = None,
) -> list[CandidateDecision]:
    return [_score_candidate(task_id, candidate, vault_value_usd).decision for candidate in candidates]


def _score_candidate(task_id: int, candidate: PoolCandidate, vault_value_usd: float | None) -> ScoredCandidate:
    reasons: list[str] = []
    if not candidate.allowed:
        reasons.append("route is not allowlisted")
    if candidate.oracle_age_seconds > 300:
        reasons.append("oracle is older than 5 minutes")

    if task_id == 0:
        if vault_value_usd is not None and candidate.liquidity_usd < vault_value_usd * 5:
            reasons.append("market liquidity is below 5x the vault value")
        if candidate.utilization_bps is None or candidate.utilization_bps > 9_500:
            reasons.append("utilization is above 95%")
    elif task_id in {1, 3, 4, 5}:
        if candidate.liquidity_usd < 500_000:
            reasons.append("pool liquidity is below $500,000")
        if candidate.estimated_net_apy_bps <= 0:
            reasons.append("expected fees do not cover execution cost")
    else:
        if candidate.pool_age_seconds is None or candidate.pool_age_seconds < 2_592_000:
            reasons.append("pool is younger than 30 days")
        if candidate.liquidity_usd < 250_000:
            reasons.append("pool liquidity is below $250,000")
        if candidate.volume_24h_usd is None or candidate.volume_24h_usd < 50_000:
            reasons.append("24h volume is below $50,000")

    score = max(0, 10_000 + candidate.estimated_net_apy_bps - candidate.oracle_age_seconds - len(reasons) * 2_500)
    return ScoredCandidate(
        candidate=candidate,
        decision=CandidateDecision(id=candidate.id, accepted=not reasons, score=score, reasons=reasons),
    )
