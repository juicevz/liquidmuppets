from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from threading import RLock
from time import monotonic, sleep
from typing import Any, cast

from web3 import Web3
from web3._utils.events import get_event_data

from app.config import Settings
from app.database import Database, PerformanceCheckpointRecord
from app.services.chain import FACTORY_ABI, ChainService
from app.services.strategy import TASKS

logger = logging.getLogger(__name__)

PERFORMANCE_RPC_RETRY_DELAYS = (0.0, 0.25, 0.75, 1.5, 3.0)

VAULT_PERFORMANCE_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "asset", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
    {"type": "function", "name": "adapter", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
    {
        "type": "function",
        "name": "totalSupply",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
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
    {
        "type": "function",
        "name": "convertToAssets",
        "stateMutability": "view",
        "inputs": [{"name": "shares", "type": "uint256"}],
        "outputs": [{"type": "uint256"}],
    },
]

ERC20_METADATA_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
]

KEY_PERFORMANCE_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {
        "type": "function",
        "name": "totalSupply",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "totalBound",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
]

KEY_MARKET_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "feeBps", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint16"}]},
    {
        "type": "function",
        "name": "nextListingId",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "nextOfferId",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
    {
        "type": "function",
        "name": "listings",
        "stateMutability": "view",
        "inputs": [{"type": "uint256"}],
        "outputs": [
            {"name": "seller", "type": "address"},
            {"name": "key", "type": "address"},
            {"name": "quantity", "type": "uint128"},
            {"name": "unitPriceWei", "type": "uint128"},
            {"name": "active", "type": "bool"},
        ],
    },
    {
        "type": "function",
        "name": "offers",
        "stateMutability": "view",
        "inputs": [{"type": "uint256"}],
        "outputs": [
            {"name": "buyer", "type": "address"},
            {"name": "key", "type": "address"},
            {"name": "quantity", "type": "uint128"},
            {"name": "unitPriceWei", "type": "uint128"},
            {"name": "escrowWei", "type": "uint256"},
            {"name": "active", "type": "bool"},
        ],
    },
]

FLOW_EVENT_ABIS: list[dict[str, Any]] = [
    {
        "type": "event",
        "name": "Deposit",
        "anonymous": False,
        "inputs": [
            {"name": "sender", "type": "address", "indexed": True},
            {"name": "owner", "type": "address", "indexed": True},
            {"name": "assets", "type": "uint256", "indexed": False},
            {"name": "shares", "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event",
        "name": "Withdraw",
        "anonymous": False,
        "inputs": [
            {"name": "sender", "type": "address", "indexed": True},
            {"name": "receiver", "type": "address", "indexed": True},
            {"name": "owner", "type": "address", "indexed": True},
            {"name": "assets", "type": "uint256", "indexed": False},
            {"name": "shares", "type": "uint256", "indexed": False},
        ],
    },
]

STABLE_ADAPTER_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "marketId", "stateMutability": "view", "inputs": [], "outputs": [{"type": "bytes32"}]},
    {
        "type": "function",
        "name": "minMarketSupplyAssets",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint128"}],
    },
    {
        "type": "function",
        "name": "maxUtilizationBps",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint16"}],
    },
    {
        "type": "function",
        "name": "getMarketParams",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "loanToken", "type": "address"},
                    {"name": "collateralToken", "type": "address"},
                    {"name": "oracle", "type": "address"},
                    {"name": "irm", "type": "address"},
                    {"name": "lltv", "type": "uint256"},
                ],
            }
        ],
    },
    {
        "type": "function",
        "name": "marketHealth",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {"name": "totalSupplyAssets", "type": "uint256"},
            {"name": "totalBorrowAssets", "type": "uint256"},
            {"name": "utilizationBps", "type": "uint256"},
            {"name": "oraclePrice", "type": "uint256"},
        ],
    },
]

