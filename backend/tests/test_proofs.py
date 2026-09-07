from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.database import KeeperRunRecord, PerformanceCheckpointRecord
from app.main import create_app

CREATOR = "0x1111111111111111111111111111111111111111"
TOKEN = "0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189"
ASSET = "0x2222222222222222222222222222222222222222"
POOL = "0x3333333333333333333333333333333333333333"
VAULT = "0x4444444444444444444444444444444444444444"
RANGE_VAULT = "0x5555555555555555555555555555555555555555"
RESERVE = "0x6666666666666666666666666666666666666666"


def _hash(character: str) -> str:
    return "0x" + character * 64


def _summary(agent_id: int, *, task_id: int = 0, vault: str = VAULT, name: str = "proof frog") -> dict[str, object]:
    now = datetime.now(UTC).isoformat()
    return {
        "agent": {
            "id": agent_id,
            "name": name,
            "creator": CREATOR,
            "pet_id": agent_id,
            "task_id": task_id,
            "task_label": "ETH range" if task_id == 1 else "Stable yield",
            "created_at": 1,
            "vault": vault,
            "key": "0x7777777777777777777777777777777777777777",
        },
        "tracking_started_at": now,
        "captured_at": now,
        "market_observed_at": now,
        "market_refresh_failed_at": None,
        "checkpoint_count": 2,
        "asset": {"address": ASSET, "symbol": "USDG", "decimals": 6},
        "current": {
            "total_assets_raw": "1020000",
            "deployed_assets_raw": "700000",
            "idle_assets_raw": "320000",
            "flow_adjusted_change_bps": 200,
        },
        "change_method": {"id": "cash_flow_adjusted_since_tracking"},
        "market": {
            "venue": "Uniswap V3 via EZManager" if task_id == 1 else "Morpho Blue",
            "pair": "WETH / USDG" if task_id == 1 else "USDe / USDG",
            "pool": POOL if task_id == 1 else None,
            "market_id": None if task_id == 1 else "0xmarket",
            "range": {
                "lower_tick": -1200,
                "upper_tick": 1200,
            }
            if task_id == 1
            else None,
            "health": {"status": "healthy", "detail": "The configured market gates pass."},
        },
        "keeper": None,
        "key_market": {"status": "available"},
    }


def _event(
    tx_hash: str,
    log_index: int,
    action: str,
    *,
    agent_id: int | None = 0,
    block_number: int = 100,
    value: str | None = None,
    value_symbol: str | None = None,
    quantity: str | None = None,
) -> dict[str, object]:
    return {
        "id": f"{tx_hash}-{log_index}",
        "tx_hash": tx_hash,
        "block_number": block_number,
        "log_index": log_index,
        "timestamp": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "action": action,
        "actor": CREATOR,
        "creator": CREATOR if agent_id is not None else None,
        "agent_id": agent_id,
        "agent_name": "range fox" if agent_id == 1 else "proof frog" if agent_id == 0 else None,
        "key_symbol": "PROOF" if agent_id is not None else None,
        "quantity": quantity,
        "value": value,
        "value_symbol": value_symbol,
        "direction": "positive",
    }


def _checkpoint(
    block_number: int,
    total_assets: int,
    timestamp: datetime,
) -> PerformanceCheckpointRecord:
    return PerformanceCheckpointRecord(
        agent_id=0,
        vault=VAULT,
        task_id=0,
        block_number=block_number,
        block_timestamp=timestamp.isoformat(),
        asset_symbol="USDG",
        asset_decimals=6,
        share_symbol="mUSDG",
        share_decimals=6,
        total_assets=str(total_assets),
        total_supply="1000000",
        share_price_raw=str(total_assets),
        idle_assets=str(total_assets - 700_000),
        deployed_assets="700000",
        cumulative_deposits="0",
        cumulative_withdrawals="0",
    )


