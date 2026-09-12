from __future__ import annotations

import json
import random
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from eth_abi.abi import decode
from eth_utils.crypto import keccak
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.stock_drop_manifest import (
    MUPPETS,
    STOCKS,
    UNIT,
    Exclusion,
    Holder,
    Snapshot,
    build_manifest,
    canonical_bytes,
    leaf_hash,
    manifest_hash,
    read_manifest,
)
from app.services.stock_drops import StockDropService
from app.stock_drop_schemas import StockDropResponse
from app.stock_drops_cli import prepare, verify_snapshot

CONTRACT = "0x" + "11" * 20
ALICE = "0x" + "22" * 20
BOB = "0x" + "33" * 20
LP = "0x" + "44" * 20
TOKEN = next(iter(STOCKS))
SAFE = "0x" + "55" * 20
HASH = "0x" + "ab" * 32


def snapshot():
    return Snapshot(chain_id=4663, token=MUPPETS, block_number=100, block_hash=HASH,
                    total_supply_raw=str(13 * UNIT),
                    holders=[Holder(account=ALICE, balance_raw=str(UNIT)),
                             Holder(account=BOB, balance_raw=str(2 * UNIT)),
                             Holder(account=LP, balance_raw=str(10 * UNIT))],
                    exclusions=[Exclusion(account=LP, reason="Liquidity pool; no look-through allocation.")])


def make_manifest():
    return build_manifest(snapshot(), CONTRACT, 0, TOKEN, 10**18)


def test_exact_pro_rata_budget_and_independent_merkle_verification():
    manifest = make_manifest()
    assert canonical_bytes(manifest) == (Path(__file__).parents[2] / "qa/fixtures/stock-drop.json").read_bytes()
    assert [row.amount_raw for row in manifest.allocations] == ["333333333333333333", "666666666666666667"]
    assert sum(int(row.amount_raw) for row in manifest.allocations) == 10**18
    for row in manifest.allocations:
        node = leaf_hash(4663, CONTRACT, 0, row.index, row.account, int(row.amount_raw))
        for proof in row.proof:
            node = keccak(b"".join(sorted([node, bytes.fromhex(proof[2:])])))
        assert "0x" + node.hex() == manifest.root
    assert read_manifest(canonical_bytes(manifest)) == manifest


def test_largest_remainder_and_odd_leaf_trees_conserve_all_inventory():
    rng = random.Random(100)
    for count in range(1, 32):
        balances = [rng.randint(1, 100) * UNIT for _ in range(count)]
        sample = Snapshot(chain_id=4663, token=MUPPETS, block_number=100, block_hash=HASH,
                          total_supply_raw=str(sum(balances)), exclusions=[],
                          holders=[Holder(account=f"0x{i + 1:040x}", balance_raw=str(balance))
                                   for i, balance in enumerate(balances)])
        budget = rng.randint(10**10, 10**30)
        manifest = build_manifest(sample, CONTRACT, 7, TOKEN, budget)
        assert sum(int(row.amount_raw) for row in manifest.allocations) == budget
        for row in manifest.allocations:
            node = leaf_hash(4663, CONTRACT, 7, row.index, row.account, int(row.amount_raw))
            for proof in row.proof:
                node = keccak(b"".join(sorted([node, bytes.fromhex(proof[2:])])))
            assert "0x" + node.hex() == manifest.root


def test_partial_units_do_not_round_up_and_zero_allocations_are_rejected():
    sample = snapshot()
    sample.holders[0].balance_raw = str(UNIT - 1)
    sample.total_supply_raw = str(13 * UNIT - 1)
    manifest = build_manifest(sample, CONTRACT, 0, TOKEN, 7)
    assert [row.account for row in manifest.allocations] == [BOB]
    assert manifest.allocations[0].amount_raw == "7"
    with pytest.raises(ValueError, match="too small"):
        build_manifest(snapshot(), CONTRACT, 0, TOKEN, 1)


