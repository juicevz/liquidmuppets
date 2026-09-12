from __future__ import annotations

from typing import Any

from web3 import Web3

from app.config import Settings
from app.services.stock_drop_manifest import MAX_BYTES, MUPPETS, STOCKS, UNIT, Manifest, manifest_hash, read_manifest


def function_abi(name: str, inputs: list[str], outputs: list[str]) -> dict[str, Any]:
    return {"type": "function", "name": name, "stateMutability": "view",
            "inputs": [{"name": f"arg{i}", "type": kind} for i, kind in enumerate(inputs)],
            "outputs": [{"name": f"out{i}", "type": kind} for i, kind in enumerate(outputs)]}


DROP_ABI = [
    function_abi("VERSION", [], ["uint256"]),
    function_abi("UNIT", [], ["uint256"]),
    function_abi("MUPPETS", [], ["address"]),
    function_abi("nextDropId", [], ["uint256"]),
    function_abi("allowedToken", ["address"], ["bool"]),
    function_abi("liability", ["address"], ["uint256"]),
    function_abi("isClaimed", ["uint256", "uint256"], ["bool"]),
    function_abi("drops", ["uint256"], ["address", "uint256", "uint256", "uint256", "bytes32", "bytes32", "bytes32"]),
]
TOKEN_ABI = [function_abi("balanceOf", ["address"], ["uint256"])]


class StockDropService:
    def __init__(self, settings: Settings, web3: Web3) -> None:
        self.settings = settings
        self.web3 = web3

    def manifest(self, drop_id: int) -> Manifest:
        path = self.settings.stock_drops_manifest_dir / f"{drop_id}.json"
        with path.open("rb") as stream:
            return read_manifest(stream.read(MAX_BYTES + 1))

    def read(self, wallet: str | None = None, before: int | None = None) -> dict[str, Any]:
        address = self.settings.stock_drops_address
        state: dict[str, Any] = {
            "status": "not_configured", "reason": "Waiting for the first funded drop.",
            "chain_id": self.settings.chain_id, "rpc_url": self.settings.browser_rpc_url,
            "explorer_url": self.settings.explorer_url, "contract": address if Web3.is_address(address) else None,
            "unit_raw": str(UNIT), "block_number": None, "total_drops": None, "next_before": None,
            "wallet": wallet.lower() if wallet else None, "drops": [],
        }
        if not address:
            return state
        try:
            if self.web3.eth.chain_id != self.settings.chain_id:
                raise ValueError("Wrong RPC chain.")
            block = self.web3.eth.get_block("latest")
            block_number = int(block["number"])
            address = Web3.to_checksum_address(address)
            if not self.web3.eth.get_code(address, block_identifier=block_number):
                raise ValueError("No contract code.")
            contract = self.web3.eth.contract(address=address, abi=DROP_ABI)
            if (contract.functions.VERSION().call(block_identifier=block_number) != 1
                    or contract.functions.UNIT().call(block_identifier=block_number) != UNIT
                    or contract.functions.MUPPETS().call(block_identifier=block_number).lower() != MUPPETS):
                raise ValueError("Contract identity mismatch.")
            total = int(contract.functions.nextDropId().call(block_identifier=block_number))
            end = min(total, before if before is not None else total)
            start = max(0, end - 10)
            rows: list[dict[str, Any]] = []
            # Every row is checked at the same block. A bad/missing manifest disables only its own claim.
            for drop_id in reversed(range(start, end)):
                row: dict[str, Any] = {"id": str(drop_id), "status": "unavailable",
                                       "reason": "Allocation evidence is unavailable.", "allocation": None}
                try:
                    manifest = self.manifest(drop_id)
                    raw = contract.functions.drops(drop_id).call(block_identifier=block_number)
                    token = Web3.to_checksum_address(manifest.reward_token)
                    expected = (token.lower(), int(manifest.budget_raw), manifest.snapshot.block_number,
                                manifest.snapshot.block_hash, manifest.root, manifest_hash(manifest))
                    actual = (raw[0].lower(), int(raw[1]), int(raw[3]),
                              "0x" + bytes(raw[4]).hex(), "0x" + bytes(raw[5]).hex(), "0x" + bytes(raw[6]).hex())
                    if (manifest.contract != address.lower() or manifest.drop_id != str(drop_id)
                            or manifest.snapshot.chain_id != self.settings.chain_id or actual != expected
                            or manifest.reward_token not in STOCKS or int(raw[2]) > int(raw[1])):
                        raise ValueError("Manifest does not match contract.")
                    if not contract.functions.allowedToken(token).call(block_identifier=block_number):
                        raise ValueError("Unsupported asset.")
                    snapshot = self.web3.eth.get_block(manifest.snapshot.block_number)
                    if "0x" + bytes(snapshot["hash"]).hex() != manifest.snapshot.block_hash:
                        raise ValueError("Snapshot was reorganized.")
                    liability = int(contract.functions.liability(token).call(block_identifier=block_number))
                    token_contract = self.web3.eth.contract(address=token, abi=TOKEN_ABI)
                    balance = int(token_contract.functions.balanceOf(address).call(block_identifier=block_number))
                    if balance < liability or liability < int(raw[1]) - int(raw[2]):
                        raise ValueError("Reward funding is insufficient.")
                    allocation = next((item for item in manifest.allocations if item.account == state["wallet"]), None)
                    claim = allocation.model_dump() if allocation else None
                    if claim is not None and allocation is not None:
                        claim["claimed"] = bool(contract.functions.isClaimed(drop_id, allocation.index).call(
                            block_identifier=block_number))
                    row = {
                        "id": str(drop_id), "status": "funded", "reason": None,
                        "token": token, "symbol": STOCKS[manifest.reward_token], "decimals": 18,
                        "funded_raw": str(raw[1]), "claimed_raw": str(raw[2]),
                        "remaining_raw": str(int(raw[1]) - int(raw[2])), "root": manifest.root,
                        "manifest_hash": manifest_hash(manifest),
                        "manifest_url": f"/api/v1/stock-drops/{drop_id}/manifest",
                        "snapshot_block": manifest.snapshot.block_number,
                        "snapshot_hash": manifest.snapshot.block_hash,
                        "eligible_wallets": len(manifest.allocations),
                        "total_units": str(sum(int(item.units) for item in manifest.allocations)),
                        "exclusions": [item.model_dump() for item in manifest.snapshot.exclusions],
                        "allocation": claim,
                    }
                except Exception:
                    pass  # Never turn missing or mismatched evidence into a zero reward or an enabled claim.
                rows.append(row)
            if bytes(self.web3.eth.get_block(block_number)["hash"]) != bytes(block["hash"]):
                raise ValueError("Read block was reorganized.")
            state.update(status="available", reason=None, block_number=block_number, total_drops=total,
                         next_before=start if start else None, drops=rows)
        except Exception:
            state.update(status="unavailable", reason="Stock Drop evidence is reconnecting. Claims are unavailable.")
        return state
