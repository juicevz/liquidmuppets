from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic, sleep
from typing import Any, cast

from eth_account.signers.local import LocalAccount
from web3 import Web3

from app.config import Settings
from app.database import Database
from app.schemas import StrategyPreviewRequest, TaskId
from app.services.rpc import FailoverHTTPProvider
from app.services.strategy import TASKS, preview_strategy

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
        "name": "keepers",
        "stateMutability": "view",
        "inputs": [{"name": "keeper", "type": "address"}],
        "outputs": [{"type": "bool"}],
    },
    {
        "type": "function",
        "name": "policies",
        "stateMutability": "view",
        "inputs": [{"name": "vault", "type": "address"}],
        "outputs": [
            {"name": "creator", "type": "address"},
            {"name": "maxSingleBps", "type": "uint16"},
            {"name": "maxDailyBps", "type": "uint16"},
            {"name": "maxAllocationBps", "type": "uint16"},
            {"name": "cooldownSeconds", "type": "uint32"},
            {"name": "expiresAt", "type": "uint40"},
            {"name": "lastActionAt", "type": "uint40"},
            {"name": "dayStartedAt", "type": "uint40"},
            {"name": "spentToday", "type": "uint256"},
            {"name": "paused", "type": "bool"},
            {"name": "exists", "type": "bool"},
        ],
    },
    {
        "type": "function",
        "name": "executeAllocate",
        "stateMutability": "nonpayable",
        "inputs": [{"name": "vault", "type": "address"}, {"name": "assets", "type": "uint256"}],
        "outputs": [],
    },
]

