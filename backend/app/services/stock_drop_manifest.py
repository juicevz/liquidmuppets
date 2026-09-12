"""Deterministic, integer-only holder allocations shared by publisher tooling and API.

Merkle inclusion establishes the publisher's commitment. Historical balance correctness
requires the separate archive-RPC verification performed by the publisher CLI.
"""
from __future__ import annotations

import json
from typing import Annotated, Literal

from eth_abi.abi import encode
from eth_utils.crypto import keccak
from pydantic import BaseModel, ConfigDict, Field

MUPPETS = "0x5e7516be1be5d4396b060908cd44c9db093c4189"
UNIT = 15_000 * 10**18
MAX_HOLDERS = 10_000
MAX_BYTES = 8_000_000
STOCKS = {
    "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": "AAPL",
    "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc": "AMD",
    "0x12f190a9f9d7d37a250758b26824b97ce941bf54": "AMZN",
    "0x47f93d52cbec7c6d2cfc080e154002370a60daea": "ASML",
}
Address = Annotated[str, Field(pattern=r"^0x[0-9a-f]{40}$")]
Hash32 = Annotated[str, Field(pattern=r"^0x[0-9a-f]{64}$")]
Raw = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]{0,77})$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Holder(StrictModel):
    account: Address
    balance_raw: Raw


class Exclusion(StrictModel):
    account: Address
    reason: Annotated[str, Field(min_length=1, max_length=240)]


class Snapshot(StrictModel):
    chain_id: Annotated[int, Field(gt=0, le=2**53 - 1)]
    token: Address
    block_number: Annotated[int, Field(gt=0, le=2**53 - 1)]
    block_hash: Hash32
    total_supply_raw: Raw
    holders: Annotated[list[Holder], Field(min_length=1, max_length=MAX_HOLDERS)]
    exclusions: Annotated[list[Exclusion], Field(max_length=MAX_HOLDERS)]


class Allocation(StrictModel):
    index: Annotated[int, Field(ge=0, lt=MAX_HOLDERS)]
    account: Address
    units: Raw
    amount_raw: Raw
    proof: Annotated[list[Hash32], Field(max_length=32)]


class Manifest(StrictModel):
    version: Literal[1]
    contract: Address
    drop_id: Raw
    reward_token: Address
    budget_raw: Raw
    unit_raw: Literal["15000000000000000000000"]
    snapshot: Snapshot
    root: Hash32
    allocations: Annotated[list[Allocation], Field(min_length=1, max_length=MAX_HOLDERS)]


def uint(raw: str) -> int:
    value = int(raw)
    if not 0 <= value < 2**256:
        raise ValueError("Value exceeds uint256.")
    return value


def canonical_bytes(manifest: Manifest) -> bytes:
    return (json.dumps(manifest.model_dump(), sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def manifest_hash(manifest: Manifest) -> str:
    return "0x" + keccak(canonical_bytes(manifest)).hex()


def leaf_hash(chain_id: int, contract: str, drop_id: int, index: int, account: str, amount: int) -> bytes:
    return bytes(keccak(keccak(encode(
        ["uint256", "address", "uint256", "uint256", "address", "uint256"],
        [chain_id, contract, drop_id, index, account, amount],
    ))))


def merkle_tree(leaves: list[bytes]) -> tuple[str, list[list[str]]]:
    if not leaves:
        raise ValueError("No eligible allocations.")
    layers = [leaves]
    while len(layers[-1]) > 1:
        level = layers[-1]
        layers.append([
            bytes(keccak(b"".join(sorted(level[i:i + 2])))) if i + 1 < len(level) else level[i]
            for i in range(0, len(level), 2)
        ])
    proofs = []
    for index in range(len(leaves)):
        proof = []
        for level in layers[:-1]:
            sibling = index ^ 1
            if sibling < len(level):
                proof.append("0x" + level[sibling].hex())
            index //= 2
        proofs.append(proof)
    return "0x" + layers[-1][0].hex(), proofs


def validate_snapshot(snapshot: Snapshot) -> None:
    if snapshot.token != MUPPETS or int(snapshot.block_hash, 16) == 0:
        raise ValueError("Canonical MUPPETS and a nonzero block hash are required.")
    accounts = [row.account for row in snapshot.holders]
    excluded = [row.account for row in snapshot.exclusions]
    if accounts != sorted(set(accounts)) or len(set(excluded)) != len(excluded):
        raise ValueError("Holder accounts must be unique and sorted; exclusions must be unique.")
    if not set(excluded).issubset(accounts):
        raise ValueError("Every exclusion must appear in the full holder snapshot.")
    supply = uint(snapshot.total_supply_raw)
    if supply == 0 or any(uint(row.balance_raw) == 0 for row in snapshot.holders):
        raise ValueError("Snapshot must contain positive balances and supply.")
    if sum(uint(row.balance_raw) for row in snapshot.holders) != supply:
        raise ValueError("Snapshot is incomplete: balances must sum to totalSupply before exclusions.")


def build_manifest(snapshot: Snapshot, contract: str, drop_id: int, reward_token: str, budget: int) -> Manifest:
    validate_snapshot(snapshot)
    if not 0 < budget < 2**256 or not 0 <= drop_id < 2**256:
        raise ValueError("Invalid budget or drop id.")
    excluded = {row.account for row in snapshot.exclusions}
    units = [(row.account, uint(row.balance_raw) // UNIT) for row in snapshot.holders if row.account not in excluded]
    units = [(account, count) for account, count in units if count > 0]
    if not units:
        raise ValueError("No eligible holders.")
    if any(account in {contract.lower(), MUPPETS, "0x" + "0" * 40, "0x" + "0" * 36 + "dead"} for account, _ in units):
        raise ValueError("Explicitly exclude contract, token and burn addresses with published reasons.")
    total_units = sum(count for _, count in units)
    amounts = [budget * count // total_units for _, count in units]
    # Largest remainder method allocates every raw token unit. Ties use ascending wallet address.
    order = sorted(range(len(units)), key=lambda i: (-(budget * units[i][1] % total_units), units[i][0]))
    for index in order[:budget - sum(amounts)]:
        amounts[index] += 1
    if any(amount == 0 for amount in amounts):
        raise ValueError("Budget is too small to give every eligible holder a positive allocation.")
    leaves = [leaf_hash(snapshot.chain_id, contract, drop_id, i, row[0], amounts[i]) for i, row in enumerate(units)]
    root, proofs = merkle_tree(leaves)
    return Manifest(
        version=1, contract=contract.lower(), drop_id=str(drop_id), reward_token=reward_token.lower(),
        budget_raw=str(budget), unit_raw="15000000000000000000000", snapshot=snapshot, root=root,
        allocations=[Allocation(index=i, account=row[0], units=str(row[1]), amount_raw=str(amounts[i]), proof=proofs[i])
                     for i, row in enumerate(units)],
    )


def read_manifest(data: bytes) -> Manifest:
    if len(data) > MAX_BYTES:
        raise ValueError("Manifest exceeds the size limit.")
    manifest = Manifest.model_validate_json(data)
    if data != canonical_bytes(manifest):
        raise ValueError("Manifest must use canonical encoding from the publisher tool.")
    rebuilt = build_manifest(manifest.snapshot, manifest.contract, uint(manifest.drop_id),
                             manifest.reward_token, uint(manifest.budget_raw))
    if rebuilt != manifest:
        raise ValueError("Allocations, proofs or policy do not match the full snapshot.")
    return manifest
