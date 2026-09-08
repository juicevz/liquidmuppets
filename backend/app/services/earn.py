from __future__ import annotations

from threading import Lock
from time import monotonic
from typing import Any, cast

from web3 import Web3
from web3.types import FilterParams

from app.config import Settings

POSITION_PAGE_SIZE = 50
RECEIPT_LIMIT = 20
RECEIPT_BLOCK_WINDOW = 10_000
WEEK_LIMIT = 8
EPOCH_SECONDS = 7 * 24 * 60 * 60


def _view(name: str, inputs: list[str], outputs: list[str]) -> dict[str, Any]:
    return {
        "type": "function", "name": name, "stateMutability": "view",
        "inputs": [{"type": value} for value in inputs],
        "outputs": [{"type": value} for value in outputs],
    }


POSITION_COMPONENTS = [
    {"name": name, "type": kind}
    for name, kind in (
        ("account", "address"), ("key", "address"), ("units", "uint128"), ("rewardWeight", "uint128"),
        ("bondedAt", "uint40"), ("maturesAt", "uint40"), ("unlockAt", "uint40"),
        ("firstEligibleEpoch", "uint40"), ("lastEligibleEpochExclusive", "uint40"),
        ("multiplierBps", "uint16"), ("term", "uint8"), ("withdrawn", "bool"),
    )
]
BOND_EARN_ABI = [
    _view("EARN_ACCOUNTING_VERSION", [], ["uint256"]),
    _view("accountRewardsClaimed", ["address"], ["uint256"]),
    _view("accountRewardsReinvested", ["address"], ["uint256"]),
    _view("accountPositionAt", ["address", "uint256"], ["uint256"]),
    _view("pendingPositionRewards", ["uint256"], ["uint256", "uint256"]),
    _view("UNIT_SIZE", [], ["uint256"]),
    {
        "type": "function", "name": "getPosition", "stateMutability": "view",
        "inputs": [{"type": "uint256"}],
        "outputs": [{"type": "tuple", "components": POSITION_COMPONENTS}],
    },
]
WEEK_COMPONENTS = [
    {"name": name, "type": "uint256"}
    for name in (
        "revenue", "volume", "ponsRevenue", "legacyMarketplaceRevenue", "bondRewards",
        "bondRewardsDelivered", "unallocatedBondRewards", "buyback", "stockReserve", "operations",
        "eligibleWeight",
    )
] + [{"name": "finalizedAt", "type": "uint40"}]
ROUTER_EARN_ABI = [
    _view("REVENUE_EPOCH_VERSION", [], ["uint256"]),
    _view("ROUTE_INTERVAL", [], ["uint256"]),
    _view("globalRevenueEpochCount", [], ["uint256"]),
    _view("globalRevenueEpochAt", ["uint256"], ["uint40"]),
    _view("keyRevenueEpochCount", ["address"], ["uint256"]),
    _view("keyRevenueEpochAt", ["address", "uint256"], ["uint40"]),
    *[
        {
            "type": "function", "name": name, "stateMutability": "view",
            "inputs": [{"type": kind} for kind in inputs],
            "outputs": [{"type": "tuple", "components": WEEK_COMPONENTS}],
        }
        for name, inputs in (
            ("globalRevenueEpoch", ["uint40"]), ("keyRevenueEpoch", ["address", "uint40"]),
        )
    ],
]
CLAIM_TOPIC = Web3.to_hex(Web3.keccak(text="PositionRewardsClaimed(uint256,address,address,uint256,uint256)"))
REINVEST_TOPIC = Web3.to_hex(Web3.keccak(
    text="PositionRewardsReinvested(uint256,uint256,address,uint256,uint256,uint256,uint256,uint256)"
))


