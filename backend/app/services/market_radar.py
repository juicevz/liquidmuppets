from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, cast

from app.schemas import MarketRadarResponse, MarketRadarRoute, RadarCosts, RadarMetric, RadarOracle, RadarStatus
from app.services.strategy import TASKS


def build_market_radar(
    summaries: list[dict[str, object]],
    *,
    explorer_url: str,
) -> MarketRadarResponse:
    grouped: dict[int, list[dict[str, object]]] = {task_id: [] for task_id in TASKS}
    for summary in summaries:
        agent = _mapping(summary.get("agent"))
        task_id = _integer(agent.get("task_id"))
        if task_id in grouped:
            grouped[task_id].append(summary)

    return MarketRadarResponse(
        generated_at=datetime.now(UTC),
        explorer_url=explorer_url,
        boundary=(
            "Read-only evidence for configured task routes. Radar does not approve, allocate, or execute capital, "
            "and it does not estimate APY or expected returns."
        ),
        routes=[_route(task_id, grouped[task_id]) for task_id in sorted(TASKS)],
    )


def _route(task_id: int, summaries: list[dict[str, object]]) -> MarketRadarRoute:
    task = TASKS[cast(Any, task_id)]
    ordered = sorted(summaries, key=lambda row: str(row.get("market_observed_at") or ""), reverse=True)
    representative = ordered[0] if ordered else None
    market = _mapping(representative.get("market")) if representative else {}
    health = _mapping(market.get("health"))
    metrics = _mapping(health.get("metrics"))
    asset = _mapping(market.get("asset"))
    summary_asset = _mapping(representative.get("asset")) if representative else {}
    cached_count = sum(1 for row in ordered if row.get("market_refresh_failed_at") is not None)
    status, reason = _status_reason(ordered, representative, cached_count)
    asset_symbol = str(asset.get("symbol") or summary_asset.get("symbol") or task.deposit_asset)
    asset_address = _optional_string(asset.get("address") or summary_asset.get("address"))
    decimals = _integer(summary_asset.get("decimals"))
    observed_at = _optional_datetime(representative.get("market_observed_at")) if representative else None
    failed_at_values = [
        parsed
        for row in ordered
        if (parsed := _optional_datetime(row.get("market_refresh_failed_at"))) is not None
    ]

    return MarketRadarRoute(
        id=_route_id(task_id),
        task_id=cast(Any, task_id),
        task_label=task.label,
        route=task.production_route,
        asset_address=asset_address,
        asset_symbol=asset_symbol,
        venue=str(market.get("venue") or _fallback_venue(task_id)),
        pair=_optional_string(market.get("pair")),
        pool=_optional_string(market.get("pool")),
        market_id=_optional_string(market.get("market_id")),
        approved=True,
        read_only=True,
        status=status,
        reason=reason,
        health_status=str(health.get("status") or "unobserved"),
        health_detail=str(health.get("detail") or "No recorded adapter health observation is available yet."),
        observed_at=observed_at,
        refresh_failed_at=max(failed_at_values) if failed_at_values else None,
        monitored_muppets=len(ordered),
        cached_observations=cached_count,
        liquidity=_liquidity(task_id, metrics, asset_symbol, decimals),
        volume_24h=_unavailable_metric(task_id, "24 hour volume", "current adapter evidence"),
        pool_age=_unavailable_metric(task_id, "pool age", "current adapter evidence"),
        capacity=_capacity(task_id),
        oracle=_oracle(market),
        costs=_costs(task_id, metrics),
        checks=task.safety_gates,
    )


def _status_reason(
    summaries: list[dict[str, object]],
    representative: dict[str, object] | None,
    cached_count: int,
) -> tuple[RadarStatus, str]:
    if representative is None:
        return "review", "Approved route has no recorded Muppet observation yet."

    statuses = {
        str(_mapping(_mapping(row.get("market")).get("health")).get("status") or "unavailable")
        for row in summaries
    }
    if statuses & {"blocked", "mismatch"}:
        failed = next(
            (
                _mapping(_mapping(row.get("market")).get("health"))
                for row in summaries
                if str(_mapping(_mapping(row.get("market")).get("health")).get("status"))
                in {"blocked", "mismatch"}
            ),
            {},
        )
        detail = str(failed.get("detail") or "A recorded adapter check did not pass.")
        return "rejected", f"A monitored Muppet failed a hard route check. {detail}"
    if statuses == {"unavailable"}:
        return "review", "The approved route is configured, but its current adapter evidence is unavailable."

    suffix = ""
    if cached_count:
        noun = "observation is" if cached_count == 1 else "observations are"
        suffix = f" {cached_count} older Muppet {noun} using the last successful cache."
    return "live", f"Latest recorded adapter evidence passed the configured route checks.{suffix}"


