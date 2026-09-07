from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from web3 import Web3

from app.config import Settings
from app.database import Database
from app.services.activity import ActivityService
from app.services.proofs import keeper_hold_proof_id, proof_id_for_chain_event, public_proof_url
from app.services.token_gate import TokenGateService

_KEY_ACTIONS = {"listed", "bought", "bid", "sold", "bound"}
_RANGE_ACTIONS = {"opened range", "closed range", "recentered range"}


class PublicDataService:
    """Build public creator and protocol records from persisted and decoded evidence."""

    def __init__(
        self,
        settings: Settings,
        database: Database,
        activity: ActivityService,
        token_gate: TokenGateService,
    ) -> None:
        self.settings = settings
        self.database = database
        self.activity = activity
        self.token_gate = token_gate

    def get_creator_profile(self, wallet: str) -> dict[str, object]:
        checksum_wallet = Web3.to_checksum_address(wallet)
        normalized = checksum_wallet.lower()
        summaries = [
            self._with_summary_defaults(summary)
            for summary in self.database.list_marketplace_performance()
            if _summary_creator(summary) == normalized
        ]
        summaries.sort(key=lambda row: _agent_id(row))

        activity_status = "available"
        receipt_hashes: dict[int, set[str]] = defaultdict(set)
        try:
            activity_rows = self.activity.list_activity(200)
            activity_status = _activity_cache_status(self.activity)
        except Exception:
            activity_status = "unavailable"
            activity_rows = []
        for row in activity_rows:
            if str(row.get("creator") or "").lower() != normalized:
                continue
            agent_id = row.get("agent_id")
            tx_hash = row.get("tx_hash")
            if isinstance(agent_id, int) and isinstance(tx_hash, str) and tx_hash:
                receipt_hashes[agent_id].add(tx_hash.lower())

        agent_records: list[dict[str, Any]] = []
        for summary in summaries:
            agent_id = _agent_id(summary)
            agent_records.append({**summary, "receipt_count": len(receipt_hashes[agent_id])})

        asset_totals: dict[tuple[str, str, int], dict[str, object]] = {}
        for summary in summaries:
            asset = _mapping(summary.get("asset"))
            current = _mapping(summary.get("current"))
            address = str(asset.get("address") or "")
            symbol = str(asset.get("symbol") or "unknown")
            decimals = _safe_int(asset.get("decimals"))
            key = (address.lower(), symbol, decimals)
            total = asset_totals.setdefault(
                key,
                {
                    "address": address,
                    "symbol": symbol,
                    "decimals": decimals,
                    "agent_count": 0,
                    "total_assets_raw": "0",
                    "deployed_assets_raw": "0",
                    "idle_assets_raw": "0",
                },
            )
            total["agent_count"] = _safe_int(total["agent_count"]) + 1
            for field in ("total_assets_raw", "deployed_assets_raw", "idle_assets_raw"):
                total[field] = str(_safe_int(total[field]) + _safe_int(current.get(field)))

        profile = self.database.get_wallet_profile(checksum_wallet)
        tracking_values = [str(row.get("tracking_started_at")) for row in summaries if row.get("tracking_started_at")]
        captured_values = [str(row.get("captured_at")) for row in summaries if row.get("captured_at")]
        creator_capacity = self.token_gate.check(checksum_wallet)
        featured_count = creator_capacity.get("featuredSlots")
        featured_limit = featured_count if isinstance(featured_count, int) else 0
        featured_agent_ids = [
            _agent_id(row)
            for row in sorted(agent_records, key=_agent_id, reverse=True)[:featured_limit]
        ]
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "explorer_url": self.settings.explorer_url,
            "wallet": checksum_wallet,
            "handle": str(profile["handle"]) if profile else None,
            "profile_claimed_at": str(profile["created_at"]) if profile else None,
            "tracking_started_at": min(tracking_values) if tracking_values else None,
            "captured_at": max(captured_values) if captured_values else None,
            "activity_status": activity_status,
            "receipt_count": (
                sum(len(hashes) for hashes in receipt_hashes.values())
                if activity_status != "unavailable"
                else None
            ),
            "creator_capacity": creator_capacity,
            "featured_agent_ids": featured_agent_ids,
            "asset_totals": sorted(asset_totals.values(), key=lambda row: (str(row["symbol"]), str(row["address"]))),
            "agents": agent_records,
        }

    def get_pulse(
        self,
        *,
        limit: int = 100,
        category: str | None = None,
        creator: str | None = None,
        agent_id: int | None = None,
    ) -> dict[str, object]:
        limit = max(1, min(limit, 200))
        normalized_creator = creator.lower() if creator else None
        summaries = [self._with_summary_defaults(row) for row in self.database.list_marketplace_performance()]
        by_agent = {_agent_id(row): row for row in summaries}
        by_vault = {
            str(_mapping(row.get("agent")).get("vault") or "").lower(): row
            for row in summaries
            if _mapping(row.get("agent")).get("vault")
        }
        keeper_rows = self.database.list_keeper_runs(200)
        keeper_by_tx = {
            str(row["tx_hash"]).lower(): row
            for row in keeper_rows
            if isinstance(row.get("tx_hash"), str) and row.get("tx_hash")
        }
        first_deposit_ids = self.database.first_activity_event_ids("deposited")

        chain_status = "available"
        try:
            chain_rows = self.activity.list_activity(200)
            chain_status = _activity_cache_status(self.activity)
        except Exception:
            chain_status = "unavailable"
            chain_rows = []

        items: list[dict[str, Any]] = []
        seen_keeper_transactions: set[str] = set()
        latest_chain_record_at: str | None = None
        for row in chain_rows:
            tx_hash = str(row.get("tx_hash") or "")
            keeper = keeper_by_tx.get(tx_hash.lower()) if tx_hash else None
            if keeper is not None:
                seen_keeper_transactions.add(tx_hash.lower())
            record_category = _category_for_action(str(row.get("action") or ""))
            facets = [record_category]
            if keeper is not None and "keeper" not in facets:
                facets.append("keeper")
            item = {
                "id": f"chain:{row['id']}",
                "source": "chain",
                "category": record_category,
                "facets": facets,
                "timestamp": row["timestamp"],
                "action": row["action"],
                "actor": row.get("actor"),
                "creator": row.get("creator"),
                "agent_id": row.get("agent_id"),
                "agent_name": row.get("agent_name"),
                "key_symbol": row.get("key_symbol"),
                "quantity": row.get("quantity"),
                "value": row.get("value"),
                "value_symbol": row.get("value_symbol"),
                "direction": row.get("direction", "neutral"),
                "reason": keeper.get("reason") if keeper else None,
                "status": keeper.get("status") if keeper else "confirmed",
                "tx_hash": tx_hash or None,
                "block_number": row.get("block_number"),
            }
            if item["creator"] is None and isinstance(item["agent_id"], int):
                item["creator"] = _summary_creator_address(by_agent.get(int(item["agent_id"])))
            proof_id = proof_id_for_chain_event(
                row,
                first_deposit_ids=first_deposit_ids,
                keeper_run=keeper,
            )
            item["proof_id"] = proof_id
            item["proof_url"] = public_proof_url(self.settings, proof_id) if proof_id else None
            items.append(item)
            timestamp = str(row.get("timestamp") or "")
            if timestamp and (latest_chain_record_at is None or timestamp > latest_chain_record_at):
                latest_chain_record_at = timestamp

        for row in keeper_rows:
            tx_hash = str(row.get("tx_hash") or "")
            if tx_hash and tx_hash.lower() in seen_keeper_transactions:
                continue
            summary = by_vault.get(str(row.get("vault") or "").lower())
            task_id = _safe_int(row.get("task_id"))
            action = str(row.get("action") or "hold")
            supporting_category = "reserve" if task_id == 3 else "range" if task_id == 1 else "vault"
            facets = ["keeper", supporting_category]
            asset = _mapping(summary.get("asset")) if summary else {}
            decimals = 18 if task_id == 3 else _safe_int(asset.get("decimals"))
            value_symbol = "ETH" if task_id == 3 else str(asset.get("symbol") or "assets")
            agent = _mapping(summary.get("agent")) if summary else {}
            proof_id = None
            reserve_subject = (
                task_id == 3
                and str(row.get("vault") or "").lower() == self.settings.fee_rwa_reserve_address.lower()
            )
            if action == "hold" and (summary is not None or reserve_subject):
                proof_id = keeper_hold_proof_id(
                    row.get("created_at"),
                    agent.get("id") if isinstance(agent.get("id"), int) else None,
                    reserve=reserve_subject,
                )
            elif task_id not in {1, 3}:
                proof_id = f"keeper-action-{_safe_int(row.get('id'))}"
            items.append(
                {
                    "id": f"keeper:{row['id']}",
                    "source": "keeper",
                    "category": "keeper",
                    "facets": facets,
                    "timestamp": row["created_at"],
                    "action": _keeper_action_label(action, task_id),
                    "actor": self.settings.keeper_expected_address or None,
                    "creator": agent.get("creator"),
                    "agent_id": agent.get("id"),
                    "agent_name": agent.get("name"),
                    "key_symbol": None,
                    "quantity": None,
                    "value": None if action == "hold" else _format_amount(_safe_int(row.get("amount")), decimals),
                    "value_symbol": None if action == "hold" else value_symbol,
                    "direction": "neutral" if action == "hold" else "positive",
                    "reason": row.get("reason"),
                    "status": row.get("status"),
                    "tx_hash": tx_hash or None,
                    "block_number": None,
                    "proof_id": proof_id,
                    "proof_url": public_proof_url(self.settings, proof_id) if proof_id else None,
                }
            )

        filtered = [
            item
            for item in items
            if (category is None or category in item["facets"])
            and (normalized_creator is None or str(item.get("creator") or "").lower() == normalized_creator)
            and (agent_id is None or item.get("agent_id") == agent_id)
        ]
        filtered.sort(key=lambda row: _timestamp_key(row.get("timestamp")), reverse=True)
        filtered = filtered[:limit]

        wallets = [
            str(value)
            for item in filtered
            for value in (item.get("actor"), item.get("creator"))
            if isinstance(value, str) and value
        ]
        handles = self.database.get_wallet_profiles(wallets)
        for item in filtered:
            actor = str(item.get("actor") or "").lower()
            item["actor_handle"] = handles.get(actor)
            item_creator = str(item.get("creator") or "").lower()
            item["creator_handle"] = handles.get(item_creator)

        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "explorer_url": self.settings.explorer_url,
            "latest_chain_record_at": latest_chain_record_at,
            "limit": limit,
            "source_status": {"chain": chain_status, "keeper": "available"},
            "items": filtered,
        }

    @staticmethod
    def _with_summary_defaults(summary: dict[str, object]) -> dict[str, Any]:
        record: dict[str, Any] = dict(summary)
        record.setdefault("checkpoint_count", 0)
        record.setdefault(
            "key_market",
            {
                "status": "unavailable",
                "detail": "Agent Key market record is not available yet.",
                "symbol": None,
                "supply_raw": None,
                "total_bound_raw": None,
                "listed_raw": None,
                "floor_wei": None,
                "top_bid_wei": None,
                "fee_bps": None,
            },
        )
        return record


