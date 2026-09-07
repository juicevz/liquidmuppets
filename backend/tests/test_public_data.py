from pathlib import Path
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import KeeperRunRecord
from app.main import create_app

CREATOR = "0x1111111111111111111111111111111111111111"
OTHER_CREATOR = "0x2222222222222222222222222222222222222222"
VAULT = "0x3333333333333333333333333333333333333333"
TX_HASH = "0x" + "a" * 64


def summary(
    agent_id: int,
    *,
    creator: str = CREATOR,
    vault: str = VAULT,
    asset: str = "0x4444444444444444444444444444444444444444",
    symbol: str = "USDG",
    decimals: int = 6,
    total: int = 1_000_000,
    deployed: int = 700_000,
) -> dict[str, object]:
    return {
        "agent": {
            "id": agent_id,
            "name": f"Muppet {agent_id}",
            "creator": creator,
            "pet_id": 0,
            "task_id": 0,
            "task_label": "Stable yield",
            "created_at": 1,
            "vault": vault,
            "key": "0x5555555555555555555555555555555555555555",
        },
        "tracking_started_at": "2026-09-05T20:00:00+00:00",
        "captured_at": "2026-09-05T22:00:00+00:00",
        "market_observed_at": "2026-09-05T22:00:00+00:00",
        "market_refresh_failed_at": None,
        "checkpoint_count": 3,
        "asset": {"address": asset, "symbol": symbol, "decimals": decimals},
        "current": {
            "total_assets_raw": str(total),
            "deployed_assets_raw": str(deployed),
            "idle_assets_raw": str(total - deployed),
        },
        "change_method": {"id": "cash_flow_adjusted_since_tracking"},
        "market": {"health": {"status": "healthy"}},
        "keeper": None,
    }


def test_creator_profile_groups_native_assets_and_deduplicates_receipts(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        app.state.database.upsert_marketplace_performance(0, summary(0))
        app.state.database.upsert_marketplace_performance(
            1,
            summary(
                1,
                vault="0x6666666666666666666666666666666666666666",
                total=2_000_000,
                deployed=1_000_000,
            ),
        )
        app.state.database.upsert_marketplace_performance(
            2,
            summary(
                2,
                vault="0x7777777777777777777777777777777777777777",
                asset="0x8888888888888888888888888888888888888888",
                symbol="WETH",
                decimals=18,
                total=10**18,
                deployed=5 * 10**17,
            ),
        )
        app.state.database.upsert_marketplace_performance(3, summary(3, creator=OTHER_CREATOR))
        activity = MagicMock()
        activity.list_activity.return_value = [
            {"creator": CREATOR, "agent_id": 0, "tx_hash": TX_HASH},
            {"creator": CREATOR, "agent_id": 0, "tx_hash": TX_HASH},
        ]
        activity.cache_status = "cached"
        app.state.public_data.activity = activity
        app.state.public_data.token_gate = MagicMock()
        app.state.public_data.token_gate.check.return_value = {
            "wallet": CREATOR,
            "feature": "agent_launch",
            "configured": True,
            "eligible": False,
            "tokenAddress": "0x9999999999999999999999999999999999999999",
            "tokenSymbol": "MUPPETS",
            "minimum": "15000",
            "enforcement": "app_and_api",
            "decimals": 18,
            "balance": "30000",
            "balanceRaw": str(30_000 * 10**18),
            "minimumRaw": str(15_000 * 10**18),
            "slotSize": "15000",
            "slotSizeRaw": str(15_000 * 10**18),
            "slotCount": 2,
            "slotsUsed": 3,
            "slotsAvailable": 0,
            "featuredSlots": 2,
            "overCapacity": 1,
            "nextSlotThreshold": "45000",
            "nextSlotThresholdRaw": str(45_000 * 10**18),
            "requiredForNextLaunch": "60000",
            "requiredForNextLaunchRaw": str(60_000 * 10**18),
            "reason": "capacity_full",
            "source": "Robinhood Chain RPC",
        }

        response = client.get(f"/api/v1/creators/{CREATOR}")

    assert response.status_code == 200
    body = response.json()
    assert [row["symbol"] for row in body["asset_totals"]] == ["USDG", "WETH"]
    assert body["asset_totals"][0] == {
        "address": "0x4444444444444444444444444444444444444444",
        "symbol": "USDG",
        "decimals": 6,
        "agent_count": 2,
        "total_assets_raw": "3000000",
        "deployed_assets_raw": "1700000",
        "idle_assets_raw": "1300000",
    }
    assert len(body["agents"]) == 3
    assert body["agents"][0]["receipt_count"] == 1
    assert body["receipt_count"] == 1
    assert body["activity_status"] == "cached"
    assert body["creator_capacity"]["slotsUsed"] == 3
    assert body["creator_capacity"]["overCapacity"] == 1
    assert body["featured_agent_ids"] == [2, 1]


def test_pulse_merges_keeper_reason_and_keeps_holds_without_receipts(tmp_path: Path) -> None:
    settings = Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1")
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.database.upsert_marketplace_performance(0, summary(0))
        app.state.database.add_keeper_run(
            KeeperRunRecord(
                vault=VAULT,
                task_id=0,
                action="allocate",
                amount="700000",
                reason="idle capital crossed the target threshold",
                status="auto-confirmed",
                tx_hash=TX_HASH,
            )
        )
        app.state.database.add_keeper_run(
            KeeperRunRecord(
                vault=VAULT,
                task_id=0,
                action="hold",
                amount="0",
                reason="vault remains inside its target allocation",
                status="auto-held",
            )
        )
        activity = MagicMock()
        activity.cache_status = "available"
        activity.list_activity.return_value = [
            {
                "id": f"{TX_HASH}-0",
                "tx_hash": TX_HASH,
                "block_number": 100,
                "timestamp": "2026-09-05T22:00:00+00:00",
                "action": "allocated",
                "actor": "0x9999999999999999999999999999999999999999",
                "creator": CREATOR,
                "agent_id": 0,
                "agent_name": "Muppet 0",
                "key_symbol": "MUP0",
                "quantity": None,
                "value": "0.7",
                "value_symbol": "USDG",
                "direction": "positive",
            }
        ]
        app.state.public_data.activity = activity

        response = client.get(f"/api/v1/pulse?creator={CREATOR}&category=keeper&limit=20")

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2
    receipt = next(item for item in items if item["tx_hash"] == TX_HASH)
    hold = next(item for item in items if item["tx_hash"] is None)
    assert receipt["source"] == "chain"
    assert receipt["reason"] == "idle capital crossed the target threshold"
    assert receipt["facets"] == ["vault", "keeper"]
    assert hold["action"] == "keeper held"
    assert hold["value"] is None
    assert hold["reason"] == "vault remains inside its target allocation"


def test_public_record_routes_reject_invalid_wallets(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        creator = client.get("/api/v1/creators/not-a-wallet")
        pulse = client.get("/api/v1/pulse?creator=not-a-wallet")

    assert creator.status_code == 422
    assert pulse.status_code == 422
