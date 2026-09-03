from pathlib import Path

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.config import Settings
from app.main import create_app
from app.routers import system


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