def test_proof_api_materializes_all_meaningful_types_and_groups_holds(tmp_path: Path) -> None:
    settings = Settings(
        database_path=tmp_path / "proofs.sqlite3",
        rpc_url="http://127.0.0.1:1",
        muppets_token_address=TOKEN,
        fee_rwa_reserve_address=RESERVE,
        public_base_url="https://liquidmuppets.io",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        app.state.database.upsert_marketplace_performance(0, _summary(0))
        app.state.database.upsert_marketplace_performance(
            1,
            _summary(1, task_id=1, vault=RANGE_VAULT, name="range fox"),
        )
        launch = _event(_hash("a"), 0, "launched")
        first_deposit = _event(_hash("b"), 0, "deposited", block_number=101, value="1", value_symbol="USDG")
        second_deposit = _event(_hash("c"), 0, "deposited", block_number=102, value="2", value_symbol="USDG")
        key_fill = _event(
            _hash("d"),
            0,
            "bought",
            block_number=103,
            value="0.02",
            value_symbol="ETH",
            quantity="2",
        )
        range_close = _event(_hash("e"), 0, "closed range", agent_id=1, block_number=104, value="1")
        range_open = _event(_hash("e"), 1, "opened range", agent_id=1, block_number=104, value="1")
        reserve = _event(
            _hash("f"),
            0,
            "reserve bought",
            agent_id=None,
            block_number=105,
            value="0.4",
            value_symbol="AAPL",
        )
        events = [launch, first_deposit, second_deposit, key_fill, range_close, range_open, reserve]
        app.state.database.commit_activity_index("proof-test", 106, events, [], rewind_from_block=100)

        app.state.database.add_keeper_run(
            KeeperRunRecord(
                vault=VAULT,
                task_id=0,
                action="allocate",
                amount="700000",
                reason="idle capital crossed the target threshold",
                status="auto-confirmed",
                tx_hash=_hash("9"),
            )
        )
        for _ in range(2):
            app.state.database.add_keeper_run(
                KeeperRunRecord(
                    vault=VAULT,
                    task_id=0,
                    action="hold",
                    amount="0",
                    reason="target allocation is already met",
                    status="auto-skipped",
                )
            )
        app.state.database.add_keeper_run(
            KeeperRunRecord(
                vault=RANGE_VAULT,
                task_id=1,
                action="allocate",
                amount="700000",
                reason="range moved outside policy target",
                status="auto-confirmed",
                tx_hash=_hash("e"),
            )
        )
        now = datetime.now(UTC)
        app.state.database.add_performance_checkpoint(_checkpoint(100, 1_000_000, now - timedelta(minutes=10)))
        app.state.database.add_performance_checkpoint(_checkpoint(106, 1_020_000, now - timedelta(minutes=5)))
        app.state.proofs.chain = MagicMock()
        app.state.proofs.chain.read_rwa_reserve.return_value = {
            "stale": False,
            "routes": [
                {
                    "symbol": "AAPL",
                    "token": "0x8888888888888888888888888888888888888888",
                    "pool": "0x9999999999999999999999999999999999999999",
                    "enabled": True,
                }
            ],
        }

        response = client.get("/api/v1/proofs?limit=200")

        assert response.status_code == 200
        body = response.json()
        kinds = {card["kind"] for card in body["items"]}
        assert kinds == {
            "muppet_launch",
            "first_deposit",
            "keeper_action",
            "keeper_daily_summary",
            "range_change",
            "nav_milestone",
            "agent_key_fill",
            "reserve_purchase",
        }
        assert len([card for card in body["items"] if card["kind"] == "first_deposit"]) == 1
        assert len([card for card in body["items"] if card["kind"] == "range_change"]) == 1
        range_card = next(card for card in body["items"] if card["kind"] == "range_change")
        assert range_card["market"]["range"]["lower_tick"] == -1200
        assert range_card["market"]["range"]["upper_tick"] == 1200
        daily = next(card for card in body["items"] if card["kind"] == "keeper_daily_summary")
        assert daily["event_count"] == 2
        assert daily["receipt"]["state"] == "no_transaction"
        nav = next(card for card in body["items"] if card["kind"] == "nav_milestone")
        assert "+2.00%" in nav["title"]
        reserve_card = next(card for card in body["items"] if card["kind"] == "reserve_purchase")
        assert reserve_card["market"]["pool"] == "0x9999999999999999999999999999999999999999"
        assert all(card["token_address"] == TOKEN for card in body["items"])
        assert all(card["no_apy_projection"] is True for card in body["items"])

        proof_id = next(card["id"] for card in body["items"] if card["kind"] == "muppet_launch")
        proof = client.get(f"/api/v1/proofs/{proof_id}")
        social_image = client.get(f"/api/v1/proofs/{proof_id}/card.png")
        source_image = client.get(f"/api/v1/proofs/{proof_id}/card.svg")
        share = client.get(f"/proof/{proof_id}")

    assert proof.status_code == 200
    assert proof.json()["public_url"] == f"https://liquidmuppets.io/proof/{proof_id}"
    assert proof.json()["image_url"] == f"https://liquidmuppets.io/api/v1/proofs/{proof_id}/card.png"
    assert social_image.status_code == 200
    assert social_image.headers["content-type"].startswith("image/png")
    with Image.open(BytesIO(social_image.content)) as rendered:
        assert rendered.size == (1200, 630)
        assert rendered.format == "PNG"
    assert source_image.status_code == 200
    assert source_image.headers["content-type"].startswith("image/svg+xml")
    assert TOKEN in source_image.text
    assert share.status_code == 200
    assert 'name="twitter:card" content="summary_large_image"' in share.text
    assert 'property="og:image:type" content="image/png"' in share.text
    assert f"/api/v1/proofs/{proof_id}/card.png" in share.text


def test_proof_routes_reject_invalid_filters_and_unknown_ids(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "proofs.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        invalid_creator = client.get("/api/v1/proofs?creator=not-a-wallet")
        unknown = client.get("/api/v1/proofs/not-a-proof")
        unsafe = client.get("/proof/%3Cscript%3E")

    assert invalid_creator.status_code == 422
    assert unknown.status_code == 404
    assert unsafe.status_code == 404