RANGE_ADAPTER_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "pool", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
    {"type": "function", "name": "core", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
    {"type": "function", "name": "usdg", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
    {"type": "function", "name": "poolFee", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint24"}]},
    {
        "type": "function",
        "name": "tickSpacing",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "int24"}],
    },
    {
        "type": "function",
        "name": "halfRangeTicks",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "int24"}],
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
        "name": "positionKey",
        "stateMutability": "view",
        "inputs": [{"name": "vault", "type": "address"}],
        "outputs": [{"type": "bytes32"}],
    },
    {
        "type": "function",
        "name": "currentRange",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"name": "lower", "type": "int24"}, {"name": "upper", "type": "int24"}],
    },
    {
        "type": "function",
        "name": "wethPriceUsdg",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
    },
]

RANGE_OPENED_ABI: dict[str, Any] = {
    "type": "event",
    "name": "RangeOpened",
    "anonymous": False,
    "inputs": [
        {"name": "vault", "type": "address", "indexed": True},
        {"name": "key", "type": "bytes32", "indexed": True},
        {"name": "tickLower", "type": "int24", "indexed": False},
        {"name": "tickUpper", "type": "int24", "indexed": False},
        {"name": "usdgIn", "type": "uint256", "indexed": False},
    ],
}

POOL_HEALTH_ABI: list[dict[str, Any]] = [
    {"type": "function", "name": "token0", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
    {"type": "function", "name": "token1", "stateMutability": "view", "inputs": [], "outputs": [{"type": "address"}]},
    {
        "type": "function",
        "name": "liquidity",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "uint128"}],
    },
    {
        "type": "function",
        "name": "slot0",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [
            {"name": "sqrtPriceX96", "type": "uint160"},
            {"name": "tick", "type": "int24"},
            {"name": "observationIndex", "type": "uint16"},
            {"name": "observationCardinality", "type": "uint16"},
            {"name": "observationCardinalityNext", "type": "uint16"},
            {"name": "feeProtocol", "type": "uint8"},
            {"name": "unlocked", "type": "bool"},
        ],
    },
]

EZ_CORE_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "isPoolAllowed",
        "stateMutability": "view",
        "inputs": [{"name": "pool", "type": "address"}],
        "outputs": [{"type": "bool"}],
    },
    {
        "type": "function",
        "name": "isPoolDeprecated",
        "stateMutability": "view",
        "inputs": [{"name": "pool", "type": "address"}],
        "outputs": [{"type": "bool"}],
    },
]

LAUNCH_ADAPTER_ABI: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "reserveOf",
        "stateMutability": "view",
        "inputs": [{"name": "vault", "type": "address"}],
        "outputs": [{"type": "uint256"}],
    }
]


@dataclass(frozen=True)
class AgentSnapshot:
    agent_id: int
    name: str
    creator: str
    pet_id: int
    task_id: int
    created_at: int
    vault: str
    key: str
    adapter: str
    asset: str
    asset_symbol: str
    asset_decimals: int
    share_symbol: str
    share_decimals: int
    total_assets: int
    total_supply: int
    share_price_raw: int
    idle_assets: int
    deployed_assets: int
    block_number: int
    block_timestamp: str


def flow_adjusted_change(
    opening_assets: int,
    current_assets: int,
    cumulative_deposits: int,
    cumulative_withdrawals: int,
) -> tuple[int, int | None]:
    change = current_assets + cumulative_withdrawals - cumulative_deposits - opening_assets
    tracked_capital = opening_assets + cumulative_deposits
    basis_points = int(Decimal(change * 10_000) / Decimal(tracked_capital)) if tracked_capital > 0 else None
    return change, basis_points