RWA_RESERVE_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "keepers",
        "stateMutability": "view",
        "inputs": [{"name": "keeper", "type": "address"}],
        "outputs": [{"type": "bool"}],
    },
    {
        "type": "function",
        "name": "routeCount",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "purchaseCount",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "nextRouteIndex",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint32"}],
    },
    {
        "type": "function",
        "name": "totalNativeSpent",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalUsdgSpent",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalFeesReceived",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "minimumCycleWei",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "maximumCycleWei",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "cooldownSeconds",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint32"}],
    },
    {
        "type": "function",
        "name": "slippageBps",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint16"}],
    },
    {
        "type": "function",
        "name": "lastCycleAt",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint40"}],
    },
    {"type": "function", "name": "paused", "stateMutability": "view", "inputs": [], "outputs": [{"type": "bool"}]},
    {
        "type": "function",
        "name": "availableCycleAmount",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "routeAt",
        "stateMutability": "view",
        "inputs": [{"name": "index", "type": "uint256"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "token", "type": "address"},
                    {"name": "feed", "type": "address"},
                    {"name": "pool", "type": "address"},
                    {"name": "poolFee", "type": "uint24"},
                    {"name": "maxOracleAge", "type": "uint32"},
                    {"name": "enabled", "type": "bool"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "nextUsableRoute",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}, {"type": "uint256"}, {"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "executeAvailableCycle",
        "stateMutability": "nonpayable",
        "inputs": [],
        "outputs": [{"type": "uint256"}, {"type": "uint256"}, {"type": "uint256"}],
    },
]

ERC20_READ_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {
        "type": "function",
        "name": "balanceOf",
        "stateMutability": "view",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
]

CHAIN_READ_RETRY_DELAYS = (0.0, 0.25, 0.75, 1.5)
RWA_READ_RETRY_DELAYS = CHAIN_READ_RETRY_DELAYS
RWA_CACHE_SECONDS = 60
RWA_RPC_BATCH_SIZE = 10

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
    def __init__(self, settings: Settings, database: Database | None = None) -> None:
        self.settings = settings
        self.database = database
        self.web3 = Web3(FailoverHTTPProvider(settings.rpc_urls, timeout=8))
        self._run_lock = Lock()
        self._transaction_lock = Lock()
        self._last_run: dict[str, float] = {}
        self._rwa_cache: tuple[float, dict[str, object]] | None = None
        self._rwa_cache_lock = Lock()

    @property
    def rpc_source(self) -> str:
        provider = self.web3.provider
        return provider.active_source if isinstance(provider, FailoverHTTPProvider) else "primary"

    def restore_persistent_state(self) -> None:
        if self.database is None:
            return
        stored = self.database.get_service_snapshot("rwa_reserve")
        if stored is None or not isinstance(stored.get("payload"), dict):
            return
        with self._rwa_cache_lock:
            self._rwa_cache = (0.0, cast(dict[str, object], stored["payload"]))

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
            return all(bool(self.web3.eth.get_code(Web3.to_checksum_address(address))) for address in addresses)
        except Exception:
            return False

    @property
    def keeper_configured(self) -> bool:
        if not (
            self.settings.keeper_private_key
            and self.settings.keeper_expected_address
            and self.settings.policy_executor_address
        ):
            return False
        try:
            account = self._keeper_account()
            policy = self.web3.eth.contract(
                address=Web3.to_checksum_address(self.settings.policy_executor_address),
                abi=POLICY_ABI,
            )
            if not bool(policy.functions.keepers(account.address).call()):
                return False
            if self.settings.fee_rwa_reserve_address:
                reserve = self._rwa_reserve()
                if not bool(reserve.functions.keepers(account.address).call()):
                    return False
            return True
        except Exception:
            return False

    @property
    def rwa_reserve_configured(self) -> bool:
        if not self.settings.fee_rwa_reserve_address:
            return False
        try:
            address = Web3.to_checksum_address(self.settings.fee_rwa_reserve_address)
            return bool(self.web3.eth.get_code(address))
        except Exception:
            return False

    def health(self) -> tuple[bool, int | None]:
        try:
            connected = self.web3.is_connected() and self.web3.eth.chain_id == self.settings.chain_id
            return connected, self.web3.eth.block_number if connected else None
        except Exception:
            return False, None

    def read_vault(self, vault_address: str) -> VaultState:
        last_error: Exception | None = None
        for delay in CHAIN_READ_RETRY_DELAYS:
            if delay:
                sleep(delay)
            try:
                return self._read_vault_once(vault_address)
            except Exception as error:
                last_error = error
        if last_error is not None:
            raise last_error
        raise RuntimeError("vault read failed")

    def _read_vault_once(self, vault_address: str) -> VaultState:
        vault = self.web3.eth.contract(address=Web3.to_checksum_address(vault_address), abi=VAULT_ABI)
        block_number = self.web3.eth.block_number
        return VaultState(
            vault=Web3.to_checksum_address(vault_address),
            task_id=int(vault.functions.taskId().call(block_identifier=block_number)),
            total_assets=int(vault.functions.totalAssets().call(block_identifier=block_number)),
            idle_assets=int(vault.functions.idleAssets().call(block_identifier=block_number)),
            deployed_assets=int(vault.functions.deployedAssets().call(block_identifier=block_number)),
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

    def read_rwa_reserve(self, *, fresh: bool = False) -> dict[str, object]:
        last_error: Exception | None = None
        for delay in RWA_READ_RETRY_DELAYS:
            if delay:
                sleep(delay)
            try:
                return self._read_rwa_reserve_once(fresh=fresh)
            except Exception as error:
                last_error = error
        if not fresh:
            with self._rwa_cache_lock:
                if self._rwa_cache is not None:
                    stale_state = dict(self._rwa_cache[1])
                    stale_state["stale"] = True
                    return stale_state
        if last_error is not None:
            raise last_error
        raise RuntimeError("RWA reserve read failed")

    def _batch_call(self, calls: list[Any]) -> list[Any]:
        rows: list[Any] = []
        for start in range(0, len(calls), RWA_RPC_BATCH_SIZE):
            with self.web3.batch_requests() as batch:
                for call in calls[start : start + RWA_RPC_BATCH_SIZE]:
                    batch.add(call)
                rows.extend(cast(list[Any], batch.execute()))
        return rows

    def _read_rwa_reserve_once(self, *, fresh: bool = False) -> dict[str, object]:
        if not self.rwa_reserve_configured:
            return {"configured": False, "address": self.settings.fee_rwa_reserve_address or None}
        with self._rwa_cache_lock:
            now = monotonic()
            if not fresh and self._rwa_cache is not None and self._rwa_cache[0] > now:
                return self._rwa_cache[1]

            reserve = self._rwa_reserve()
            calls = [
                reserve.functions.routeCount(),
                reserve.functions.purchaseCount(),
                reserve.functions.nextRouteIndex(),
                reserve.functions.totalNativeSpent(),
                reserve.functions.totalUsdgSpent(),
                reserve.functions.totalFeesReceived(),
                reserve.functions.minimumCycleWei(),
                reserve.functions.maximumCycleWei(),
                reserve.functions.cooldownSeconds(),
                reserve.functions.slippageBps(),
                reserve.functions.lastCycleAt(),
                reserve.functions.paused(),
                reserve.functions.availableCycleAmount(),
            ]
            summary = self._batch_call(calls)

            route_count = int(summary[0])
            raw_routes = self._batch_call([reserve.functions.routeAt(index) for index in range(route_count)])

            reserve_address = Web3.to_checksum_address(self.settings.fee_rwa_reserve_address)
            token_contracts = [
                self.web3.eth.contract(address=Web3.to_checksum_address(route[0]), abi=ERC20_READ_ABI)
                for route in raw_routes
            ]
            token_calls = [
                call
                for token in token_contracts
                for call in (token.functions.symbol(), token.functions.balanceOf(reserve_address))
            ]
            token_data = self._batch_call(token_calls)

            route_rows: list[dict[str, object]] = []
            for index, route in enumerate(raw_routes):
                route_rows.append(
                    {
                        "index": index,
                        "symbol": str(token_data[index * 2]),
                        "token": Web3.to_checksum_address(route[0]),
                        "feed": Web3.to_checksum_address(route[1]),
                        "pool": Web3.to_checksum_address(route[2]),
                        "poolFee": int(route[3]),
                        "maxOracleAge": int(route[4]),
                        "enabled": bool(route[5]),
                        "balanceRaw": str(int(token_data[index * 2 + 1])),
                    }
                )

            block = self.web3.eth.get_block("latest")
            state: dict[str, object] = {
                "configured": True,
                "address": reserve_address,
                "routeCount": route_count,
                "purchaseCount": int(summary[1]),
                "nextRouteIndex": int(summary[2]),
                "totalNativeSpentWei": str(int(summary[3])),
                "totalUsdgSpentRaw": str(int(summary[4])),
                "totalFeesReceivedWei": str(int(summary[5])),
                "minimumCycleWei": str(int(summary[6])),
                "maximumCycleWei": str(int(summary[7])),
                "cooldownSeconds": int(summary[8]),
                "slippageBps": int(summary[9]),
                "lastCycleAt": int(summary[10]),
                "paused": bool(summary[11]),
                "availableCycleWei": str(int(summary[12])),
                "nativeBalanceWei": str(self.web3.eth.get_balance(reserve_address)),
                "blockNumber": int(block["number"]),
                "stale": False,
                "routes": route_rows,
            }
            self._rwa_cache = (now + RWA_CACHE_SECONDS, state)
            if self.database is not None:
                self.database.upsert_service_snapshot("rwa_reserve", state)
            return state

    def run_keeper(self, vault_address: str, *, public_request: bool = True) -> tuple[VaultState, Any, str | None, str]:
        if public_request and not self.settings.allow_public_keeper_run:
            raise PermissionError("public keeper runs are disabled")
        if not self.keeper_configured:
            raise RuntimeError("keeper is not configured")

        vault_address = Web3.to_checksum_address(vault_address)
        with self._run_lock:
            if monotonic() - self._last_run.get(vault_address, 0) < 300:
                raise RuntimeError("keeper run rate limit is active")

        state = self.read_vault(vault_address)
        if state.task_id not in TASKS:
            raise RuntimeError("vault returned an unknown task id")
        preview = preview_strategy(
            StrategyPreviewRequest(
                task_id=cast(TaskId, state.task_id),
                total_assets=state.total_assets,
                idle_assets=state.idle_assets,
                deployed_assets=state.deployed_assets,
            )
        )
        with self._run_lock:
            self._last_run[vault_address] = monotonic()
        if preview.action != "allocate":
            return state, preview, None, "skipped"

        policy = self.web3.eth.contract(
            address=Web3.to_checksum_address(self.settings.policy_executor_address),
            abi=POLICY_ABI,
        )
        policy_state = policy.functions.policies(vault_address).call()
        block_timestamp = int(self.web3.eth.get_block("latest")["timestamp"])
        policy_reason: str | None = None
        if not bool(policy_state[10]):
            policy_reason = "vault policy is not registered"
        elif bool(policy_state[9]):
            policy_reason = "vault policy is paused"
        elif block_timestamp >= int(policy_state[5]):
            policy_reason = "vault policy has expired"
        elif int(policy_state[6]) and block_timestamp < int(policy_state[6]) + int(policy_state[4]):
            policy_reason = "vault policy cooldown is active"
        if policy_reason is not None:
            return (
                state,
                preview.model_copy(update={"action": "hold", "amount": 0, "reason": policy_reason}),
                None,
                "skipped",
            )

        account = self._keeper_account()
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

    def run_rwa_cycle(self, *, public_request: bool = True) -> tuple[int, str | None, str, str]:
        if public_request and not self.settings.allow_public_keeper_run:
            raise PermissionError("public keeper runs are disabled")
        if not self.keeper_configured:
            raise RuntimeError("keeper is not configured")
        if not self.rwa_reserve_configured:
            raise RuntimeError("fee RWA reserve is not configured")

        reserve_address = Web3.to_checksum_address(self.settings.fee_rwa_reserve_address)
        with self._run_lock:
            now = monotonic()
            if now - self._last_run.get(reserve_address, 0) < 300:
                raise RuntimeError("keeper run rate limit is active")
            self._last_run[reserve_address] = now

        reserve = self._rwa_reserve()
        amount = int(reserve.functions.availableCycleAmount().call())
        if amount == 0:
            return 0, None, "skipped", "reserve has not reached its purchase threshold"
        last_cycle_at = int(reserve.functions.lastCycleAt().call())
        cooldown = int(reserve.functions.cooldownSeconds().call())
        block_timestamp = int(self.web3.eth.get_block("latest")["timestamp"])
        if last_cycle_at and block_timestamp < last_cycle_at + cooldown:
            return amount, None, "skipped", "reserve purchase cooldown is active"
        try:
            reserve.functions.nextUsableRoute().call()
        except Exception as error:
            raise RuntimeError("no usable Stock Token route is available") from error

        account = self._keeper_account()
        with self._transaction_lock:
            nonce = self.web3.eth.get_transaction_count(account.address, "pending")
            transaction = reserve.functions.executeAvailableCycle().build_transaction(
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
            raise RuntimeError("RWA keeper transaction reverted")
        with self._rwa_cache_lock:
            self._rwa_cache = None
        return amount, tx_hash.hex(), "confirmed", "reserve funds purchased the next eligible Stock Token"

    def _keeper_account(self) -> LocalAccount:
        account: LocalAccount = self.web3.eth.account.from_key(self.settings.keeper_private_key)
        expected = Web3.to_checksum_address(self.settings.keeper_expected_address)
        if account.address != expected:
            raise RuntimeError("keeper key does not match KEEPER_EXPECTED_ADDRESS")
        return account

    def _rwa_reserve(self) -> Any:
        return self.web3.eth.contract(
            address=Web3.to_checksum_address(self.settings.fee_rwa_reserve_address),
            abi=RWA_RESERVE_ABI,
        )
