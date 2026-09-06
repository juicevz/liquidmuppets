from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from threading import Lock
from time import monotonic, sleep
from typing import Any, cast

from web3 import Web3
from web3._utils.events import get_event_data

from app.config import Settings
from app.services.chain import FACTORY_ABI

logger = logging.getLogger(__name__)


def _event(name: str, inputs: list[tuple[str, str, bool]]) -> dict[str, Any]:
    return {
        "anonymous": False,
        "type": "event",
        "name": name,
        "inputs": [{"name": field, "type": kind, "indexed": indexed} for field, kind, indexed in inputs],
    }


EVENT_ABIS = [
    _event(
        "AgentCreated",
        [
            ("agentId", "uint256", True),
            ("creator", "address", True),
            ("vault", "address", True),
            ("key", "address", False),
            ("petId", "uint8", False),
            ("taskId", "uint8", False),
            ("baseFloorWei", "uint256", False),
            ("name", "string", False),
        ],
    ),
    _event(
        "ListingCreated",
        [
            ("id", "uint256", True),
            ("key", "address", True),
            ("seller", "address", True),
            ("quantity", "uint256", False),
            ("unitPriceWei", "uint256", False),
        ],
    ),
    _event(
        "ListingFilled",
        [
            ("id", "uint256", True),
            ("buyer", "address", True),
            ("quantity", "uint256", False),
            ("subtotalWei", "uint256", False),
            ("feeWei", "uint256", False),
        ],
    ),
    _event(
        "OfferCreated",
        [
            ("id", "uint256", True),
            ("key", "address", True),
            ("buyer", "address", True),
            ("quantity", "uint256", False),
            ("unitPriceWei", "uint256", False),
        ],
    ),
    _event(
        "OfferFilled",
        [
            ("id", "uint256", True),
            ("seller", "address", True),
            ("quantity", "uint256", False),
            ("subtotalWei", "uint256", False),
            ("feeWei", "uint256", False),
        ],
    ),
    _event(
        "AllocationExecuted",
        [("vault", "address", True), ("keeper", "address", True), ("assets", "uint256", False)],
    ),
    _event(
        "RecallExecuted",
        [("vault", "address", True), ("caller", "address", True), ("assets", "uint256", False)],
    ),
    _event(
        "Deposit",
        [
            ("sender", "address", True),
            ("owner", "address", True),
            ("assets", "uint256", False),
            ("shares", "uint256", False),
        ],
    ),
    _event(
        "Withdraw",
        [
            ("sender", "address", True),
            ("receiver", "address", True),
            ("owner", "address", True),
            ("assets", "uint256", False),
            ("shares", "uint256", False),
        ],
    ),
    _event("KeyBound", [("holder", "address", True), ("quantity", "uint256", False)]),
    _event(
        "StockTokenPurchased",
        [
            ("purchaseId", "uint256", True),
            ("routeIndex", "uint256", True),
            ("token", "address", True),
            ("nativeSpent", "uint256", False),
            ("usdgSpent", "uint256", False),
            ("tokenReceived", "uint256", False),
        ],
    ),
]


def _event_topic(abi: dict[str, Any]) -> bytes:
    inputs = cast(list[dict[str, Any]], abi["inputs"])
    signature = f"{abi['name']}({','.join(str(item['type']) for item in inputs)})"
    return bytes(Web3.keccak(text=signature))


ERC20_METADATA_ABI = [
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
]


@dataclass(frozen=True)
class AgentMeta:
    agent_id: int
    name: str
    creator: str
    task_id: int
    vault: str
    key: str
    key_symbol: str
    asset_symbol: str
    asset_decimals: int


