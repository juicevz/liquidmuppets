from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Any, cast

from eth_account.signers.local import LocalAccount
from web3 import Web3

from app.config import Settings
from app.schemas import StrategyPreviewRequest, TaskId
from app.services.strategy import preview_strategy

VAULT_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "taskId", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
    {
        "type": "function",
        "name": "totalAssets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "idleAssets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "deployedAssets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
]

POLICY_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "executeAllocate",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "vault", "type": "address"}, {"name": "assets", "type": "uint256"}],
        "outputs": [],
    }
]

FACTORY_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "agentCount",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "getAgent",
        "stateMutability": "view",
        "inputs": [{"name": "id", "type": "uint256"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "creator", "type": "address"},
                    {"name": "vault", "type": "address"},
                    {"name": "key", "type": "address"},
                    {"name": "petId", "type": "uint8"},
                    {"name": "taskId", "type": "uint8"},
                    {"name": "createdAt", "type": "uint40"},
                    {"name": "baseFloorWei", "type": "uint128"},
                    {"name": "name", "type": "string"},
                ],
            }
        ],
    },
]


@dataclass(frozen=True)
class VaultState:
    vault: str
    task_id: int
    total_assets: int
    idle_assets: int
    deployed_assets: int


class ChainService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.web3 = Web3(Web3.HTTPProvider(settings.rpc_url, request_kwargs={"timeout": 8}))
        self._run_lock = Lock()
        self._transaction_lock = Lock()
        self._last_run: dict[str, float] = {}

    @property
    def contracts_configured(self) -> bool:
        addresses = (
            self.settings.factory_address,
            self.settings.policy_executor_address,
            self.settings.key_marketplace_address,
            self.settings.stable_adapter_address,
            self.settings.range_adapter_address,
            self.settings.launch_reserve_adapter_address,
        )
        if not all(addresses):
            return False
        try:
            if self.web3.eth.chain_id != self.settings.chain_id:
                return False
            return all(
                bool(self.web3.eth.get_code(Web3.to_checksum_address(address)))
                for address in addresses
            )
        except Exception:
            return False

    @property
    def keeper_configured(self) -> bool:
        return bool(self.settings.keeper_private_key and self.settings.policy_executor_address)

    def health(self) -> tuple[bool, int | None]:
        try:
            connected = self.web3.is_connected() and self.web3.eth.chain_id == self.settings.chain_id
            return connected, self.web3.eth.block_number if connected else None
        except Exception:
            return False, None

    def read_vault(self, vault_address: str) -> VaultState:
        vault = self.web3.eth.contract(address=Web3.to_checksum_address(vault_address), abi=VAULT_ABI)
        return VaultState(
            vault=Web3.to_checksum_address(vault_address),
            task_id=int(vault.functions.taskId().call()),
            total_assets=int(vault.functions.totalAssets().call()),
            idle_assets=int(vault.functions.idleAssets().call()),
            deployed_assets=int(vault.functions.deployedAssets().call()),
        )

    def list_vaults(self) -> list[str]:
        if not self.settings.factory_address:
            return []
        factory = self.web3.eth.contract(
            address=Web3.to_checksum_address(self.settings.factory_address),
            abi=FACTORY_ABI,
        )
        count = int(factory.functions.agentCount().call())
        return [str(factory.functions.getAgent(index).call()[1]) for index in range(count)]

    def run_keeper(self, vault_address: str, *, public_request: bool = True) -> tuple[VaultState, Any, str | None, str]:
        if public_request and not self.settings.allow_public_keeper_run:
            raise PermissionError("public keeper runs are disabled")
        if not self.keeper_configured:
            raise RuntimeError("keeper is not configured")

        vault_address = Web3.to_checksum_address(vault_address)
        with self._run_lock:
            now = monotonic()
            if now - self._last_run.get(vault_address, 0) < 300:
                raise RuntimeError("keeper run rate limit is active")
            self._last_run[vault_address] = now

        state = self.read_vault(vault_address)
        if state.task_id not in (0, 1, 2):
            raise RuntimeError("vault returned an unknown task id")
        preview = preview_strategy(
            StrategyPreviewRequest(
                task_id=cast(TaskId, state.task_id),
                total_assets=state.total_assets,
                idle_assets=state.idle_assets,
                deployed_assets=state.deployed_assets,
            )
        )
        if preview.action != "allocate":
            return state, preview, None, "skipped"

        account: LocalAccount = self.web3.eth.account.from_key(self.settings.keeper_private_key)
        policy = self.web3.eth.contract(
            address=Web3.to_checksum_address(self.settings.policy_executor_address),
            abi=POLICY_ABI,
        )
        with self._transaction_lock:
            nonce = self.web3.eth.get_transaction_count(account.address, "pending")
            transaction = policy.functions.executeAllocate(vault_address, preview.amount).build_transaction(
                {
                    "from": account.address,
                    "chainId": self.settings.chain_id,
                    "nonce": nonce,
                    "gasPrice": self.web3.eth.gas_price,
                }
            )
            transaction["gas"] = int(self.web3.eth.estimate_gas(transaction) * 12 // 10)
            signed = account.sign_transaction(cast(dict[str, Any], transaction))
            tx_hash = self.web3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self.web3.eth.wait_for_transaction_receipt(tx_hash, timeout=60, poll_latency=1)
        if int(receipt["status"]) != 1:
            raise RuntimeError("keeper transaction reverted")
        return state, preview, tx_hash.hex(), "confirmed"