def _mapping(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _summary_creator(summary: dict[str, object]) -> str:
    return _summary_creator_address(summary).lower()


def _summary_creator_address(summary: dict[str, object] | None) -> str:
    if summary is None:
        return ""
    return str(_mapping(summary.get("agent")).get("creator") or "")


def _agent_id(summary: dict[str, object]) -> int:
    return _safe_int(_mapping(summary.get("agent")).get("id"))


def _safe_int(value: object) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return 0


def _format_amount(value: int, decimals: int) -> str:
    number = Decimal(value) / (Decimal(10) ** max(0, decimals))
    rendered = f"{number:.8f}".rstrip("0").rstrip(".")
    return rendered or "0"


def _timestamp_key(value: object) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)


def _activity_cache_status(activity: ActivityService) -> str:
    status = getattr(activity, "cache_status", "available")
    return status if isinstance(status, str) and status in {"available", "cached", "stale"} else "available"


def _category_for_action(action: str) -> str:
    if action == "launched":
        return "muppet"
    if action in _KEY_ACTIONS:
        return "keys"
    if action in _RANGE_ACTIONS:
        return "range"
    if action == "reserve bought":
        return "reserve"
    return "vault"


def _keeper_action_label(action: str, task_id: int) -> str:
    if action == "hold":
        return "keeper held"
    if task_id == 3:
        return "reserve keeper purchased"
    if task_id == 1:
        return "keeper changed range"
    if action == "recall":
        return "keeper recalled"
    return "keeper allocated"