@pytest.mark.parametrize("change", ["missing_holder", "duplicate", "out_of_order", "fake_supply", "unknown_exclusion"])
def test_invalid_or_incomplete_snapshots_fail(change):
    sample = snapshot()
    if change == "missing_holder":
        sample.holders.pop(0)
    elif change == "duplicate":
        sample.holders.append(sample.holders[0])
    elif change == "out_of_order":
        sample.holders.reverse()
    elif change == "fake_supply":
        sample.total_supply_raw = "1"
    else:
        sample.exclusions.append(Exclusion(account=CONTRACT, reason="Unknown wallet"))
    with pytest.raises(ValueError):
        build_manifest(sample, CONTRACT, 0, TOKEN, 1000)


def test_manifest_tampering_and_ambiguous_serialization_are_rejected():
    manifest = make_manifest()
    forged = manifest.model_copy(deep=True)
    forged.allocations[0].amount_raw = "999"
    with pytest.raises(ValueError, match="do not match"):
        read_manifest(canonical_bytes(forged))
    with pytest.raises(ValueError, match="canonical"):
        read_manifest(manifest.model_dump_json(indent=2).encode())
    data = json.loads(canonical_bytes(manifest))
    data["hidden_fee"] = "1"
    with pytest.raises(ValueError):
        read_manifest(json.dumps(data).encode())
    assert manifest_hash(manifest) == manifest_hash(read_manifest(canonical_bytes(manifest)))


class Functions:
    def __init__(self, answers):
        self.answers = answers

    def __getattr__(self, name):
        def function(*args):
            value = self.answers[name]
            return SimpleNamespace(call=lambda **kwargs: value(*args) if callable(value) else value)
        return function


class FakeEth:
    chain_id = 4663
    block_number = 1000

    def __init__(self):
        self.manifest = make_manifest()
        self.claimed = False
        self.balance = 10**18
        self.counterfeit_balance = False
        self.root = self.manifest.root
        self.next_id = 1
        self.threshold = 2
        self.publisher_balance = 10**18

    def get_block(self, number):
        return {"number": 1000 if number == "latest" else number, "hash": bytes.fromhex(HASH[2:])}

    def get_code(self, address, **kwargs):
        return b"contract code"

    def contract(self, address, abi):
        if address.lower() == CONTRACT:
            answers = {"VERSION": 1, "UNIT": UNIT, "MUPPETS": MUPPETS,
                       "nextDropId": self.next_id, "allowedToken": True, "owner": SAFE,
                       "liability": self.balance, "isClaimed": self.claimed,
                       "drops": [TOKEN, 10**18, 0, 100, bytes.fromhex(HASH[2:]), bytes.fromhex(self.root[2:]),
                                 bytes.fromhex(manifest_hash(self.manifest)[2:])]}
        elif address.lower() == SAFE:
            answers = {"getThreshold": self.threshold, "getOwners": [ALICE, BOB]}
        elif address.lower() == MUPPETS:
            answers = {"totalSupply": 13 * UNIT, "decimals": 18,
                       "balanceOf": lambda who: 1 if self.counterfeit_balance else {
                           ALICE: UNIT, BOB: 2 * UNIT, LP: 10 * UNIT}[who.lower()]}
        else:
            answers = {"balanceOf": lambda who: self.publisher_balance if who.lower() == SAFE else self.balance}
        return SimpleNamespace(functions=Functions(answers))


def service(tmp_path):
    manifest = make_manifest()
    (tmp_path / "0.json").write_bytes(canonical_bytes(manifest))
    settings = replace(Settings(), factory_address="", stock_drops_address=CONTRACT,
                       stock_drops_manifest_dir=tmp_path, database_path=tmp_path / "db.sqlite")
    eth = FakeEth()
    return StockDropService(settings, SimpleNamespace(eth=eth)), eth


def test_api_funded_wallet_claim_and_no_allocation(tmp_path):
    reader, eth = service(tmp_path)
    state = reader.read(ALICE)
    assert StockDropResponse.model_validate(state).drops[0].status == "funded"
    assert state["status"] == "available"
    assert state["block_number"] == 1000
    assert state["drops"][0]["status"] == "funded"
    assert state["drops"][0]["allocation"]["amount_raw"] == "333333333333333333"
    assert not state["drops"][0]["allocation"]["claimed"]
    eth.claimed = True
    assert reader.read(ALICE)["drops"][0]["allocation"]["claimed"]
    assert reader.read(LP)["drops"][0]["allocation"] is None