def _liquidity(task_id: int, metrics: Mapping[str, object], symbol: str, decimals: int | None) -> RadarMetric:
    if task_id == 0:
        raw = _optional_string(metrics.get("total_supply_assets_raw"))
        value = _format_units(raw, decimals) if raw is not None and decimals is not None else raw
        return RadarMetric(
            availability="available" if value is not None else "not_exposed",
            value=value,
            unit=symbol if value is not None else None,
            detail=(
                "Total Morpho supply reported by adapter health in native asset units; no USD conversion is inferred."
                if value is not None
                else "The latest recorded adapter observation does not expose market supply."
            ),
            source="adapter.marketHealth.totalSupplyAssets",
        )
    if task_id == 1:
        raw = _optional_string(metrics.get("pool_liquidity_raw"))
        return RadarMetric(
            availability="available" if raw is not None else "not_exposed",
            value=raw,
            unit="Uniswap liquidity units" if raw is not None else None,
            detail=(
                "Exact in-range liquidity value returned by the pool; it is not a token amount or USD estimate."
                if raw is not None
                else "The latest recorded pool observation does not expose liquidity."
            ),
            source="UniswapV3Pool.liquidity",
        )
    return RadarMetric(
        availability="not_applicable",
        detail="The launch route is an isolated WETH reserve and does not use an external pool.",
        source="LaunchReserveAdapter",
    )


def _unavailable_metric(task_id: int, label: str, source: str) -> RadarMetric:
    if task_id == 2:
        return RadarMetric(
            availability="not_applicable",
            detail=f"{label.capitalize()} does not apply to the isolated launch reserve.",
            source="LaunchReserveAdapter",
        )
    return RadarMetric(
        availability="not_exposed",
        detail=f"{label.capitalize()} is not exposed by the current onchain adapter interface.",
        source=source,
    )


def _capacity(task_id: int) -> RadarMetric:
    task = TASKS[cast(Any, task_id)]
    vault_cap = next((gate.value for gate in task.safety_gates if gate.label == "vault cap"), "not exposed")
    target = Decimal(task.target_allocation_bps) / Decimal(100)
    target_label = format(target, "f")
    if "." in target_label:
        target_label = target_label.rstrip("0").rstrip(".")
    return RadarMetric(
        availability="available",
        value=f"{vault_cap}; {target_label}% policy target",
        detail="Per-vault cap and maximum target allocation from the configured task policy.",
        source="strategy policy",
    )


def _oracle(market: Mapping[str, object]) -> RadarOracle:
    oracle = _mapping(market.get("oracle"))
    return RadarOracle(
        status=str(oracle.get("status") or "unavailable"),
        updated_at=_optional_datetime(oracle.get("updated_at")),
        age_seconds=_integer(oracle.get("age_seconds")),
        detail=str(oracle.get("detail") or "No recorded oracle evidence is available yet."),
    )


def _costs(task_id: int, metrics: Mapping[str, object]) -> RadarCosts:
    task = TASKS[cast(Any, task_id)]
    slippage = _integer(metrics.get("slippage_bps"))
    estimate_availability = "not_applicable" if task_id == 2 else "not_exposed"
    estimate_detail = (
        "No external execution occurs in the isolated launch reserve."
        if task_id == 2
        else "Realized gas, price impact, and expected execution cost are not estimated by Radar."
    )
    return RadarCosts(
        protocol_fee_bps=task.protocol_fee_bps,
        max_execution_slippage_bps=slippage,
        estimate=RadarMetric(
            availability=cast(Any, estimate_availability),
            detail=estimate_detail,
            source="strategy policy and recorded adapter evidence",
        ),
        detail="Policy fee and maximum slippage are limits, not a forecast of realized cost.",
    )


def _route_id(task_id: int) -> str:
    return {0: "morpho-c845da65", 1: "ezmanager-weth-usdg-100", 2: "isolated-weth-launch-reserve"}[task_id]


def _fallback_venue(task_id: int) -> str:
    return {0: "Morpho Blue", 1: "Uniswap V3 via EZManager", 2: "isolated vault reserve"}[task_id]


def _mapping(value: object) -> Mapping[str, object]:
    return cast(Mapping[str, object], value) if isinstance(value, Mapping) else {}


def _integer(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value))
    except ValueError:
        return None


def _optional_string(value: object) -> str | None:
    if value is None:
        return None
    rendered = str(value).strip()
    return rendered or None


def _optional_datetime(value: object) -> datetime | None:
    rendered = _optional_string(value)
    if rendered is None:
        return None
    try:
        parsed = datetime.fromisoformat(rendered.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def _format_units(raw: str, decimals: int) -> str:
    value = Decimal(raw) / (Decimal(10) ** decimals)
    rendered = format(value, "f")
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered
