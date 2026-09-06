from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.market_radar import build_market_radar


def summary(
    *,
    agent_id: int,
    task_id: int,
    health: str = "healthy",
    health_detail: str = "Recorded hard checks.",
    observed_at: str = "2026-09-06T11:09:28+00:00",
    refresh_failed_at: str | None = None,
) -> dict[str, object]:
    metrics: dict[str, object] = {"total_supply_assets_raw": "311877447463792", "utilization_bps": 9026}
    if task_id == 1:
        metrics = {"pool_liquidity_raw": "11276443600799007243", "slippage_bps": 300}
    if task_id == 2:
        metrics = {"reserve_assets_raw": "300000000000000"}
    return {
        "agent": {"id": agent_id, "task_id": task_id, "name": f"Muppet {agent_id}"},
        "asset": {
            "address": "0x1111111111111111111111111111111111111111",
            "symbol": "USDG" if task_id == 0 else "WETH",
            "decimals": 6 if task_id == 0 else 18,
        },
        "market_observed_at": observed_at,
        "market_refresh_failed_at": refresh_failed_at,
        "market": {
            "asset": {
                "address": "0x1111111111111111111111111111111111111111",
                "symbol": "USDG" if task_id == 0 else "WETH",
            },
            "venue": "Morpho Blue" if task_id == 0 else "Uniswap V3 via EZManager",
            "pair": "USDe / USDG" if task_id == 0 else "WETH / USDG",
            "pool": "0x2222222222222222222222222222222222222222" if task_id == 1 else None,
            "market_id": "0xc845" if task_id == 0 else None,
            "oracle": {
                "status": "value_available_timestamp_not_exposed" if task_id != 2 else "not_used",
                "updated_at": None,
                "age_seconds": None,
                "detail": "Timestamp not exposed." if task_id != 2 else "No oracle is used.",
            },
            "health": {"status": health, "detail": health_detail, "metrics": metrics},
        },
    }


def test_radar_uses_recorded_evidence_without_inventing_missing_metrics() -> None:
    response = build_market_radar(
        [summary(agent_id=0, task_id=0), summary(agent_id=1, task_id=1), summary(agent_id=2, task_id=2)],
        explorer_url="https://explorer.invalid",
    )

    assert [route.status for route in response.routes] == ["live", "live", "live"]
    stable, range_route, reserve = response.routes
    assert stable.liquidity.value == "311877447.463792"
    assert stable.liquidity.unit == "USDG"
    assert stable.volume_24h.availability == "not_exposed"
    assert stable.pool_age.availability == "not_exposed"
    assert range_route.liquidity.unit == "Uniswap liquidity units"
    assert range_route.costs.max_execution_slippage_bps == 300
    assert range_route.costs.estimate.value is None
    assert reserve.liquidity.availability == "not_applicable"
    assert "does not estimate APY" in response.boundary


def test_radar_marks_failed_hard_checks_and_unobserved_routes_plainly() -> None:
    response = build_market_radar(
        [summary(agent_id=1, task_id=1, health="blocked")],
        explorer_url="https://explorer.invalid",
    )

    assert response.routes[0].status == "review"
    assert response.routes[1].status == "rejected"
    assert "failed a hard route check" in response.routes[1].reason
    assert response.routes[2].status == "review"


def test_radar_reports_the_failing_observation_reason_when_a_newer_row_is_healthy() -> None:
    response = build_market_radar(
        [
            summary(
                agent_id=1,
                task_id=1,
                health="blocked",
                health_detail="Current tick is outside the approved range.",
                observed_at="2026-09-06T11:00:00+00:00",
            ),
            summary(agent_id=3, task_id=1, observed_at="2026-09-06T11:10:00+00:00"),
        ],
        explorer_url="https://explorer.invalid",
    )

    assert response.routes[1].status == "rejected"
    assert "Current tick is outside the approved range." in response.routes[1].reason


def test_radar_discloses_cached_muppet_observations_without_hiding_fresh_route_evidence() -> None:
    response = build_market_radar(
        [
            summary(agent_id=1, task_id=1),
            summary(agent_id=3, task_id=1, refresh_failed_at="2026-09-06T11:10:00+00:00"),
        ],
        explorer_url="https://explorer.invalid",
    )

    route = response.routes[1]
    assert route.status == "live"
    assert route.cached_observations == 1
    assert "last successful cache" in route.reason


def test_market_radar_route_reads_only_the_recorded_summary_cache(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        app.state.database.upsert_marketplace_performance(0, summary(agent_id=0, task_id=0))
        response = client.get("/api/v1/market-radar")

    assert response.status_code == 200
    body = response.json()
    assert len(body["routes"]) == 3
    assert body["routes"][0]["status"] == "live"
    assert body["routes"][0]["read_only"] is True
