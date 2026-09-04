from pathlib import Path
from unittest.mock import MagicMock

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.config import Settings
from app.main import create_app
from app.routers import system
from app.services.token_gate import TokenGateService, format_token_amount


def test_strategy_api_exposes_three_concrete_tasks(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/strategies")
    assert response.status_code == 200
    tasks = response.json()
    assert [task["slug"] for task in tasks] == ["stable-yield", "eth-range", "launch-liquidity"]
    assert [task["live"] for task in tasks] == [True, True, True]
    assert [task["execution_mode"] for task in tasks] == ["active", "active", "reserve"]


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
        "tokenAddress": None,
        "tokenSymbol": "MUPPETS",
        "minimum": "100000",
        "configured": False,
        "enforcement": "app_and_api",
    }


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
    assert response.json()["minimum"] == "100000"


def test_token_gate_rejects_invalid_wallet(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "test.sqlite3", rpc_url="http://127.0.0.1:1"))
    with TestClient(app) as client:
        response = client.get("/api/v1/access/not-a-wallet")
    assert response.status_code == 422


def test_token_gate_unlocks_at_exact_threshold() -> None:
    settings = Settings(
        muppets_token_address="0x2222222222222222222222222222222222222222",
        muppets_token_minimum=100_000,
    )
    fake_web3 = MagicMock()
    fake_web3.eth.get_code.return_value = b"\x60"
    fake_contract = fake_web3.eth.contract.return_value
    fake_contract.functions.decimals.return_value.call.return_value = 18
    fake_contract.functions.balanceOf.return_value.call.return_value = 100_000 * 10**18

    result = TokenGateService(settings, fake_web3).check("0x1111111111111111111111111111111111111111")

    assert result["configured"] is True
    assert result["eligible"] is True
    assert result["balance"] == "100000"
    assert result["minimumRaw"] == str(100_000 * 10**18)
    assert result["reason"] == "eligible"


def test_token_amount_formatting_is_exact() -> None:
    assert format_token_amount(100_000 * 10**18, 18) == "100000"
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


def test_rpc_proxy_caches_identical_reads_and_allows_a_fresh_read(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
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
