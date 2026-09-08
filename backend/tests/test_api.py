from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.config import Settings
from app.database import Database
from app.main import create_app
from app.routers import system
from app.services.activity import ActivityService
from app.services.token_gate import TokenGateService, format_token_amount


def test_strategy_api_exposes_live_and_factory_v2_candidate_tasks(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/strategies")
    assert response.status_code == 200
    tasks = response.json()
    assert [task["slug"] for task in tasks] == [
        "stable-yield",
        "eth-range",
        "launch-liquidity",
        "aapl-usdg-range",
        "nvda-usdg-range",
        "spy-usdg-range",
        "screened-meme-weth-range",
    ]
    assert [task["live"] for task in tasks] == [True, True, True, False, False, False, False]
    assert [task["execution_mode"] for task in tasks] == [
        "active",
        "active",
        "reserve",
        "review",
        "review",
        "review",
        "review",
    ]
    assert [preset["id"] for preset in tasks[3]["risk_presets"]] == ["defensive", "balanced", "active"]


def test_preview_api_returns_integer_amount(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/strategies/preview",
            json={"task_id": 0, "total_assets": 10_000, "idle_assets": 10_000, "deployed_assets": 0},
        )
    assert response.status_code == 200
    assert response.json()["action"] == "allocate"
    assert response.json()["amount"] == 9_000


def test_contract_config_uses_same_origin_read_proxy(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/contracts")
    assert response.status_code == 200
    assert response.json()["rpcUrl"] == "/api/v1/rpc"
    assert response.json()["accessGate"] == {
        "feature": "agent_launch",
        "model": "creator_slots",
        "tokenAddress": None,
        "tokenSymbol": "MUPPETS",
        "minimum": "15000",
        "slotSize": "15000",
        "formula": "floor(balance / slotSize)",
        "configured": False,
        "enforcement": "app_and_api",
    }


def test_contract_config_exposes_canonical_muppets_token(tmp_path: Path) -> None:
    token = "0x5e7516BE1Be5d4396b060908Cd44c9dB093c4189"
    app = create_app(
        Settings(
            database_path=tmp_path / "test.sqlite3",
            rpc_url="http://127.0.0.1:1",
            muppets_token_address=token,
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/contracts")

    assert response.status_code == 200
    assert response.json()["accessGate"]["tokenAddress"] == token
    assert response.json()["accessGate"]["configured"] is True


def test_contract_config_exposes_fee_reserve(tmp_path: Path) -> None:
    reserve = "0xF10DA007314bB3e7B34FE06bB5c590190dcE9765"
    app = create_app(
        Settings(
            database_path=tmp_path / "test.sqlite3",
            rpc_url="http://127.0.0.1:1",
            fee_rwa_reserve_address=reserve,
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/contracts")
    assert response.status_code == 200
    assert response.json()["feeRwaReserve"] == reserve


def test_contract_config_exposes_revenue_contracts(tmp_path: Path) -> None:
    router = "0x1111111111111111111111111111111111111111"
    bond = "0x2222222222222222222222222222222222222222"
    buyback = "0x4444444444444444444444444444444444444444"
    executor = "0x5555555555555555555555555555555555555555"
    app = create_app(
        Settings(
            database_path=tmp_path / "test.sqlite3",
            rpc_url="http://127.0.0.1:1",
            revenue_router_address=router,
            agent_bond_address=bond,
            buyback_vault_address=buyback,
            buyback_executor_address=executor,
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/contracts")

    assert response.status_code == 200
    assert response.json()["revenueRouter"] == router
    assert response.json()["agentBond"] == bond
    assert response.json()["buybackVault"] == buyback
    assert response.json()["buybackExecutor"] == executor


def test_revenue_api_keeps_activation_and_wallet_state_explicit(tmp_path: Path) -> None:
    wallet = "0x3333333333333333333333333333333333333333"
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    app.state.revenue = MagicMock()
    app.state.revenue.read.return_value = {
        "status": "activation_pending",
        "wallet": {"address": wallet, "available": False},
        "receipts": [],
    }

    with TestClient(app) as client:
        response = client.get(f"/api/v1/revenue?wallet={wallet}")

    assert response.status_code == 200
    assert response.json()["status"] == "activation_pending"
    assert response.json()["wallet"]["available"] is False
    app.state.revenue.read.assert_called_once_with(wallet)


def test_revenue_api_rejects_an_invalid_wallet(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/revenue?wallet=not-a-wallet")
    assert response.status_code == 422


def test_key_revenue_api_preserves_legacy_attribution_flag(tmp_path: Path) -> None:
    key = "0x4444444444444444444444444444444444444444"
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    app.state.revenue = MagicMock()
    app.state.revenue.read_key.return_value = {
        "status": "legacy_global",
        "key": key,
        "attribution": "legacy_global",
        "receipts": [],
    }

    with TestClient(app) as client:
        response = client.get(f"/api/v1/revenue/keys/{key}?legacy_market=true")

    assert response.status_code == 200
    assert response.json()["attribution"] == "legacy_global"
    app.state.revenue.read_key.assert_called_once_with(key, legacy_market=True)


def test_key_revenue_api_rejects_invalid_key(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/revenue/keys/not-a-key")
    assert response.status_code == 422


def test_activity_api_filters_receipts_by_agent(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    row = {
        "id": "0xreceipt-0",
        "tx_hash": "0x1111111111111111111111111111111111111111111111111111111111111111",
        "block_number": 123,
        "timestamp": "2026-09-05T22:00:00+00:00",
        "action": "deposited",
        "actor": "0x1111111111111111111111111111111111111111",
        "agent_id": 2,
        "agent_name": "launch sage",
        "key_symbol": "SAGE",
        "quantity": None,
        "value": "1",
        "value_symbol": "WETH",
        "direction": "positive",
    }
    app.state.activity = MagicMock()
    app.state.activity.list_agent_activity.return_value = [row]

    with TestClient(app) as client:
        response = client.get("/api/v1/activity?agent_id=2&limit=100")

    assert response.status_code == 200
    assert response.json()[0]["agent_id"] == 2
    app.state.activity.list_agent_activity.assert_called_once_with(2, 100)


def test_activity_uses_recent_cache_during_a_transient_rpc_error(monkeypatch: MonkeyPatch) -> None:
    service = ActivityService(Settings(rpc_url="https://rpc.invalid", activity_stale_after_seconds=300))
    service._cache = [{"agent_id": 1, "action": "deposited"}]
    service._last_success_at = datetime.now(UTC)
    monkeypatch.setattr(service, "_read_chain_activity", MagicMock(side_effect=RuntimeError("rate limited")))

    assert service.list_agent_activity(1) == [{"agent_id": 1, "action": "deposited"}]
    assert service.cache_status == "cached"
    assert service.cache_is_stale is False


def test_activity_marks_an_old_cache_stale_after_a_refresh_error(monkeypatch: MonkeyPatch) -> None:
    service = ActivityService(Settings(rpc_url="https://rpc.invalid", activity_stale_after_seconds=60))
    service._cache = [{"agent_id": 1, "action": "deposited"}]
    service._last_success_at = datetime.now(UTC) - timedelta(seconds=61)
    monkeypatch.setattr(service, "_read_chain_activity", MagicMock(side_effect=RuntimeError("rate limited")))

    assert service.list_agent_activity(1) == [{"agent_id": 1, "action": "deposited"}]
    assert service.cache_status == "stale"
    assert service.cache_is_stale is True


def test_activity_retries_a_rate_limit_and_recovers(monkeypatch: MonkeyPatch) -> None:
    service = ActivityService(Settings(rpc_url="https://rpc.invalid"))
    request = httpx.Request("POST", "https://rpc.invalid")
    response = httpx.Response(429, request=request)
    rate_limit = httpx.HTTPStatusError("rate limited", request=request, response=response)
    read_chain = MagicMock(side_effect=[rate_limit, [{"agent_id": 1, "action": "deposited"}]])
    monkeypatch.setattr(service, "_read_chain_activity", read_chain)
    monkeypatch.setattr("app.services.activity.sleep", MagicMock())

    assert service.list_agent_activity(1) == [{"agent_id": 1, "action": "deposited"}]
    assert service.cache_status == "available"
    assert read_chain.call_count == 2


def test_activity_snapshot_survives_a_service_restart(tmp_path: Path) -> None:
    database = Database(tmp_path / "activity.sqlite3")
    database.initialize()
    timestamp = datetime.now(UTC).isoformat()
    row = {
        "id": "0xabc-1",
        "tx_hash": "0x" + "ab" * 32,
        "block_number": 123,
        "log_index": 1,
        "timestamp": timestamp,
        "action": "deposited",
        "actor": "0x1111111111111111111111111111111111111111",
        "creator": None,
        "agent_id": 1,
        "agent_name": "quiet frog",
        "key_symbol": "FROG",
        "quantity": None,
        "value": "1",
        "value_symbol": "USDG",
        "direction": "positive",
    }
    database.commit_activity_index("source", 124, [row], [], rewind_from_block=100)
    settings = Settings(
        database_path=database.path,
        rpc_url="https://rpc.invalid",
        factory_address="0x2222222222222222222222222222222222222222",
        key_marketplace_address="0x3333333333333333333333333333333333333333",
        deployment_block=100,
    )
    service = ActivityService(settings, database)
    service._source = "source"
    service.restore_persistent_state()

    assert service.list_agent_activity(1) == [row]
    assert service.cache_status == "available"


def test_public_rwa_keeper_trigger_is_disabled(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.post("/api/v1/keeper/rwa/run")
    assert response.status_code == 403
    assert response.json()["detail"] == "public keeper runs are disabled"


def test_token_gate_fails_closed_until_contract_is_configured(tmp_path: Path) -> None:
    app = create_app(
        Settings(
            database_path=tmp_path / "test.sqlite3",
            rpc_url="http://127.0.0.1:1",
            muppets_token_address="",
        )
    )
    with TestClient(app) as client:
        response = client.get("/api/v1/access/0x1111111111111111111111111111111111111111")
    assert response.status_code == 200
    assert response.json()["eligible"] is False
    assert response.json()["reason"] == "token_not_configured"
    assert response.json()["minimum"] == "15000"


def test_token_gate_rejects_invalid_wallet(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/access/not-a-wallet")
    assert response.status_code == 422


def test_token_gate_unlocks_at_exact_threshold() -> None:
    settings = Settings(
        muppets_token_address="0x2222222222222222222222222222222222222222",
        muppets_token_minimum=15_000,
        factory_address="0x3333333333333333333333333333333333333333",
    )
    fake_web3 = MagicMock()
    fake_web3.eth.get_code.return_value = b"\x60"
    fake_token = MagicMock()
    fake_factory = MagicMock()
    fake_web3.eth.contract.side_effect = [fake_token, fake_factory]
    fake_token.functions.decimals.return_value.call.return_value = 18
    fake_token.functions.balanceOf.return_value.call.return_value = 15_000 * 10**18
    fake_factory.functions.getCreatorAgentIds.return_value.call.return_value = []

    result = TokenGateService(settings, fake_web3).check("0x1111111111111111111111111111111111111111")

    assert result["configured"] is True
    assert result["eligible"] is True
    assert result["balance"] == "15000"
    assert result["minimumRaw"] == str(15_000 * 10**18)
    assert result["slotCount"] == 1
    assert result["slotsUsed"] == 0
    assert result["slotsAvailable"] == 1
    assert result["featuredSlots"] == 0
    assert result["nextSlotThreshold"] == "30000"
    assert result["requiredForNextLaunch"] == "15000"
    assert result["reason"] == "eligible"


def test_token_gate_requires_one_slot_per_existing_muppet() -> None:
    settings = Settings(
        muppets_token_address="0x2222222222222222222222222222222222222222",
        muppets_token_minimum=15_000,
        factory_address="0x3333333333333333333333333333333333333333",
    )
    fake_web3 = MagicMock()
    fake_web3.eth.get_code.return_value = b"\x60"
    fake_token = MagicMock()
    fake_factory = MagicMock()
    fake_web3.eth.contract.side_effect = [fake_token, fake_factory]
    fake_token.functions.decimals.return_value.call.return_value = 18
    fake_token.functions.balanceOf.return_value.call.return_value = 30_000 * 10**18
    fake_factory.functions.getCreatorAgentIds.return_value.call.return_value = [0, 1]

    result = TokenGateService(settings, fake_web3).check("0x1111111111111111111111111111111111111111")

    assert result["eligible"] is False
    assert result["slotCount"] == 2
    assert result["slotsUsed"] == 2
    assert result["slotsAvailable"] == 0
    assert result["featuredSlots"] == 2
    assert result["overCapacity"] == 0
    assert result["requiredForNextLaunch"] == "45000"
    assert result["reason"] == "capacity_full"


def test_token_gate_counts_agent_bonded_muppets_as_creator_capacity() -> None:
    settings = Settings(
        muppets_token_address="0x2222222222222222222222222222222222222222",
        muppets_token_minimum=15_000,
        factory_address="0x3333333333333333333333333333333333333333",
        agent_bond_address="0x4444444444444444444444444444444444444444",
    )
    fake_web3 = MagicMock()
    fake_web3.eth.get_code.return_value = b"\x60"
    fake_token = MagicMock()
    fake_factory = MagicMock()
    fake_bond = MagicMock()
    fake_web3.eth.contract.side_effect = [fake_token, fake_factory, fake_bond]
    fake_token.functions.decimals.return_value.call.return_value = 18
    fake_token.functions.balanceOf.return_value.call.return_value = 15_000 * 10**18
    fake_bond.functions.bondedBalance.return_value.call.return_value = 15_000 * 10**18
    fake_factory.functions.getCreatorAgentIds.return_value.call.return_value = [0]

    result = TokenGateService(settings, fake_web3).check("0x1111111111111111111111111111111111111111")

    assert result["walletBalance"] == "15000"
    assert result["bondedBalance"] == "15000"
    assert result["balance"] == "30000"
    assert result["slotCount"] == 2
    assert result["slotsUsed"] == 1
    assert result["slotsAvailable"] == 1
    assert result["eligible"] is True


def test_token_amount_formatting_is_exact() -> None:
    assert format_token_amount(15_000 * 10**18, 18) == "15000"
    assert format_token_amount(12_345_600, 6) == "12.3456"


def test_rpc_proxy_rejects_transaction_submission(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/rpc",
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_sendRawTransaction", "params": ["0x00"]},
        )
    assert response.status_code == 403


def test_rpc_proxy_retries_a_transient_upstream_failure(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    attempts = 0

    def fake_post(url: str, **_kwargs: object) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        request = httpx.Request("POST", url)
        if attempts == 1:
            return httpx.Response(503, request=request)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "0x1237"}, request=request)

    monkeypatch.setattr(system, "sleep", lambda _: None)
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="https://rpc.invalid"))

    with TestClient(app) as client:
        monkeypatch.setattr(app.state.rpc_client, "post", fake_post)
        response = client.post(
            "/api/v1/rpc",
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []},
        )

    assert response.status_code == 200
    assert response.json()["result"] == "0x1237"
    assert attempts == 2


def test_rpc_proxy_caches_identical_reads_and_allows_a_fresh_read(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    attempts = 0

    def fake_post(url: str, **_kwargs: object) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        request = httpx.Request("POST", url)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "0x01"}, request=request)

    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="https://rpc.invalid"))
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": "0x0000000000000000000000000000000000000000", "data": "0x"}, "latest"],
    }

    with TestClient(app) as client:
        monkeypatch.setattr(app.state.rpc_client, "post", fake_post)
        first = client.post("/api/v1/rpc", json=payload)
        cached = client.post("/api/v1/rpc", json=payload)
        fresh = client.post("/api/v1/rpc", json=payload, headers={"X-LiquidMuppets-Fresh": "1"})

    assert first.status_code == cached.status_code == fresh.status_code == 200
    assert attempts == 2


def test_rpc_proxy_splits_large_batches_before_upstream(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    batch_sizes: list[int] = []

    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        payload = kwargs["json"]
        assert isinstance(payload, list)
        batch_sizes.append(len(payload))
        request = httpx.Request("POST", url)
        return httpx.Response(
            200,
            json=[{"jsonrpc": "2.0", "id": row["id"], "result": "0x01"} for row in payload],
            request=request,
        )

    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="https://rpc.invalid"))
    payload = [
        {
            "jsonrpc": "2.0",
            "id": index,
            "method": "eth_call",
            "params": [{"to": "0x0000000000000000000000000000000000000000", "data": "0x"}, "latest"],
        }
        for index in range(25)
    ]

    with TestClient(app) as client:
        monkeypatch.setattr(app.state.rpc_client, "post", fake_post)
        response = client.post("/api/v1/rpc", json=payload)

    assert response.status_code == 200
    assert len(response.json()) == 25
    assert batch_sizes == [10, 10, 5]


def test_rpc_proxy_fails_over_to_the_secondary_endpoint(tmp_path: Path, monkeypatch: MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_post(url: str, **_kwargs: object) -> httpx.Response:
        calls.append(url)
        request = httpx.Request("POST", url)
        if url == "https://primary.invalid":
            return httpx.Response(503, request=request)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": "0x1237"}, request=request)

    monkeypatch.setattr(system, "sleep", lambda _: None)
    app = create_app(
        Settings(
            database_path=tmp_path / "test.sqlite3",
            rpc_url="https://primary.invalid",
            rpc_fallback_urls=("https://secondary.invalid",),
        )
    )
    with TestClient(app) as client:
        monkeypatch.setattr(app.state.rpc_client, "post", fake_post)
        response = client.post(
            "/api/v1/rpc",
            json={"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []},
        )

    assert response.status_code == 200
    assert response.json()["result"] == "0x1237"
    assert calls.count("https://primary.invalid") == len(system.RPC_RETRY_DELAYS)
    assert calls[-1] == "https://secondary.invalid"


def test_wallet_profile_requires_the_wallet_signature(tmp_path: Path) -> None:
    account = Account.create()
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        challenge = client.post(
            "/api/v1/profiles/challenge",
            json={"wallet": account.address, "handle": "@quietfrog"},
        )
        assert challenge.status_code == 200
        body = challenge.json()
        signature = Account.sign_message(encode_defunct(text=body["message"]), account.key).signature.hex()
        claim = client.post(
            "/api/v1/profiles/claim",
            json={
                "wallet": account.address,
                "handle": "quietfrog",
                "nonce": body["nonce"],
                "signature": signature,
            },
        )
        profile = client.get(f"/api/v1/profiles/{account.address}")

    assert claim.status_code == 200
    assert claim.json()["handle"] == "quietfrog"
    assert profile.status_code == 200
    assert profile.json()["wallet"] == account.address.lower()


def test_wallet_profile_rejects_a_different_signer(tmp_path: Path) -> None:
    account = Account.create()
    attacker = Account.create()
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        challenge = client.post(
            "/api/v1/profiles/challenge",
            json={"wallet": account.address, "handle": "quietfrog"},
        ).json()
        signature = Account.sign_message(encode_defunct(text=challenge["message"]), attacker.key).signature.hex()
        claim = client.post(
            "/api/v1/profiles/claim",
            json={
                "wallet": account.address,
                "handle": "quietfrog",
                "nonce": challenge["nonce"],
                "signature": signature,
            },
        )

    assert claim.status_code == 403