@pytest.mark.parametrize("failure", ["missing", "wrong_root", "undercollateralized", "wrong_chain"])
def test_api_fails_closed_on_missing_or_invalid_evidence(tmp_path, failure):
    reader, eth = service(tmp_path)
    if failure == "missing":
        (tmp_path / "0.json").unlink()
    elif failure == "wrong_root":
        eth.root = "0x" + "00" * 32
    elif failure == "undercollateralized":
        eth.balance = 1
    else:
        eth.chain_id = 1
    state = reader.read(ALICE)
    if failure == "wrong_chain":
        assert state["status"] == "unavailable"
        assert state["total_drops"] is None
    else:
        assert state["drops"][0]["status"] == "unavailable"
        assert state["drops"][0]["allocation"] is None


def test_archive_verification_rejects_counterfeit_balances_and_recent_snapshot():
    eth = FakeEth()
    verify_snapshot(SimpleNamespace(eth=eth), snapshot())
    eth.counterfeit_balance = True
    with pytest.raises(ValueError, match="Historical balance mismatch"):
        verify_snapshot(SimpleNamespace(eth=eth), snapshot())
    eth.block_number = 105
    with pytest.raises(ValueError, match="12 blocks"):
        verify_snapshot(SimpleNamespace(eth=eth), snapshot())


def test_publisher_bundle_encodes_exact_approval_budget_and_manifest(tmp_path):
    manifest = make_manifest()
    path = tmp_path / "0.json"
    path.write_bytes(canonical_bytes(manifest))
    eth = FakeEth()
    eth.next_id = 0
    bundle = prepare(SimpleNamespace(eth=eth), path)
    assert bundle["chainId"] == "4663"
    assert bundle["meta"]["createdFromSafeAddress"] == SAFE
    approval, funding = bundle["transactions"]
    assert approval["to"].lower() == TOKEN
    assert funding["to"].lower() == CONTRACT
    assert approval["value"] == funding["value"] == "0"
    assert bytes.fromhex(approval["data"][2:10]) == keccak(text="approve(address,uint256)")[:4]
    assert decode(["address", "uint256"], bytes.fromhex(approval["data"][10:])) == (CONTRACT, 10**18)
    signature = "fundDrop(uint256,address,uint256,uint256,bytes32,bytes32,bytes32)"
    assert bytes.fromhex(funding["data"][2:10]) == keccak(text=signature)[:4]
    args = decode(["uint256", "address", "uint256", "uint256", "bytes32", "bytes32", "bytes32"],
                  bytes.fromhex(funding["data"][10:]))
    assert args == (0, TOKEN, 10**18, 100, bytes.fromhex(HASH[2:]), bytes.fromhex(manifest.root[2:]),
                    bytes.fromhex(manifest_hash(manifest)[2:]))


@pytest.mark.parametrize("failure", ["nonce", "balance", "threshold"])
def test_publisher_bundle_rejects_unready_funding(tmp_path, failure):
    path = tmp_path / "0.json"
    path.write_bytes(canonical_bytes(make_manifest()))
    eth = FakeEth()
    eth.next_id = 0
    if failure == "nonce":
        eth.next_id = 1
    elif failure == "balance":
        eth.publisher_balance = 1
    else:
        eth.threshold = 1
    with pytest.raises(ValueError):
        prepare(SimpleNamespace(eth=eth), path)


def test_routes_validate_wallet_pagination_manifest_and_unconfigured_state(tmp_path: Path):
    settings = replace(Settings(), factory_address="", stock_drops_address="", database_path=tmp_path / "db.sqlite",
                       stock_drops_manifest_dir=tmp_path)
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/stock-drops")
        assert response.json()["status"] == "not_configured"
        assert response.json()["total_drops"] is None
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/api/v1/stock-drops?wallet=invalid").status_code == 422
        assert client.get("/api/v1/stock-drops?before=-1").status_code == 422
        assert client.get("/api/v1/stock-drops/0/manifest").status_code == 404
        (tmp_path / "0.json").write_bytes(canonical_bytes(make_manifest()))
        assert client.get("/api/v1/stock-drops/0/manifest").content == canonical_bytes(make_manifest())
