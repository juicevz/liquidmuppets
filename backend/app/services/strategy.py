from __future__ import annotations

from dataclasses import dataclass

from app.schemas import (
    CandidateDecision,
    PoolCandidate,
    SafetyGate,
    StrategyPreviewRequest,
    StrategyPreviewResponse,
    StrategyTask,
)

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
    ),
    2: StrategyTask(
        id=2,
        slug="launch-liquidity",
        label="Launch pool",
        deposit_asset="WETH",
        share_prefix="mLAUNCH",
        production_route="isolated WETH launch reserve; no token pool is approved yet",
        testnet_route="isolated WETH launch reserve",
        target_allocation_bps=1_000,
        protocol_fee_bps=0,
        live=True,
        execution_mode="reserve",
        execution_note=(
            "Launches and deposits are live; up to 10% can be staged as WETH, but it earns no pool fees yet."
        ),
        safety_gates=[
            SafetyGate(label="idle reserve", value="at least 90% WETH"),
            SafetyGate(label="staging cap", value="10% of vault assets"),
            SafetyGate(label="vault cap", value="0.25 WETH per vault while unaudited"),
            SafetyGate(label="pool state", value="none approved; staged WETH remains withdrawable"),
        ],
    ),
}


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

    max_action_bps = 1_000 if task.id == 2 else task.target_allocation_bps
    amount = min(request.idle_assets, target - request.deployed_assets, request.total_assets * max_action_bps // 10_000)
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
            reason="WETH can be staged in the isolated launch reserve; no token pool is active",
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
    elif task_id == 1:
        if candidate.liquidity_usd < 500_000:
            reasons.append("pool liquidity is below $500,000")
        if candidate.estimated_net_apy_bps <= 0:
            reasons.append("expected fees do not cover execution cost")
    else:
        if candidate.pool_age_seconds is None or candidate.pool_age_seconds < 1_800:
            reasons.append("pool is younger than 30 minutes")
        if candidate.liquidity_usd < 250_000:
            reasons.append("pool liquidity is below $250,000")
        if candidate.volume_24h_usd is None or candidate.volume_24h_usd < 50_000:
            reasons.append("24h volume is below $50,000")

    score = max(0, 10_000 + candidate.estimated_net_apy_bps - candidate.oracle_age_seconds - len(reasons) * 2_500)
    return ScoredCandidate(
        candidate=candidate,
        decision=CandidateDecision(id=candidate.id, accepted=not reasons, score=score, reasons=reasons),
    )