class EarnService:
    """Bounded, cached wallet and receipt-week views. No signing or inferred historical returns."""

    def __init__(self, settings: Settings, web3: Web3):
        self.settings = settings
        self.web3 = web3
        self._cache: dict[str, tuple[float, dict[str, object]]] = {}
        self._lock = Lock()

    def _cached(self, key: str) -> dict[str, object] | None:
        with self._lock:
            entry = self._cache.get(key)
            return entry[1] if entry and entry[0] > monotonic() else None

    def _save(self, key: str, state: dict[str, object]) -> dict[str, object]:
        with self._lock:
            now = monotonic()
            self._cache = {key: item for key, item in self._cache.items() if item[0] > now}
            if len(self._cache) >= 128:
                self._cache.pop(next(iter(self._cache)))
            self._cache[key] = (now + 15, state)
        return state

    def _batch(self, functions: list[Any], block: int) -> list[Any]:
        rows: list[Any] = []
        for start in range(0, len(functions), 10):
            with self.web3.batch_requests() as batch:
                for function in functions[start:start + 10]:
                    batch.add(function.call(block_identifier=block))
                rows.extend(cast(list[Any], batch.execute()))
        if len(rows) != len(functions):
            raise ValueError("incomplete Earn read batch")
        return rows

    def read_wallet(self, account: str, wallet: dict[str, object], cursor: int = 0) -> dict[str, object]:
        if not wallet.get("available"):
            pending = not Web3.is_address(self.settings.agent_bond_address)
            return self._empty_wallet(
                "activation_pending" if pending else "unavailable",
                "Agent Bonds are awaiting activation." if pending else "Wallet rewards could not be read from chain.",
                cursor,
            )
        cache_key = f"wallet:{account.lower()}:{cursor}"
        if cached := self._cached(cache_key):
            return cached
        state = self._empty_wallet("available", "Read from the Agent Bond contract. Amounts are not forecasts.", cursor)
        try:
            block = int(cast(int, wallet["block_number"]))
            count = int(str(wallet["position_count"]))
            address = Web3.to_checksum_address(self.settings.agent_bond_address)
            holder = Web3.to_checksum_address(account)
            bond = self.web3.eth.contract(address=address, abi=BOND_EARN_ABI)
            state.update({
                "staked_muppets_raw": wallet["bonded_muppets_raw"],
                "claimable_weth_raw": wallet["pending_weth_raw"],
                "positions_total": str(count),
                "block_number": block,
            })
            try:
                version = bond.functions.EARN_ACCOUNTING_VERSION().call(block_identifier=block)
                if int(version) == 1:
                    claimed, reinvested = self._batch([
                        bond.functions.accountRewardsClaimed(holder), bond.functions.accountRewardsReinvested(holder),
                    ], block)
                    if int(claimed) < int(reinvested):
                        raise ValueError("inconsistent lifetime rewards")
                    state.update({
                        "claimed_weth_raw": str(int(claimed)),
                        "reinvested_weth_raw": str(int(reinvested)),
                        "received_weth_raw": str(int(claimed) - int(reinvested)),
                        "accounting_status": "contract_totals",
                    })
            except Exception:
                # A legacy counter or temporary read failure must never become a made-up zero.
                pass
            try:
                end = min(count, cursor + POSITION_PAGE_SIZE)
                indices = list(range(count - 1 - cursor, count - 1 - end, -1)) if cursor < count else []
                ids = self._batch([bond.functions.accountPositionAt(holder, index) for index in indices], block)
                details = self._batch([bond.functions.getPosition(int(position_id)) for position_id in ids], block)
                rewards = self._batch([
                    bond.functions.pendingPositionRewards(int(position_id)) for position_id in ids
                ], block)
                unit = int(bond.functions.UNIT_SIZE().call(block_identifier=block))
                positions: list[dict[str, object]] = []
                for position_id, position, pending in zip(ids, details, rewards, strict=True):
                    if str(position[0]).lower() != holder.lower() or int(position[10]) not in (0, 1, 2):
                        raise ValueError("position does not match holder")
                    positions.append({
                        "id": str(int(position_id)), "key": Web3.to_checksum_address(position[1]),
                        "units": str(int(position[2])), "muppets_raw": str(unit * int(position[2])),
                        "bonded_at": int(position[4]), "matures_at": int(position[5]), "unlock_at": int(position[6]),
                        "eligible_from": int(position[7]) * EPOCH_SECONDS,
                        "eligible_until": int(position[8]) * EPOCH_SECONDS,
                        "term_days": (30, 90, 180)[int(position[10])], "withdrawn": bool(position[11]),
                        "claimable_global_weth_raw": str(int(pending[0])),
                        "claimable_key_weth_raw": str(int(pending[1])),
                    })
                state.update({
                    "positions": positions, "positions_status": "available",
                    "next_position_cursor": end if end < count else None,
                    "positions_truncated": count > len(positions),
                })
            except Exception:
                state["positions_status"] = "unavailable"
            state.update(self._read_receipts(holder, address, block))
        except Exception:
            return self._empty_wallet("unavailable", "Wallet rewards could not be read from chain.", cursor)
        return self._save(cache_key, state)

    @staticmethod
    def _empty_wallet(status: str, reason: str, cursor: int) -> dict[str, object]:
        return {
            "status": status, "reason": reason,
            "staked_muppets_raw": None, "claimable_weth_raw": None,
            "claimed_weth_raw": None, "reinvested_weth_raw": None, "received_weth_raw": None,
            "accounting_status": "unavailable", "positions": [],
            "positions_status": "activation_pending" if status == "activation_pending" else "unavailable",
            "positions_total": None, "position_cursor": cursor, "next_position_cursor": None,
            "positions_truncated": False, "receipts": [],
            "receipt_status": "activation_pending" if status == "activation_pending" else "unavailable",
            "receipt_range": None, "receipts_truncated": False, "block_number": None,
        }

    def read_weeks(self, key: str | None = None) -> dict[str, object]:
        cache_key = f"weeks:{key.lower() if key else 'global'}"
        if cached := self._cached(cache_key):
            return cached
        address = self.settings.revenue_router_address
        result: dict[str, object] = {
            "status": "activation_pending", "reason": "Receipt-week accounting begins at router deployment.",
            "accounting": "router_receipt_week", "epoch_seconds": EPOCH_SECONDS,
            "block_number": None, "rows": [], "has_more": False, "total_weeks": None,
            "contract_url": f"{self.settings.explorer_url}/address/{address}" if Web3.is_address(address) else None,
        }
        if not Web3.is_address(address):
            return result
        try:
            block = self.web3.eth.block_number
            address = Web3.to_checksum_address(address)
            if not self.web3.eth.get_code(address, block_identifier=block):
                return result
            router = self.web3.eth.contract(address=address, abi=ROUTER_EARN_ABI)
            try:
                version = router.functions.REVENUE_EPOCH_VERSION().call(block_identifier=block)
            except Exception:
                result.update({"status": "unavailable", "reason": "Receipt-week support could not be verified."})
                return result
            if int(version) != 1:
                result.update({"status": "legacy", "reason": "This router does not expose receipt-week accounting."})
                return result
            interval = int(router.functions.ROUTE_INTERVAL().call(block_identifier=block))
            if interval != EPOCH_SECONDS:
                raise ValueError("unexpected revenue epoch duration")
            holder = Web3.to_checksum_address(key) if key else None
            count = int((router.functions.keyRevenueEpochCount(holder) if holder
                         else router.functions.globalRevenueEpochCount()).call(block_identifier=block))
            indices = range(count - 1, max(-1, count - WEEK_LIMIT - 1), -1)
            epochs = self._batch([
                router.functions.keyRevenueEpochAt(holder, index) if holder
                else router.functions.globalRevenueEpochAt(index) for index in indices
            ], block)
            values = self._batch([
                router.functions.keyRevenueEpoch(holder, int(epoch)) if holder
                else router.functions.globalRevenueEpoch(int(epoch)) for epoch in epochs
            ], block)
            rows: list[dict[str, object]] = []
            for epoch, value in zip(epochs, values, strict=True):
                rows.append({
                    "epoch": int(epoch), "starts_at": int(epoch) * interval, "ends_at": (int(epoch) + 1) * interval,
                    "received_wei": str(int(value[0])), "key_volume_wei": str(int(value[1])),
                    "pons_wei": str(int(value[2])), "legacy_key_fees_wei": str(int(value[3])),
                    "bond_rewards_wei": str(int(value[4])), "bond_rewards_delivered_wei": str(int(value[5])),
                    "unallocated_bond_rewards_wei": str(int(value[6])), "buyback_wei": str(int(value[7])),
                    "stock_reserve_wei": str(int(value[8])), "operations_wei": str(int(value[9])),
                    "eligible_weight": str(int(value[10])), "finalized_at": int(value[11]) or None,
                    "source": "exact_key" if holder else "global", "source_key": holder,
                })
            result.update({
                "status": "available", "reason": (
                    "Weeks record when the router received fees, not when an earlier Pons trade happened. "
                    "Unallocated rewards stay assigned to their original week."
                ), "rows": rows, "block_number": block, "total_weeks": str(count), "has_more": count > WEEK_LIMIT,
            })
        except Exception:
            result.update({"status": "unavailable", "reason": "Receipt-week amounts could not be read from chain."})
        return self._save(cache_key, result)

    def _read_receipts(self, account: str, bond: str, block: int) -> dict[str, object]:
        result: dict[str, object] = {
            "receipts": [], "receipt_status": "unavailable", "receipt_range": None, "receipts_truncated": False,
        }
        deployment = self.settings.revenue_deployment_block
        if deployment <= 0:
            result["receipt_status"] = "activation_pending"
            return result
        end = block - 2
        if end < deployment:
            result["receipt_status"] = "available"
            return result
        start = max(deployment, end - RECEIPT_BLOCK_WINDOW + 1)
        account_topic = "0x" + account[2:].lower().rjust(64, "0")
        try:
            logs: list[Any] = []
            for topics in ([CLAIM_TOPIC, None, account_topic], [REINVEST_TOPIC, None, None, account_topic]):
                logs.extend(self.web3.eth.get_logs(cast(FilterParams, {
                    "address": bond, "fromBlock": start, "toBlock": end, "topics": topics,
                })))
            rows = decode_wallet_receipts(logs, account, bond, self.settings.explorer_url)
            recent = rows[:RECEIPT_LIMIT]
            timestamps: dict[int, int] = {}
            for row in recent:
                number = int(cast(int, row["block_number"]))
                if number not in timestamps:
                    timestamps[number] = int(self.web3.eth.get_block(number)["timestamp"])
                row["timestamp"] = timestamps[number]
            result.update({
                "receipts": recent, "receipt_status": "available", "receipts_truncated": len(rows) > RECEIPT_LIMIT,
                "receipt_range": {
                    "from_block": start, "to_block": end, "complete_from_deployment": start == deployment,
                },
            })
        except Exception:
            pass
        return result


