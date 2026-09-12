"""Read-only publisher tooling: snapshot, verify, allocate, prepare unsigned Safe calls.

Run from backend: .venv/bin/python -m app.stock_drops_cli --help
This module never signs, broadcasts, swaps, or reads a private key.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from eth_abi.abi import encode
from eth_utils.crypto import keccak
from web3 import Web3

from app.services.stock_drop_manifest import (
    MAX_HOLDERS,
    MUPPETS,
    STOCKS,
    UNIT,
    Exclusion,
    Holder,
    Snapshot,
    build_manifest,
    canonical_bytes,
    manifest_hash,
    read_manifest,
    validate_snapshot,
)
from app.services.stock_drops import DROP_ABI, function_abi

READ_ABI = [function_abi("balanceOf", ["address"], ["uint256"]),
            function_abi("totalSupply", [], ["uint256"]), function_abi("decimals", [], ["uint8"])]


def verify_snapshot(web3: Web3, snapshot: Snapshot) -> None:
    validate_snapshot(snapshot)
    if snapshot.chain_id != 4663 or web3.eth.chain_id != snapshot.chain_id:
        raise ValueError("Robinhood mainnet snapshot required.")
    block = snapshot.block_number
    if web3.eth.block_number - block < 12:
        raise ValueError("Wait at least 12 blocks before publishing the snapshot.")
    token = web3.eth.contract(address=Web3.to_checksum_address(MUPPETS), abi=READ_ABI)
    if token.functions.decimals().call(block_identifier=block) != 18:
        raise ValueError("Unexpected MUPPETS decimals.")
    if int(token.functions.totalSupply().call(block_identifier=block)) != int(snapshot.total_supply_raw):
        raise ValueError("Snapshot supply mismatch.")
    for holder in snapshot.holders:
        observed = token.functions.balanceOf(Web3.to_checksum_address(holder.account)).call(block_identifier=block)
        if int(observed) != int(holder.balance_raw):
            raise ValueError(f"Historical balance mismatch for {holder.account}.")
    if "0x" + bytes(web3.eth.get_block(block)["hash"]).hex() != snapshot.block_hash:
        raise ValueError("Snapshot block hash mismatch.")


def collect_snapshot(web3: Web3, block: int, holders_path: Path | None,
                     from_block: int | None, exclusions_path: Path | None) -> Snapshot:
    if web3.eth.chain_id != 4663 or web3.eth.block_number - block < 12:
        raise ValueError("Use Robinhood mainnet and a snapshot at least 12 blocks old.")
    token_address = Web3.to_checksum_address(MUPPETS)
    accounts: set[str]
    if holders_path:
        entries = json.loads(holders_path.read_text())
        if not isinstance(entries, list) or not all(
            isinstance(item, str) and Web3.is_address(item) for item in entries
        ):
            raise ValueError("Holder candidates must be a JSON array of addresses.")
        accounts = {item.lower() for item in entries}
    else:
        if from_block is None or not 0 < from_block <= block:
            raise ValueError("Provide --holders or the token deployment block with --from-block.")
        if web3.eth.get_code(token_address, block_identifier=from_block - 1):
            raise ValueError("--from-block must begin at token deployment, without an older token history.")
        accounts = set()
        topic = Web3.keccak(text="Transfer(address,address,uint256)")
        for start in range(from_block, block + 1, 20_000):
            logs = web3.eth.get_logs({"address": token_address, "topics": [topic],
                                     "fromBlock": start, "toBlock": min(block, start + 19_999)})
            for log in logs:
                if len(log["topics"]) != 3:
                    raise ValueError("Unexpected Transfer event.")
                accounts.update("0x" + bytes(value)[-20:].hex() for value in log["topics"][1:])
            if len(accounts) > MAX_HOLDERS:
                raise ValueError("Holder count exceeds the supported bound.")
    if len(accounts) > MAX_HOLDERS:
        raise ValueError("Too many holder candidates.")
    token = web3.eth.contract(address=token_address, abi=READ_ABI)
    holders = []
    for account in sorted(accounts):
        balance = int(token.functions.balanceOf(Web3.to_checksum_address(account)).call(block_identifier=block))
        if balance:
            holders.append(Holder(account=account, balance_raw=str(balance)))
    exclusions = ([Exclusion.model_validate(row) for row in json.loads(exclusions_path.read_text())]
                  if exclusions_path else [])
    snapshot = Snapshot(chain_id=4663, token=MUPPETS, block_number=block,
                        block_hash="0x" + bytes(web3.eth.get_block(block)["hash"]).hex(),
                        total_supply_raw=str(token.functions.totalSupply().call(block_identifier=block)),
                        holders=holders, exclusions=exclusions)
    verify_snapshot(web3, snapshot)
    return snapshot


def call_data(signature: str, types: list[str], values: list[object]) -> str:
    return "0x" + (keccak(text=signature)[:4] + encode(types, values)).hex()


def prepare(web3: Web3, manifest_path: Path) -> dict[str, object]:
    manifest = read_manifest(manifest_path.read_bytes())
    verify_snapshot(web3, manifest.snapshot)
    if manifest.reward_token not in STOCKS:
        raise ValueError("Unsupported reward asset.")
    address = Web3.to_checksum_address(manifest.contract)
    token_address = Web3.to_checksum_address(manifest.reward_token)
    if not web3.eth.get_code(address):
        raise ValueError("Deploy and independently verify Stock Drops before preparing funding.")
    abi = [*DROP_ABI, function_abi("owner", [], ["address"])]
    contract = web3.eth.contract(address=address, abi=abi)
    if (contract.functions.VERSION().call() != 1 or contract.functions.UNIT().call() != UNIT
            or contract.functions.MUPPETS().call().lower() != MUPPETS
            or int(contract.functions.nextDropId().call()) != int(manifest.drop_id)
            or not contract.functions.allowedToken(token_address).call()):
        raise ValueError("Contract identity, nonce or allowlist mismatch.")
    owner = contract.functions.owner().call()
    safe = web3.eth.contract(address=owner, abi=[function_abi("getOwners", [], ["address[]"]),
                                               function_abi("getThreshold", [], ["uint256"])])
    threshold = int(safe.functions.getThreshold().call())
    if not 2 <= threshold <= len(safe.functions.getOwners().call()):
        raise ValueError("Funding owner must meet the multisig policy.")
    token = web3.eth.contract(address=token_address, abi=READ_ABI)
    budget = int(manifest.budget_raw)
    if int(token.functions.balanceOf(owner).call()) < budget:
        raise ValueError("Publisher Safe does not hold the full stock-token budget.")
    approve = call_data("approve(address,uint256)", ["address", "uint256"], [address, budget])
    fund = call_data("fundDrop(uint256,address,uint256,uint256,bytes32,bytes32,bytes32)",
                     ["uint256", "address", "uint256", "uint256", "bytes32", "bytes32", "bytes32"],
                     [int(manifest.drop_id), token_address, budget, manifest.snapshot.block_number,
                      bytes.fromhex(manifest.snapshot.block_hash[2:]), bytes.fromhex(manifest.root[2:]),
                      bytes.fromhex(manifest_hash(manifest)[2:])])
    # Safe Transaction Builder import. Execute as one batch so the expected nonce cannot drift between calls.
    return {"version": "1.0", "chainId": "4663", "createdAt": 0,
            "meta": {"name": f"Fund Muppet Stock Drop {manifest.drop_id}",
                     "description": (f"{manifest.budget_raw} raw {STOCKS[manifest.reward_token]}; "
                                     f"full manifest {manifest_hash(manifest)}"),
                     "createdFromSafeAddress": owner},
            "transactions": [{"to": token_address, "value": "0", "data": approve},
                             {"to": address, "value": "0", "data": fund}]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc", default="https://rpc.mainnet.chain.robinhood.com")
    commands = parser.add_subparsers(dest="command", required=True)
    snapshot_cmd = commands.add_parser("snapshot", help="Collect and verify a complete historical balance snapshot.")
    snapshot_cmd.add_argument("--block", type=int, required=True)
    snapshot_cmd.add_argument("--holders", type=Path)
    snapshot_cmd.add_argument("--from-block", type=int)
    snapshot_cmd.add_argument("--exclusions", type=Path)
    snapshot_cmd.add_argument("--out", type=Path, required=True)
    build = commands.add_parser("build", help="Reverify archive balances and build canonical allocations.")
    build.add_argument("--snapshot", type=Path, required=True)
    build.add_argument("--contract", required=True)
    build.add_argument("--id", type=int, required=True)
    build.add_argument("--token", choices=sorted(STOCKS), required=True)
    build.add_argument("--budget-raw", type=int, required=True)
    build.add_argument("--out", type=Path, required=True)
    funding = commands.add_parser("prepare", help="Verify funding and write unsigned Safe transaction JSON.")
    funding.add_argument("--manifest", type=Path, required=True)
    funding.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    web3 = Web3(Web3.HTTPProvider(args.rpc, request_kwargs={"timeout": 15}))
    if args.command == "snapshot":
        result = collect_snapshot(web3, args.block, args.holders, args.from_block, args.exclusions)
        data = result.model_dump_json(indent=2).encode() + b"\n"
    elif args.command == "build":
        result = Snapshot.model_validate_json(args.snapshot.read_bytes())
        verify_snapshot(web3, result)
        data = canonical_bytes(build_manifest(result, args.contract, args.id, args.token, args.budget_raw))
    else:
        data = (json.dumps(prepare(web3, args.manifest), indent=2) + "\n").encode()
    # Never overwrite a reviewed manifest or transaction bundle accidentally.
    with args.out.open("xb") as output:
        output.write(data)
    print(f"Wrote {args.out}. No transaction was signed or broadcast.")


if __name__ == "__main__":
    main()
