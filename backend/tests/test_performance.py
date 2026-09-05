from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import Database, PerformanceCheckpointRecord
from app.main import create_app
from app.services.performance import flow_adjusted_change


def checkpoint(
    block_number: int,
    total_assets: int,
    deposits: int = 0,
    withdrawals: int = 0,
) -> PerformanceCheckpointRecord:
    return PerformanceCheckpointRecord(
        agent_id=7,
        vault="0x1111111111111111111111111111111111111111",
        task_id=0,
        block_number=block_number,
        block_timestamp=f"2026-09-05T21:{block_number % 60:02d}:00+00:00",
        asset_symbol="USDG",
        asset_decimals=6,
        share_symbol="mUSDG-7",
        share_decimals=18,
        total_assets=str(total_assets),
        total_supply="1000000000000000000",
        share_price_raw=str(total_assets),
        idle_assets=str(total_assets // 10),
        deployed_assets=str(total_assets - total_assets // 10),
        cumulative_deposits=str(deposits),
        cumulative_withdrawals=str(withdrawals),
    )


def test_flow_adjusted_change_removes_deposits_and_withdrawals() -> None:
    change, basis_points = flow_adjusted_change(
        opening_assets=1_000,
        current_assets=1_300,
        cumulative_deposits=250,
        cumulative_withdrawals=50,
    )

    assert change == 100
    assert basis_points == 800


def test_flow_adjusted_change_waits_for_a_capital_baseline() -> None:
    assert flow_adjusted_change(0, 0, 0, 0) == (0, None)


def test_database_keeps_an_ordered_checkpoint_history(tmp_path: Path) -> None:
    database = Database(tmp_path / "performance.sqlite3")
    database.initialize()
    first = database.add_performance_checkpoint(checkpoint(100, 1_000))
    second = database.add_performance_checkpoint(checkpoint(105, 1_120, deposits=100))
    duplicate = database.add_performance_checkpoint(checkpoint(105, 9_999, deposits=9_999))

    rows = database.list_performance_checkpoints(7)
    assert [row["block_number"] for row in rows] == [100, 105]
    assert first["total_assets"] == "1000"
    assert second["total_assets"] == "1120"
    assert duplicate["total_assets"] == "1120"
    assert database.get_latest_performance_checkpoint(first["vault"])["block_number"] == 105


def test_performance_route_rejects_an_invalid_agent_id(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/agents/-1/performance")

    assert response.status_code == 404
    assert response.json()["detail"] == "Muppet not found"