class PerformanceService:
    def __init__(
        self,
        settings: Settings,
        database: Database,
        chain: ChainService,
    ) -> None:
        self.settings = settings
        self.database = database
        self.chain = chain
        self.web3 = chain.web3
        self._flow_abis = {_event_topic(abi): abi for abi in FLOW_EVENT_ABIS}
        self._lock = RLock()
        self._snapshot_cache: dict[int, tuple[float, AgentSnapshot]] = {}
        self._response_cache: dict[int, tuple[float, dict[str, object]]] = {}

    def capture_all(self) -> int:
        if not self.settings.factory_address:
            return 0
        factory = self.web3.eth.contract(
            address=Web3.to_checksum_address(self.settings.factory_address),
            abi=FACTORY_ABI,
        )
        count = int(self._retry_call(lambda: factory.functions.agentCount().call()))
        captured = 0
        for agent_id in range(count):
            try:
                self.capture_agent(agent_id)
            except Exception as error:
                logger.warning("performance checkpoint skipped for Muppet %s: %s", agent_id, type(error).__name__)
                continue
            captured += 1
        return captured

    def capture_agent(self, agent_id: int) -> tuple[dict[str, object], AgentSnapshot]:
        with self._lock:
            cached = self._snapshot_cache.get(agent_id)
            if cached is not None and monotonic() - cached[0] <= 20:
                snapshot = cached[1]
                latest = self.database.get_latest_performance_checkpoint(snapshot.vault)
                if latest is not None and not _checkpoint_due(
                    latest,
                    self.settings.performance_checkpoint_interval_seconds,
                ):
                    return latest, snapshot
            return self._capture_agent(agent_id)

    def _capture_agent(self, agent_id: int) -> tuple[dict[str, object], AgentSnapshot]:
        snapshot = self._read_agent_snapshot(agent_id)
        self._snapshot_cache[agent_id] = (monotonic(), snapshot)
        latest = self.database.get_latest_performance_checkpoint(snapshot.vault)
        if latest is not None and not _checkpoint_due(latest, self.settings.performance_checkpoint_interval_seconds):
            return latest, snapshot

        deposits = _row_int(latest, "cumulative_deposits") if latest else 0
        withdrawals = _row_int(latest, "cumulative_withdrawals") if latest else 0
        if latest is not None and snapshot.block_number > _row_int(latest, "block_number"):
            new_deposits, new_withdrawals = self._read_flows(
                snapshot.vault,
                _row_int(latest, "block_number") + 1,
                snapshot.block_number,
            )
            deposits += new_deposits
            withdrawals += new_withdrawals

        row = self.database.add_performance_checkpoint(
            PerformanceCheckpointRecord(
                agent_id=snapshot.agent_id,
                vault=snapshot.vault,
                task_id=snapshot.task_id,
                block_number=snapshot.block_number,
                block_timestamp=snapshot.block_timestamp,
                asset_symbol=snapshot.asset_symbol,
                asset_decimals=snapshot.asset_decimals,
                share_symbol=snapshot.share_symbol,
                share_decimals=snapshot.share_decimals,
                total_assets=str(snapshot.total_assets),
                total_supply=str(snapshot.total_supply),
                share_price_raw=str(snapshot.share_price_raw),
                idle_assets=str(snapshot.idle_assets),
                deployed_assets=str(snapshot.deployed_assets),
                cumulative_deposits=str(deposits),
                cumulative_withdrawals=str(withdrawals),
            )
        )
        return row, snapshot

    def get_agent_performance(self, agent_id: int) -> dict[str, object]:
        with self._lock:
            cached = self._response_cache.get(agent_id)
            if cached is not None and monotonic() - cached[0] <= 20:
                return cached[1]
            try:
                _, snapshot = self.capture_agent(agent_id)
                raw_history = self.database.list_performance_checkpoints(agent_id)
                if not raw_history:
                    raise RuntimeError("performance tracking has not started")
                opening = _row_int(raw_history[0], "total_assets")
                history = [_checkpoint_payload(row, opening) for row in _downsample(raw_history, 500)]
                current = _checkpoint_payload(raw_history[-1], opening)
                keeper = self.database.get_last_keeper_run(snapshot.vault)
                response: dict[str, object] = {
                    "network": {
                        "chain_id": self.settings.chain_id,
                        "chain_name": self.settings.chain_name,
                        "explorer_url": self.settings.explorer_url,
                    },
                    "agent": {
                        "id": snapshot.agent_id,
                        "name": snapshot.name,
                        "creator": snapshot.creator,
                        "pet_id": snapshot.pet_id,
                        "task_id": snapshot.task_id,
                        "task_label": TASKS[cast(Any, snapshot.task_id)].label,
                        "created_at": snapshot.created_at,
                        "vault": snapshot.vault,
                        "key": snapshot.key,
                    },
                    "tracking_started_at": raw_history[0]["block_timestamp"],
                    "captured_at": raw_history[-1]["captured_at"],
                    "asset": {
                        "address": snapshot.asset,
                        "symbol": snapshot.asset_symbol,
                        "decimals": snapshot.asset_decimals,
                    },
                    "share": {"symbol": snapshot.share_symbol, "decimals": snapshot.share_decimals},
                    "current": current,
                    "history": history,
                    "change_method": {
                        "id": "cash_flow_adjusted_since_tracking",
                        "label": "cash-flow adjusted since tracking began",
                        "explanation": (
                            "Vault asset change after subtracting recorded deposits and adding recorded withdrawals. "
                            "The percentage uses opening NAV plus recorded deposits as tracked capital. It is not APY."
                        ),
                    },
                    "market": self._read_market(snapshot),
                    "keeper": keeper,
                    "key_market": self._key_market(snapshot),
                }
            except Exception:
                if cached is not None:
                    return cached[1]
                raise
            self._response_cache[agent_id] = (monotonic(), response)
            return response

    def _read_agent_snapshot(self, agent_id: int) -> AgentSnapshot:
        if not self.settings.factory_address:
            raise RuntimeError("factory is not configured")
        factory = self.web3.eth.contract(
            address=Web3.to_checksum_address(self.settings.factory_address),
            abi=FACTORY_ABI,
        )
        block_number = int(self._retry_call(lambda: self.web3.eth.block_number))
        count = int(self._retry_call(lambda: factory.functions.agentCount().call(block_identifier=block_number)))
        if agent_id < 0 or agent_id >= count:
            raise LookupError("Muppet not found")
        record = self._retry_call(lambda: factory.functions.getAgent(agent_id).call(block_identifier=block_number))
        vault_address = Web3.to_checksum_address(record[1])
        key_address = Web3.to_checksum_address(record[2])
        vault = self.web3.eth.contract(address=vault_address, abi=VAULT_PERFORMANCE_ABI)
        vault_values = self._batch_at_block(
            [
                vault.functions.asset(),
                vault.functions.adapter(),
                vault.functions.symbol(),
                vault.functions.decimals(),
                vault.functions.totalSupply(),
                vault.functions.totalAssets(),
                vault.functions.idleAssets(),
                vault.functions.deployedAssets(),
            ],
            block_number,
        )
        asset_address = Web3.to_checksum_address(vault_values[0])
        asset = self.web3.eth.contract(address=asset_address, abi=ERC20_METADATA_ABI)
        share_decimals = int(vault_values[3])
        asset_values = self._batch_at_block(
            [
                asset.functions.symbol(),
                asset.functions.decimals(),
                vault.functions.convertToAssets(10**share_decimals),
            ],
            block_number,
        )
        block = self._retry_call(lambda: self.web3.eth.get_block(block_number))
        return AgentSnapshot(
            agent_id=agent_id,
            name=str(record[7]),
            creator=Web3.to_checksum_address(record[0]),
            pet_id=int(record[3]),
            task_id=int(record[4]),
            created_at=int(record[5]),
            vault=vault_address,
            key=key_address,
            adapter=Web3.to_checksum_address(vault_values[1]),
            asset=asset_address,
            asset_symbol=str(asset_values[0]),
            asset_decimals=int(asset_values[1]),
            share_symbol=str(vault_values[2]),
            share_decimals=share_decimals,
            total_assets=int(vault_values[5]),
            total_supply=int(vault_values[4]),
            share_price_raw=int(asset_values[2]),
            idle_assets=int(vault_values[6]),
            deployed_assets=int(vault_values[7]),
            block_number=block_number,
            block_timestamp=datetime.fromtimestamp(int(block["timestamp"]), UTC).isoformat(),
        )

    def _read_flows(self, vault: str, from_block: int, to_block: int) -> tuple[int, int]:
        if from_block > to_block:
            return 0, 0
        logs = self._retry_call(
            lambda: self.web3.eth.get_logs(
                {
                    "fromBlock": from_block,
                    "toBlock": to_block,
                    "address": Web3.to_checksum_address(vault),
                    "topics": [[Web3.to_hex(topic) for topic in self._flow_abis]],
                }
            )
        )
        deposits = 0
        withdrawals = 0
        for log in logs:
            if not log["topics"]:
                continue
            abi = self._flow_abis.get(bytes(log["topics"][0]))
            if abi is None:
                continue
            event = get_event_data(self.web3.codec, abi, log)
            assets = int(event["args"]["assets"])
            if event["event"] == "Deposit":
                deposits += assets
            else:
                withdrawals += assets
        return deposits, withdrawals

    def _read_market(self, snapshot: AgentSnapshot) -> dict[str, object]:
        task = TASKS[cast(Any, snapshot.task_id)]
        common: dict[str, object] = {
            "task_id": snapshot.task_id,
            "route": task.production_route,
            "asset": {"address": snapshot.asset, "symbol": snapshot.asset_symbol},
            "adapter": snapshot.adapter,
        }
        try:
            if snapshot.task_id == 0:
                return {**common, **self._read_stable_market(snapshot)}
            if snapshot.task_id == 1:
                return {**common, **self._read_range_market(snapshot)}
            return {**common, **self._read_launch_market(snapshot)}
        except Exception as error:
            return {
                **common,
                "venue": "unavailable",
                "pool": None,
                "range": None,
                "oracle": {
                    "status": "unavailable",
                    "updated_at": None,
                    "age_seconds": None,
                    "detail": "Market evidence could not be read from the current RPC response.",
                },
                "health": {"status": "unavailable", "detail": type(error).__name__, "metrics": {}},
            }

    def _read_stable_market(self, snapshot: AgentSnapshot) -> dict[str, object]:
        block = snapshot.block_number
        adapter = self.web3.eth.contract(
            address=Web3.to_checksum_address(snapshot.adapter),
            abi=STABLE_ADAPTER_ABI,
        )
        values = self._batch_at_block(
            [
                adapter.functions.marketId(),
                adapter.functions.getMarketParams(),
                adapter.functions.marketHealth(),
                adapter.functions.minMarketSupplyAssets(),
                adapter.functions.maxUtilizationBps(),
            ],
            block,
        )
        market_id = Web3.to_hex(values[0])
        params = values[1]
        health = values[2]
        minimum_supply = int(values[3])
        maximum_utilization = int(values[4])
        healthy = int(health[0]) >= minimum_supply and int(health[2]) <= maximum_utilization and int(health[3]) > 0
        return {
            "venue": "Morpho Blue",
            "pair": "USDe / USDG",
            "pool": None,
            "market_id": market_id,
            "range": None,
            "oracle": {
                "status": "value_available_timestamp_not_exposed" if int(health[3]) > 0 else "unavailable",
                "address": Web3.to_checksum_address(params[2]),
                "updated_at": None,
                "age_seconds": None,
                "detail": (
                    "The adapter reads a nonzero Morpho oracle price. "
                    "This oracle interface does not expose an update timestamp."
                ),
            },
            "health": {
                "status": "healthy" if healthy else "blocked",
                "detail": "Supply, utilization and nonzero oracle checks match the adapter's allocation gates.",
                "metrics": {
                    "total_supply_assets_raw": str(int(health[0])),
                    "total_borrow_assets_raw": str(int(health[1])),
                    "utilization_bps": int(health[2]),
                    "maximum_utilization_bps": maximum_utilization,
                    "minimum_supply_assets_raw": str(minimum_supply),
                    "oracle_price_raw": str(int(health[3])),
                    "loan_token": Web3.to_checksum_address(params[0]),
                    "collateral_token": Web3.to_checksum_address(params[1]),
                },
            },
        }

    def _read_range_market(self, snapshot: AgentSnapshot) -> dict[str, object]:
        block = snapshot.block_number
        adapter = self.web3.eth.contract(
            address=Web3.to_checksum_address(snapshot.adapter),
            abi=RANGE_ADAPTER_ABI,
        )
        adapter_values = self._batch_at_block(
            [
                adapter.functions.pool(),
                adapter.functions.core(),
                adapter.functions.poolFee(),
                adapter.functions.tickSpacing(),
                adapter.functions.halfRangeTicks(),
                adapter.functions.slippageBps(),
                adapter.functions.positionKey(snapshot.vault),
                adapter.functions.currentRange(),
                adapter.functions.wethPriceUsdg(),
            ],
            block,
        )
        pool_address = Web3.to_checksum_address(adapter_values[0])
        core_address = Web3.to_checksum_address(adapter_values[1])
        pool = self.web3.eth.contract(address=pool_address, abi=POOL_HEALTH_ABI)
        core = self.web3.eth.contract(address=core_address, abi=EZ_CORE_ABI)
        pool_values = self._batch_at_block(
            [
                pool.functions.slot0(),
                pool.functions.liquidity(),
                core.functions.isPoolAllowed(pool_address),
                core.functions.isPoolDeprecated(pool_address),
                pool.functions.token0(),
                pool.functions.token1(),
            ],
            block,
        )
        slot0 = pool_values[0]
        current_tick = int(slot0[1])
        liquidity = int(pool_values[1])
        allowed = bool(pool_values[2])
        deprecated = bool(pool_values[3])
        price = int(adapter_values[8])
        position_key = Web3.to_hex(adapter_values[6])
        proposed = adapter_values[7]
        actual = self._last_opened_range(snapshot.adapter, snapshot.vault, block) if int(position_key, 16) else None
        lower = int(actual[0] if actual else proposed[0])
        upper = int(actual[1] if actual else proposed[1])
        is_open = int(position_key, 16) != 0
        healthy = allowed and not deprecated and liquidity > 0 and price > 0 and bool(slot0[6])
        return {
            "venue": "Uniswap V3 via EZManager",
            "pair": "WETH / USDG",
            "pool": pool_address,
            "market_id": None,
            "range": {
                "status": "open" if is_open else "next_target",
                "position_key": position_key if is_open else None,
                "lower_tick": lower,
                "upper_tick": upper,
                "current_tick": current_tick,
                "in_range": lower <= current_tick < upper if is_open else None,
                "tick_spacing": int(adapter_values[3]),
                "half_range_ticks": int(adapter_values[4]),
            },
            "oracle": {
                "status": "value_available_timestamp_not_exposed" if price > 0 else "unavailable",
                "updated_at": None,
                "age_seconds": None,
                "detail": (
                    "EZManager valuation returned a WETH value, but its interface does not expose an update timestamp."
                ),
                "price_raw": str(price),
            },
            "health": {
                "status": "healthy" if healthy else "blocked",
                "detail": (
                    "Pool allowlist, deprecation, liquidity, unlock and valuation checks are read directly onchain."
                ),
                "metrics": {
                    "pool_allowed": allowed,
                    "pool_deprecated": deprecated,
                    "pool_liquidity_raw": str(liquidity),
                    "pool_unlocked": bool(slot0[6]),
                    "pool_fee": int(adapter_values[2]),
                    "slippage_bps": int(adapter_values[5]),
                    "token0": Web3.to_checksum_address(pool_values[4]),
                    "token1": Web3.to_checksum_address(pool_values[5]),
                },
            },
        }

    def _read_launch_market(self, snapshot: AgentSnapshot) -> dict[str, object]:
        adapter = self.web3.eth.contract(
            address=Web3.to_checksum_address(snapshot.adapter),
            abi=LAUNCH_ADAPTER_ABI,
        )
        reserve = int(
            self._retry_call(
                lambda: adapter.functions.reserveOf(snapshot.vault).call(block_identifier=snapshot.block_number)
            )
        )
        return {
            "venue": "isolated vault reserve",
            "pair": "WETH reserve",
            "pool": None,
            "market_id": None,
            "range": None,
            "oracle": {
                "status": "not_used",
                "updated_at": None,
                "age_seconds": None,
                "detail": "This task does not trade against a pool or oracle. WETH remains in the isolated adapter.",
            },
            "health": {
                "status": "healthy" if reserve == snapshot.deployed_assets else "mismatch",
                "detail": "The adapter reserve is compared with the vault's deployed-assets accounting.",
                "metrics": {"reserve_assets_raw": str(reserve)},
            },
        }

    def _key_market(self, snapshot: AgentSnapshot) -> dict[str, object]:
        try:
            return self._read_key_market(snapshot)
        except Exception as error:
            return {
                "status": "unavailable",
                "detail": f"Agent Key market read unavailable: {type(error).__name__}",
                "symbol": None,
                "supply_raw": None,
                "total_bound_raw": None,
                "listed_raw": None,
                "floor_wei": None,
                "top_bid_wei": None,
                "fee_bps": None,
            }

    def _read_key_market(self, snapshot: AgentSnapshot) -> dict[str, object]:
        if not self.settings.key_marketplace_address:
            raise RuntimeError("Agent Key marketplace is not configured")
        key = self.web3.eth.contract(address=Web3.to_checksum_address(snapshot.key), abi=KEY_PERFORMANCE_ABI)
        market = self.web3.eth.contract(
            address=Web3.to_checksum_address(self.settings.key_marketplace_address),
            abi=KEY_MARKET_ABI,
        )
        summary = self._batch_at_block(
            [
                key.functions.symbol(),
                key.functions.totalSupply(),
                key.functions.totalBound(),
                market.functions.feeBps(),
                market.functions.nextListingId(),
                market.functions.nextOfferId(),
            ],
            snapshot.block_number,
        )
        listing_count = max(0, int(summary[4]) - 1)
        offer_count = max(0, int(summary[5]) - 1)
        orders = self._batch_at_block(
            [market.functions.listings(index) for index in range(1, listing_count + 1)]
            + [market.functions.offers(index) for index in range(1, offer_count + 1)],
            snapshot.block_number,
        )
        key_address = snapshot.key.lower()
        listings = [row for row in orders[:listing_count] if bool(row[4]) and str(row[1]).lower() == key_address]
        offers = [row for row in orders[listing_count:] if bool(row[5]) and str(row[1]).lower() == key_address]
        return {
            "status": "available",
            "detail": "Agent Key orderbook state read separately from vault accounting.",
            "symbol": str(summary[0]),
            "supply_raw": str(int(summary[1])),
            "total_bound_raw": str(int(summary[2])),
            "listed_raw": str(sum(int(row[2]) for row in listings)),
            "floor_wei": str(min(int(row[3]) for row in listings)) if listings else None,
            "top_bid_wei": str(max(int(row[3]) for row in offers)) if offers else None,
            "fee_bps": int(summary[3]),
        }

    def _batch_at_block(self, calls: list[Any], block_number: int) -> list[Any]:
        if not calls:
            return []
        rows: list[Any] = []
        for start in range(0, len(calls), 10):
            chunk = calls[start : start + 10]
            result = self._retry_call(lambda current_chunk=chunk: self._execute_batch(current_chunk, block_number))
            rows.extend(cast(list[Any], result))
        return rows

    def _execute_batch(self, calls: list[Any], block_number: int) -> list[Any]:
        with self.web3.batch_requests() as batch:
            for call in calls:
                batch.add(call.call(block_identifier=block_number))
            return cast(list[Any], batch.execute())

    def _retry_call(self, call: Any) -> Any:
        last_error: Exception | None = None
        for delay in PERFORMANCE_RPC_RETRY_DELAYS:
            if delay:
                sleep(delay)
            try:
                return call()
            except Exception as error:
                last_error = error
        if last_error is not None:
            raise last_error
        raise RuntimeError("performance RPC retry loop did not execute")

    def _last_opened_range(self, adapter: str, vault: str, to_block: int) -> tuple[int, int] | None:
        inputs = cast(list[dict[str, Any]], RANGE_OPENED_ABI["inputs"])
        signature = f"RangeOpened({','.join(str(item['type']) for item in inputs)})"
        vault_topic = Web3.to_hex(bytes.fromhex(vault[2:]).rjust(32, b"\x00"))
        logs = self._retry_call(
            lambda: self.web3.eth.get_logs(
                {
                    "fromBlock": self.settings.deployment_block,
                    "toBlock": to_block,
                    "address": Web3.to_checksum_address(adapter),
                    "topics": [Web3.to_hex(Web3.keccak(text=signature)), vault_topic],
                }
            )
        )
        if not logs:
            return None
        event = get_event_data(self.web3.codec, RANGE_OPENED_ABI, logs[-1])
        return int(event["args"]["tickLower"]), int(event["args"]["tickUpper"])