def decode_wallet_receipts(logs: list[Any], account: str, bond: str, explorer: str) -> list[dict[str, object]]:
    """Pair reinvestment with its own preceding claim; gross claims are not all cash received."""
    rows: list[dict[str, object]] = []
    claims: dict[tuple[str, str], list[dict[str, object]]] = {}
    seen: set[tuple[str, int]] = set()
    for log in sorted(logs, key=lambda entry: (int(entry["blockNumber"]), int(entry["logIndex"]))):
        if log.get("removed") or str(log["address"]).lower() != bond.lower():
            continue
        topics = [Web3.to_hex(topic).lower() for topic in log["topics"]]
        if len(topics) != 4 or topics[0] not in (CLAIM_TOPIC.lower(), REINVEST_TOPIC.lower()):
            continue
        owner_topic = topics[2] if topics[0] == CLAIM_TOPIC.lower() else topics[3]
        if owner_topic[-40:] != account[2:].lower():
            continue
        tx_hash = Web3.to_hex(log["transactionHash"])
        log_index = int(log["logIndex"])
        if (tx_hash, log_index) in seen:
            continue
        seen.add((tx_hash, log_index))
        data = bytes(log["data"])
        expected_words = 2 if topics[0] == CLAIM_TOPIC.lower() else 5
        if len(data) != expected_words * 32:
            raise ValueError("invalid reward receipt payload")
        values = [int.from_bytes(data[index:index + 32]) for index in range(0, len(data), 32)]
        position_id = str(int(topics[1], 16))
        group = (tx_hash, position_id)
        if topics[0] == CLAIM_TOPIC.lower():
            total = values[0] + values[1]
            row: dict[str, object] = {
                "kind": "claimed", "position_id": position_id,
                "key": Web3.to_checksum_address("0x" + topics[3][-40:]),
                "global_weth_raw": str(values[0]), "key_weth_raw": str(values[1]),
                "claimed_weth_raw": str(total), "reinvested_weth_raw": "0", "received_weth_raw": str(total),
                "muppets_bought_raw": None, "new_position_id": None,
                "tx_hash": tx_hash, "log_index": log_index, "block_number": int(log["blockNumber"]),
                "timestamp": 0, "url": f"{explorer}/tx/{tx_hash}",
            }
            claims.setdefault(group, []).append(row)
            rows.append(row)
        else:
            candidates = claims.get(group, [])
            if not candidates:
                raise ValueError("reinvestment receipt is missing its claim")
            row = candidates.pop()
            spent, bought, _bonded, returned, _muppets_returned = values
            if int(str(row["claimed_weth_raw"])) != spent + returned:
                raise ValueError("reinvestment does not reconcile with claimed rewards")
            row.update({
                "kind": "reinvested", "reinvested_weth_raw": str(spent), "received_weth_raw": str(returned),
                "muppets_bought_raw": str(bought), "new_position_id": str(int(topics[2], 16)),
                "log_index": log_index,
            })
    return sorted(
        rows, key=lambda row: (int(cast(int, row["block_number"])), int(cast(int, row["log_index"]))), reverse=True,
    )