class ActivityService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.web3 = Web3(Web3.HTTPProvider(settings.rpc_url, request_kwargs={"timeout": 12}))
        self._event_by_topic = {_event_topic(abi): abi for abi in EVENT_ABIS}
        self._lock = Lock()
        self._cache_at = 0.0
        self._cache: list[dict[str, object]] = []
        self._last_success_at: float | None = None
        self._last_refresh_failed = False
        self._agents: list[AgentMeta] = []
        self._block_timestamps: dict[int, datetime] = {}
        self._token_symbols: dict[str, str] = {}

    @property
    def cache_status(self) -> str:
        if self._last_success_at is None:
            return "unavailable"
        if not self._last_refresh_failed:
            return "available"
        age = monotonic() - self._last_success_at
        return "cached" if age < max(1, self.settings.activity_stale_after_seconds) else "stale"

    @property
    def cache_is_stale(self) -> bool:
        return self.cache_status == "stale"

    def list_activity(self, limit: int = 40) -> list[dict[str, object]]:
        limit = max(1, min(limit, 200))
        with self._lock:
            if self._refresh_due():
                self._refresh_cache()
            return self._cache[:limit]

    def list_agent_activity(self, agent_id: int, limit: int = 100) -> list[dict[str, object]]:
        limit = max(1, min(limit, 200))
        with self._lock:
            if self._refresh_due():
                self._refresh_cache()
            return [row for row in self._cache if row.get("agent_id") == agent_id][:limit]

    def _refresh_due(self) -> bool:
        interval = (
            self.settings.activity_retry_interval_seconds
            if self._last_refresh_failed
            else self.settings.activity_refresh_interval_seconds
        )
        return monotonic() - self._cache_at > max(1, interval)

    def _refresh_cache(self) -> None:
        started = monotonic()
        last_error: Exception | None = None
        for attempt, delay in enumerate((0.0, 0.35, 1.0)):
            if delay:
                sleep(delay)
            try:
                rows = self._read_chain_activity()
            except Exception as error:
                last_error = error
                if attempt == 2 or not _retryable_rpc_error(error):
                    break
            else:
                self._cache = rows
                self._last_success_at = monotonic()
                self._last_refresh_failed = False
                self._cache_at = monotonic()
                logger.info(
                    "activity refresh completed rows=%s elapsed_seconds=%.2f",
                    len(rows),
                    monotonic() - started,
                )
                return

        self._last_refresh_failed = True
        self._cache_at = monotonic()
        status_code = _rpc_status_code(last_error)
        logger.warning(
            "activity refresh failed error_type=%s status_code=%s elapsed_seconds=%.2f cache_status=%s",
            type(last_error).__name__ if last_error else "unknown",
            status_code if status_code is not None else "unknown",
            monotonic() - started,
            self.cache_status,
        )
        if self._last_success_at is None and last_error is not None:
            raise last_error

    def _read_chain_activity(self) -> list[dict[str, object]]:
        if not self.settings.factory_address or not self.settings.key_marketplace_address:
            return []
        factory_address = Web3.to_checksum_address(self.settings.factory_address)
        factory = self.web3.eth.contract(address=factory_address, abi=FACTORY_ABI)
        agents = self._load_agents(factory)
        base_addresses = [factory_address, Web3.to_checksum_address(self.settings.key_marketplace_address)]
        if self.settings.policy_executor_address:
            base_addresses.append(Web3.to_checksum_address(self.settings.policy_executor_address))
        if self.settings.fee_rwa_reserve_address:
            base_addresses.append(Web3.to_checksum_address(self.settings.fee_rwa_reserve_address))
        logs = list(
            self.web3.eth.get_logs(
                {
                    "fromBlock": self.settings.deployment_block,
                    "toBlock": "latest",
                    "address": base_addresses,
                }
            )
        )
        tracked_addresses = [
            Web3.to_checksum_address(address) for agent in agents for address in (agent.vault, agent.key)
        ]
        if tracked_addresses:
            logs.extend(
                self.web3.eth.get_logs(
                    {
                        "fromBlock": self.settings.deployment_block,
                        "toBlock": "latest",
                        "address": tracked_addresses,
                    }
                )
            )
        by_vault = {agent.vault.lower(): agent for agent in agents}
        by_key = {agent.key.lower(): agent for agent in agents}
        listing_keys: dict[int, str] = {}
        offer_keys: dict[int, str] = {}
        decoded: list[dict[str, object]] = []
        for log in sorted(logs, key=lambda row: (int(row["blockNumber"]), int(row["logIndex"]))):
            if not log["topics"]:
                continue
            abi = self._event_by_topic.get(bytes(log["topics"][0]))
            if abi is None:
                continue
            event = get_event_data(self.web3.codec, abi, log)
            name = str(event["event"])
            args = dict(event["args"])
            if name == "ListingCreated":
                listing_keys[int(args["id"])] = str(args["key"]).lower()
            elif name == "OfferCreated":
                offer_keys[int(args["id"])] = str(args["key"]).lower()
            block_number = int(log["blockNumber"])
            timestamp = self._block_timestamps.get(block_number)
            if timestamp is None:
                timestamp = datetime.fromtimestamp(int(self.web3.eth.get_block(block_number)["timestamp"]), UTC)
                self._block_timestamps[block_number] = timestamp
            item = self._activity_item(
                name,
                args,
                str(log["address"]),
                by_vault,
                by_key,
                listing_keys,
                offer_keys,
            )
            if item is None:
                continue
            decoded.append(
                {
                    **item,
                    "id": f"{_hex_hash(log['transactionHash'])}-{int(log['logIndex'])}",
                    "tx_hash": _hex_hash(log["transactionHash"]),
                    "block_number": block_number,
                    "timestamp": timestamp,
                }
            )
        return list(reversed(decoded))

    def _load_agents(self, factory: Any) -> list[AgentMeta]:
        count = int(factory.functions.agentCount().call())
        if len(self._agents) > count:
            self._agents = []
        for agent_id in range(len(self._agents), count):
            record = factory.functions.getAgent(agent_id).call()
            vault = Web3.to_checksum_address(record[1])
            key = Web3.to_checksum_address(record[2])
            vault_contract = self.web3.eth.contract(
                address=vault,
                abi=[
                    {
                        "type": "function",
                        "name": "asset",
                        "stateMutability": "view",
                        "inputs": [],
                        "outputs": [{"type": "address"}],
                    }
                ],
            )
            asset = Web3.to_checksum_address(vault_contract.functions.asset().call())
            key_contract = self.web3.eth.contract(address=key, abi=ERC20_METADATA_ABI)
            asset_contract = self.web3.eth.contract(address=asset, abi=ERC20_METADATA_ABI)
            self._agents.append(
                AgentMeta(
                    agent_id=agent_id,
                    name=str(record[7]),
                    creator=Web3.to_checksum_address(record[0]),
                    task_id=int(record[4]),
                    vault=vault,
                    key=key,
                    key_symbol=str(key_contract.functions.symbol().call()),
                    asset_symbol=str(asset_contract.functions.symbol().call()),
                    asset_decimals=int(asset_contract.functions.decimals().call()),
                )
            )
        return list(self._agents)

    def _activity_item(
        self,
        event: str,
        args: dict[str, Any],
        address: str,
        by_vault: dict[str, AgentMeta],
        by_key: dict[str, AgentMeta],
        listing_keys: dict[int, str],
        offer_keys: dict[int, str],
    ) -> dict[str, object] | None:
        agent: AgentMeta | None = None
        actor: str
        quantity: str | None = None
        value: str | None = None
        value_symbol: str | None = None
        direction = "neutral"
        action: str
        if event == "AgentCreated":
            agent = by_vault.get(str(args["vault"]).lower())
            actor, action, direction = str(args["creator"]), "launched", "positive"
            value, value_symbol = _format_amount(int(args["baseFloorWei"]), 18), "ETH floor"
        elif event == "ListingCreated":
            agent = by_key.get(str(args["key"]).lower())
            actor, action, direction = str(args["seller"]), "listed", "neutral"
            quantity = str(args["quantity"])
            value = _format_amount(int(args["quantity"]) * int(args["unitPriceWei"]), 18)
            value_symbol = "ETH ask"
        elif event == "ListingFilled":
            agent = by_key.get(listing_keys.get(int(args["id"]), ""))
            actor, action, direction = str(args["buyer"]), "bought", "positive"
            quantity = str(args["quantity"])
            value, value_symbol = _format_amount(int(args["subtotalWei"]), 18), "ETH"
        elif event == "OfferCreated":
            agent = by_key.get(str(args["key"]).lower())
            actor, action, direction = str(args["buyer"]), "bid", "neutral"
            quantity = str(args["quantity"])
            value = _format_amount(int(args["quantity"]) * int(args["unitPriceWei"]), 18)
            value_symbol = "ETH"
        elif event == "OfferFilled":
            agent = by_key.get(offer_keys.get(int(args["id"]), ""))
            actor, action, direction = str(args["seller"]), "sold", "negative"
            quantity = str(args["quantity"])
            value, value_symbol = _format_amount(int(args["subtotalWei"]), 18), "ETH"
        elif event in {"Deposit", "Withdraw"}:
            agent = by_vault.get(address.lower())
            if agent is None:
                return None
            actor = str(args["owner"])
            action = "deposited" if event == "Deposit" else "withdrew"
            direction = "positive" if event == "Deposit" else "negative"
            value = _format_amount(int(args["assets"]), agent.asset_decimals)
            value_symbol = agent.asset_symbol
        elif event in {"AllocationExecuted", "RecallExecuted"}:
            agent = by_vault.get(str(args["vault"]).lower())
            if agent is None:
                return None
            actor = str(args["keeper"] if event == "AllocationExecuted" else args["caller"])
            if agent.task_id == 1:
                action = "opened range" if event == "AllocationExecuted" else "closed range"
            elif agent.task_id == 2:
                action = "staged" if event == "AllocationExecuted" else "released"
            else:
                action = "allocated" if event == "AllocationExecuted" else "recalled"
            direction = "positive" if event == "AllocationExecuted" else "negative"
            value = _format_amount(int(args["assets"]), agent.asset_decimals)
            value_symbol = agent.asset_symbol
        elif event == "KeyBound":
            agent = by_key.get(address.lower())
            if agent is None:
                return None
            actor, action, direction = str(args["holder"]), "bound", "positive"
            quantity = str(args["quantity"])
        elif event == "StockTokenPurchased":
            token = Web3.to_checksum_address(args["token"])
            symbol = self._token_symbols.get(token.lower())
            if symbol is None:
                token_contract = self.web3.eth.contract(address=token, abi=ERC20_METADATA_ABI)
                symbol = str(token_contract.functions.symbol().call())
                self._token_symbols[token.lower()] = symbol
            actor, action, direction = address, "reserve bought", "positive"
            value = _format_amount(int(args["tokenReceived"]), 18)
            value_symbol = symbol
        else:
            return None
        return {
            "action": action,
            "actor": Web3.to_checksum_address(actor),
            "creator": agent.creator if agent else None,
            "agent_id": agent.agent_id if agent else None,
            "agent_name": agent.name if agent else None,
            "key_symbol": agent.key_symbol if agent else None,
            "quantity": quantity,
            "value": value,
            "value_symbol": value_symbol,
            "direction": direction,
        }


def _format_amount(value: int, decimals: int) -> str:
    number = Decimal(value) / (Decimal(10) ** decimals)
    rendered = f"{number:.8f}".rstrip("0").rstrip(".")
    return rendered or "0"


def _hex_hash(value: Any) -> str:
    rendered = value.hex()
    return rendered if rendered.startswith("0x") else f"0x{rendered}"


def _rpc_status_code(error: Exception | None) -> int | None:
    response = getattr(error, "response", None)
    status_code = getattr(response, "status_code", None)
    return status_code if isinstance(status_code, int) else None


def _retryable_rpc_error(error: Exception) -> bool:
    status_code = _rpc_status_code(error)
    if status_code == 429 or (status_code is not None and status_code >= 500):
        return True
    error_name = type(error).__name__.lower()
    return "timeout" in error_name or "connection" in error_name