def _event_topic(abi: dict[str, Any]) -> bytes:
    inputs = cast(list[dict[str, Any]], abi["inputs"])
    signature = f"{abi['name']}({','.join(str(item['type']) for item in inputs)})"
    return bytes(Web3.keccak(text=signature))


def _checkpoint_due(row: dict[str, object], interval_seconds: int) -> bool:
    captured_at = datetime.fromisoformat(str(row["captured_at"]))
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=UTC)
    return (datetime.now(UTC) - captured_at).total_seconds() >= max(30, interval_seconds)


def _row_int(row: dict[str, object] | None, key: str) -> int:
    if row is None:
        return 0
    return int(str(row[key]))


def _checkpoint_payload(row: dict[str, object], opening_assets: int) -> dict[str, object]:
    total_assets = _row_int(row, "total_assets")
    deposits = _row_int(row, "cumulative_deposits")
    withdrawals = _row_int(row, "cumulative_withdrawals")
    change, basis_points = flow_adjusted_change(opening_assets, total_assets, deposits, withdrawals)
    return {
        "block_number": _row_int(row, "block_number"),
        "timestamp": str(row["block_timestamp"]),
        "total_assets_raw": str(row["total_assets"]),
        "total_supply_raw": str(row["total_supply"]),
        "share_price_raw": str(row["share_price_raw"]),
        "idle_assets_raw": str(row["idle_assets"]),
        "deployed_assets_raw": str(row["deployed_assets"]),
        "deposits_raw": str(row["cumulative_deposits"]),
        "withdrawals_raw": str(row["cumulative_withdrawals"]),
        "flow_adjusted_change_raw": str(change),
        "flow_adjusted_change_bps": basis_points,
    }


def _downsample(rows: list[dict[str, object]], maximum: int) -> list[dict[str, object]]:
    if len(rows) <= maximum:
        return rows
    indices = {round(index * (len(rows) - 1) / (maximum - 1)) for index in range(maximum)}
    return [rows[index] for index in sorted(indices)]
