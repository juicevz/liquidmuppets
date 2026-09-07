from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from threading import Lock
from time import monotonic
from typing import Any

from app.config import Settings
from app.database import Database, ProofCardRecord
from app.schemas import ProofCard, ProofKind
from app.services.activity import ActivityService
from app.services.chain import ChainService
from app.services.performance import flow_adjusted_change

logger = logging.getLogger(__name__)

PROOF_BOUNDARY = (
    "Recorded evidence only. No projected or annualized APY. "
    "Market health is labeled with its own observation time."
)
PROOF_ID_PATTERN = re.compile(r"^[a-z0-9-]{8,150}$")
RANGE_ACTIONS = {"opened range", "closed range"}
KEY_FILL_ACTIONS = {"bought", "sold"}
CATEGORY_LABELS: dict[ProofKind, str] = {
    "muppet_launch": "Muppet launch",
    "first_deposit": "first vault deposit",
    "keeper_action": "keeper action",
    "keeper_daily_summary": "daily keeper summary",
    "range_change": "range change",
    "nav_milestone": "tracked NAV milestone",
    "agent_key_fill": "Agent Key fill",
    "reserve_purchase": "Stock Token receipt",
}


def public_proof_url(settings: Settings, proof_id: str) -> str:
    return f"{settings.public_base_url}/proof/{proof_id}"


def proof_id_for_chain_event(
    row: dict[str, object],
    *,
    first_deposit_ids: set[str],
    keeper_run: dict[str, object] | None = None,
) -> str | None:
    event_id = str(row.get("id") or "").lower()
    tx_hash = str(row.get("tx_hash") or "").lower().removeprefix("0x")
    action = str(row.get("action") or "")
    if action == "launched" and event_id:
        return f"muppet-launch-{_slug_event_id(event_id)}"
    if action == "deposited" and event_id in first_deposit_ids:
        return f"first-deposit-{_slug_event_id(event_id)}"
    if action in RANGE_ACTIONS and tx_hash:
        return f"range-change-{tx_hash}"
    if action in KEY_FILL_ACTIONS and event_id:
        return f"agent-key-fill-{_slug_event_id(event_id)}"
    if action == "reserve bought" and event_id:
        return f"reserve-purchase-{_slug_event_id(event_id)}"
    if keeper_run is not None and int(str(keeper_run.get("task_id") or 0)) not in {1, 3}:
        return f"keeper-action-{int(str(keeper_run['id']))}"
    return None


def keeper_hold_proof_id(timestamp: object, agent_id: int | None, *, reserve: bool = False) -> str:
    day = _parse_datetime(timestamp).strftime("%Y%m%d")
    subject = "reserve" if reserve else f"m{agent_id}" if agent_id is not None else "network"
    return f"keeper-holds-{day}-{subject}"


class ProofService:
    """Materialize durable, shareable cards from persisted protocol evidence."""

    def __init__(
        self,
        settings: Settings,
        database: Database,
        activity: ActivityService,
        chain: ChainService,
    ) -> None:
        self.settings = settings
        self.database = database
        self.activity = activity
        self.chain = chain
        self._lock = Lock()
        self._last_refresh_at = 0.0

    def refresh(self, *, force: bool = False) -> None:
        with self._lock:
            if not force and monotonic() - self._last_refresh_at < 15:
                return
            try:
                self.activity.list_activity(200)
            except Exception as error:
                logger.info("proof refresh is using persisted chain evidence: %s", type(error).__name__)

            summaries = self.database.list_marketplace_performance()
            by_agent = {_agent_id(summary): summary for summary in summaries}
            by_vault = {
                str(_mapping(summary.get("agent")).get("vault") or "").lower(): summary
                for summary in summaries
            }
            keeper_rows = self.database.list_all_keeper_runs()
            keeper_by_tx = {
                str(row["tx_hash"]).lower(): row
                for row in keeper_rows
                if isinstance(row.get("tx_hash"), str) and row.get("tx_hash")
            }
            first_deposit_ids = self.database.first_activity_event_ids("deposited")
            activity_rows = self.database.list_proof_activity_events()
            range_groups: dict[str, list[dict[str, object]]] = defaultdict(list)

            reserve_state, reserve_observed_at = self._reserve_state()
            for row in activity_rows:
                action = str(row.get("action") or "")
                tx_hash = str(row.get("tx_hash") or "").lower()
                if action in RANGE_ACTIONS and tx_hash:
                    range_groups[tx_hash].append(row)
                    continue
                card = self._activity_card(
                    row,
                    by_agent=by_agent,
                    first_deposit_ids=first_deposit_ids,
                    reserve_state=reserve_state,
                    reserve_observed_at=reserve_observed_at,
                )
                if card is not None:
                    self._store(card)

            for tx_hash, rows in range_groups.items():
                card = self._range_card(rows, by_agent, keeper_by_tx.get(tx_hash))
                if card is not None:
                    self._store(card)

            hold_groups: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
            reserve_address = self.settings.fee_rwa_reserve_address.lower()
            for row in keeper_rows:
                vault = str(row.get("vault") or "").lower()
                performance = by_vault.get(vault)
                action = str(row.get("action") or "")
                if action == "hold":
                    day = _parse_datetime(row.get("created_at")).strftime("%Y%m%d")
                    hold_groups[(day, vault)].append(row)
                    continue
                task_id = _safe_int(row.get("task_id"))
                if task_id in {1, 3}:
                    continue
                card = self._keeper_action_card(row, performance)
                if card is not None:
                    self._store(card)

            for (_, vault), rows in hold_groups.items():
                card = self._keeper_hold_card(
                    rows,
                    by_vault.get(vault),
                    reserve=vault == reserve_address and bool(reserve_address),
                    reserve_state=reserve_state,
                    reserve_observed_at=reserve_observed_at,
                )
                if card is not None:
                    self._store(card, replace=True)

            for agent_id, performance in by_agent.items():
                for card in self._nav_milestone_cards(agent_id, performance):
                    self._store(card)
            self._last_refresh_at = monotonic()

    def list_proofs(
        self,
        *,
        limit: int = 50,
        kind: ProofKind | None = None,
        creator: str | None = None,
        agent_id: int | None = None,
    ) -> list[dict[str, object]]:
        self.refresh()
        return self.database.list_proof_cards(
            limit,
            kind=kind,
            creator=creator,
            agent_id=agent_id,
        )

    def get_proof(self, proof_id: str) -> dict[str, object] | None:
        normalized = proof_id.lower()
        if not PROOF_ID_PATTERN.fullmatch(normalized):
            return None
        card = self.database.get_proof_card(normalized)
        if card is not None:
            return card
        self.refresh(force=True)
        return self.database.get_proof_card(normalized)

    def _activity_card(
        self,
        row: dict[str, object],
        *,
        by_agent: dict[int, dict[str, object]],
        first_deposit_ids: set[str],
        reserve_state: dict[str, object] | None,
        reserve_observed_at: str | None,
    ) -> dict[str, object] | None:
        action = str(row.get("action") or "")
        event_id = str(row.get("id") or "").lower()
        agent_id = row.get("agent_id")
        performance = by_agent.get(agent_id) if isinstance(agent_id, int) else None
        proof_id = proof_id_for_chain_event(row, first_deposit_ids=first_deposit_ids)
        if proof_id is None:
            return None
        if action == "reserve bought":
            return self._reserve_purchase_card(row, proof_id, reserve_state, reserve_observed_at)
        if performance is None:
            return None

        context = _performance_context(performance)
        name = str(context["subject"]["name"])
        value = _value_label(row)
        if action == "launched":
            kind: ProofKind = "muppet_launch"
            title = f"{name} launched"
            description = (
                f"Muppet #{context['subject']['agent_id']} entered the public record with its fixed task and vault."
            )
            facts = [
                {"label": "Muppet", "value": f"#{context['subject']['agent_id']}"},
                {"label": "task", "value": str(_mapping(performance.get("agent")).get("task_label") or "recorded")},
                {"label": "asset", "value": str(context["asset"]["symbol"])},
            ]
        elif action == "deposited" and event_id in first_deposit_ids:
            kind = "first_deposit"
            title = f"{name} received its first deposit"
            description = f"The first recorded vault deposit was {value}."
            facts = [
                {"label": "first deposit", "value": value},
                {"label": "block", "value": f"#{_safe_int(row.get('block_number'))}"},
                {"label": "asset", "value": str(context["asset"]["symbol"])},
            ]
        elif action in KEY_FILL_ACTIONS:
            kind = "agent_key_fill"
            key_symbol = str(row.get("key_symbol") or "Agent Key")
            quantity = str(row.get("quantity") or "0")
            title = f"{quantity} ${key_symbol} {action}"
            description = f"An Agent Key fill for {name} settled for {value}."
            facts = [
                {"label": "Keys", "value": f"{quantity} ${key_symbol}"},
                {"label": "fill value", "value": value},
                {"label": "market", "value": "separate Agent Key market"},
            ]
        else:
            return None
        return self._card(
            proof_id=proof_id,
            kind=kind,
            title=title,
            summary=description,
            timestamp=str(row["timestamp"]),
            action=action,
            reason=None,
            event_count=1,
            context=context,
            receipt=_chain_receipt(self.settings, row),
            facts=facts,
        )

    def _range_card(
        self,
        rows: list[dict[str, object]],
        by_agent: dict[int, dict[str, object]],
        keeper_run: dict[str, object] | None,
    ) -> dict[str, object] | None:
        if not rows:
            return None
        row = max(rows, key=lambda item: _safe_int(item.get("log_index")))
        agent_id = row.get("agent_id")
        performance = by_agent.get(agent_id) if isinstance(agent_id, int) else None
        if performance is None:
            return None
        tx_hash = str(row.get("tx_hash") or "").lower()
        if not tx_hash:
            return None
        actions = {str(item.get("action") or "") for item in rows}
        if actions == RANGE_ACTIONS:
            action = "range recentered"
        elif "opened range" in actions:
            action = "range opened"
        else:
            action = "range closed"
        context = _performance_context(performance)
        name = str(context["subject"]["name"])
        market_range = _mapping(_mapping(performance.get("market")).get("range"))
        facts = [
            {"label": "change", "value": action},
            {"label": "pool", "value": _pool_label(context["market"])},
            {"label": "asset", "value": str(context["asset"]["symbol"])},
        ]
        if market_range:
            facts.append(
                {
                    "label": "observed range",
                    "value": f"tick {market_range.get('lower_tick')} to {market_range.get('upper_tick')}",
                }
            )
        reason = str(keeper_run.get("reason")) if keeper_run and keeper_run.get("reason") else None
        return self._card(
            proof_id=f"range-change-{tx_hash.removeprefix('0x')}",
            kind="range_change",
            title=f"{name} {action}",
            summary=(
                f"The range transaction was confirmed. Latest market health is {context['market']['health_status']}."
            ),
            timestamp=str(row["timestamp"]),
            action=action,
            reason=reason,
            event_count=1,
            context=context,
            receipt=_chain_receipt(self.settings, row),
            facts=facts,
        )

    def _keeper_action_card(
        self,
        row: dict[str, object],
        performance: dict[str, object] | None,
    ) -> dict[str, object] | None:
        if performance is None:
            return None
        run_id = _safe_int(row.get("id"))
        action = str(row.get("action") or "acted")
        reason = str(row.get("reason") or "No reason was recorded.")
        context = _performance_context(performance)
        name = str(context["subject"]["name"])
        tx_hash = str(row.get("tx_hash") or "")
        receipt: dict[str, object] = {
            "state": "confirmed" if tx_hash else "no_transaction",
            "tx_hash": tx_hash or None,
            "url": f"{self.settings.explorer_url}/tx/{tx_hash}" if tx_hash else None,
            "block_number": None,
        }
        return self._card(
            proof_id=f"keeper-action-{run_id}",
            kind="keeper_action",
            title=f"{name} keeper {action}",
            summary=f"The policy-bounded keeper acted because {reason}.",
            timestamp=str(row["created_at"]),
            action=f"keeper {action}",
            reason=reason,
            event_count=1,
            context=context,
            receipt=receipt,
            facts=[
                {"label": "decision", "value": action},
                {"label": "reason", "value": reason},
                {"label": "status", "value": str(row.get("status") or "recorded")},
            ],
        )

    def _keeper_hold_card(
        self,
        rows: list[dict[str, object]],
        performance: dict[str, object] | None,
        *,
        reserve: bool,
        reserve_state: dict[str, object] | None,
        reserve_observed_at: str | None,
    ) -> dict[str, object] | None:
        if not rows or (performance is None and not reserve):
            return None
        ordered = sorted(rows, key=lambda item: _parse_datetime(item.get("created_at")))
        latest = ordered[-1]
        if performance is not None:
            context = _performance_context(performance)
            agent_id = _safe_int(_mapping(performance.get("agent")).get("id"))
        else:
            context = _reserve_context(reserve_state, None, reserve_observed_at)
            agent_id = None
        proof_id = keeper_hold_proof_id(latest.get("created_at"), agent_id, reserve=reserve)
        name = str(context["subject"]["name"])
        latest_reason = str(latest.get("reason") or "No reason was recorded.")
        unique_reasons = list(dict.fromkeys(str(row.get("reason") or "unlabeled hold") for row in ordered))
        day = _parse_datetime(latest.get("created_at")).strftime("%B %d, %Y UTC")
        return self._card(
            proof_id=proof_id,
            kind="keeper_daily_summary",
            title=f"{name}: {len(rows)} keeper holds",
            summary=f"{len(rows)} scheduled checks held on {day}. Latest reason: {latest_reason}.",
            timestamp=str(latest["created_at"]),
            action="keeper held",
            reason=latest_reason,
            event_count=len(rows),
            context=context,
            receipt={"state": "no_transaction", "tx_hash": None, "url": None, "block_number": None},
            facts=[
                {"label": "checks grouped", "value": str(len(rows))},
                {"label": "distinct reasons", "value": str(len(unique_reasons))},
                {"label": "latest reason", "value": latest_reason},
            ],
        )

    def _nav_milestone_cards(
        self,
        agent_id: int,
        performance: dict[str, object],
    ) -> list[dict[str, object]]:
        rows = self.database.list_performance_checkpoints(agent_id)
        if len(rows) < 2:
            return []
        opening_assets = _safe_int(rows[0].get("total_assets"))
        positive_high = 0
        negative_high = 0
        cards: list[dict[str, object]] = []
        context = _performance_context(performance)
        name = str(context["subject"]["name"])
        decimals = _safe_int(_mapping(performance.get("asset")).get("decimals"))
        for row in rows[1:]:
            change, basis_points = flow_adjusted_change(
                opening_assets,
                _safe_int(row.get("total_assets")),
                _safe_int(row.get("cumulative_deposits")),
                _safe_int(row.get("cumulative_withdrawals")),
            )
            if basis_points is None or abs(basis_points) < 100:
                continue
            level = abs(basis_points) // 100
            if basis_points > 0:
                if level <= positive_high:
                    continue
                positive_high = level
            else:
                if level <= negative_high:
                    continue
                negative_high = level
            sign = "+" if basis_points > 0 else "-"
            milestone = f"{sign}{level}.00%"
            block_number = _safe_int(row.get("block_number"))
            cards.append(
                self._card(
                    proof_id=f"nav-milestone-{agent_id}-{block_number}",
                    kind="nav_milestone",
                    title=f"{name} crossed {milestone} tracked change",
                    summary=(
                        f"The flow-adjusted vault change crossed {milestone} since tracking began. This is not APY."
                    ),
                    timestamp=str(row["block_timestamp"]),
                    action="flow-adjusted NAV milestone",
                    reason="A recorded checkpoint crossed a new whole-percentage high-water mark.",
                    event_count=1,
                    context=context,
                    receipt={
                        "state": "no_transaction",
                        "tx_hash": None,
                        "url": None,
                        "block_number": block_number,
                    },
                    facts=[
                        {"label": "milestone", "value": milestone},
                        {"label": "adjusted asset change", "value": _format_raw(change, decimals)},
                        {"label": "checkpoint block", "value": f"#{block_number}"},
                    ],
                )
            )
        return cards

    def _reserve_purchase_card(
        self,
        row: dict[str, object],
        proof_id: str,
        reserve_state: dict[str, object] | None,
        reserve_observed_at: str | None,
    ) -> dict[str, object] | None:
        symbol = str(row.get("value_symbol") or "Stock Token")
        context = _reserve_context(reserve_state, symbol, reserve_observed_at)
        if context["asset"]["address"] is None:
            return None
        value = _value_label(row)
        return self._card(
            proof_id=proof_id,
            kind="reserve_purchase",
            title=f"reserve purchased {value}",
            summary=f"The fee reserve completed a recorded {symbol} purchase through its configured route.",
            timestamp=str(row["timestamp"]),
            action="reserve purchased",
            reason="The reserve crossed its purchase threshold and the route checks passed.",
            event_count=1,
            context=context,
            receipt=_chain_receipt(self.settings, row),
            facts=[
                {"label": "received", "value": value},
                {"label": "route", "value": _pool_label(context["market"])},
                {"label": "health", "value": str(context["market"]["health_status"])},
            ],
        )

    def _reserve_state(self) -> tuple[dict[str, object] | None, str | None]:
        try:
            state = self.chain.read_rwa_reserve()
            return state, datetime.now(UTC).isoformat()
        except Exception:
            snapshot = self.database.get_service_snapshot("rwa_reserve")
            if snapshot is None:
                return None, None
            payload = snapshot.get("payload")
            return (_mapping(payload), str(snapshot.get("observed_at") or "") or None)

    def _card(
        self,
        *,
        proof_id: str,
        kind: ProofKind,
        title: str,
        summary: str,
        timestamp: str,
        action: str,
        reason: str | None,
        event_count: int,
        context: dict[str, Any],
        receipt: dict[str, object],
        facts: list[dict[str, str]],
    ) -> dict[str, object]:
        normalized = proof_id.lower()
        public_url = public_proof_url(self.settings, normalized)
        app_url = f"{self.settings.public_base_url}/app/proof/{normalized}"
        image_url = f"{self.settings.public_base_url}/api/v1/proofs/{normalized}/card.png"
        share_summary = summary if len(summary) <= 150 else f"{summary[:147].rstrip()}..."
        payload: dict[str, object] = {
            "id": normalized,
            "kind": kind,
            "category_label": CATEGORY_LABELS[kind],
            "title": title,
            "summary": summary,
            "timestamp": timestamp,
            "action": action,
            "reason": reason,
            "event_count": event_count,
            "subject": context["subject"],
            "asset": context["asset"],
            "market": context["market"],
            "receipt": receipt,
            "facts": facts,
            "token_symbol": self.settings.muppets_token_symbol,
            "token_address": self.settings.muppets_token_address or None,
            "public_url": public_url,
            "app_url": app_url,
            "image_url": image_url,
            "share_text": f"{title}\n\n{share_summary}",
            "boundary": PROOF_BOUNDARY,
            "no_apy_projection": True,
        }
        return ProofCard.model_validate(payload).model_dump(mode="json")

    def _store(self, card: dict[str, object], *, replace: bool = False) -> None:
        subject = _mapping(card.get("subject"))
        self.database.store_proof_card(
            ProofCardRecord(
                proof_id=str(card["id"]),
                kind=str(card["kind"]),
                event_timestamp=str(card["timestamp"]),
                agent_id=subject.get("agent_id") if isinstance(subject.get("agent_id"), int) else None,
                creator=str(subject["creator"]) if subject.get("creator") else None,
                payload=card,
            ),
            replace=replace,
        )


def _performance_context(performance: dict[str, object]) -> dict[str, Any]:
    agent = _mapping(performance.get("agent"))
    asset = _mapping(performance.get("asset"))
    market = _mapping(performance.get("market"))
    health = _mapping(market.get("health"))
    return {
        "subject": {
            "agent_id": _safe_int(agent.get("id")),
            "name": str(agent.get("name") or "Unnamed Muppet"),
            "pet_id": _safe_int(agent.get("pet_id")),
            "creator": str(agent.get("creator") or "") or None,
            "performance_url": f"/app/muppet/{_safe_int(agent.get('id'))}",
        },
        "asset": {
            "symbol": str(asset.get("symbol") or "unknown asset"),
            "address": str(asset.get("address") or "") or None,
        },
        "market": {
            "venue": str(market.get("venue") or "market evidence unavailable"),
            "pair": str(market.get("pair") or "") or None,
            "pool": str(market.get("pool") or "") or None,
            "market_id": str(market.get("market_id") or "") or None,
            "range": _proof_range(market.get("range")),
            "health_status": str(health.get("status") or "unavailable"),
            "health_detail": str(health.get("detail") or "Current market health detail is unavailable."),
            "observed_at": str(performance.get("market_observed_at") or "") or None,
        },
    }


def _reserve_context(
    reserve_state: dict[str, object] | None,
    symbol: str | None,
    observed_at: str | None,
) -> dict[str, Any]:
    state = reserve_state or {}
    routes = state.get("routes")
    route_rows = routes if isinstance(routes, list) else []
    route = next(
        (
            _mapping(candidate)
            for candidate in route_rows
            if str(_mapping(candidate).get("symbol") or "").lower() == str(symbol or "").lower()
        ),
        {},
    )
    enabled = bool(route.get("enabled"))
    stale = bool(state.get("stale"))
    health_status = "route_enabled" if enabled else "unavailable"
    health_detail = (
        "The configured reserve route is enabled in the latest cached observation."
        if enabled and stale
        else "The configured reserve route is enabled in the latest observation."
        if enabled
        else "A current enabled reserve route could not be matched."
    )
    return {
        "subject": {
            "agent_id": None,
            "name": "Stock Token reserve",
            "pet_id": None,
            "creator": None,
            "performance_url": None,
        },
        "asset": {
            "symbol": str(route.get("symbol") or symbol or "Stock Token"),
            "address": str(route.get("token") or "") or None,
        },
        "market": {
            "venue": "Robinhood Chain reserve route",
            "pair": f"USDG / {route.get('symbol')}" if route.get("symbol") else None,
            "pool": str(route.get("pool") or "") or None,
            "market_id": None,
            "range": None,
            "health_status": health_status,
            "health_detail": health_detail,
            "observed_at": observed_at,
        },
    }


def _chain_receipt(settings: Settings, row: dict[str, object]) -> dict[str, object]:
    tx_hash = str(row.get("tx_hash") or "")
    return {
        "state": "confirmed" if tx_hash else "no_transaction",
        "tx_hash": tx_hash or None,
        "url": f"{settings.explorer_url}/tx/{tx_hash}" if tx_hash else None,
        "block_number": _safe_int(row.get("block_number")) or None,
    }


def _proof_range(value: object) -> dict[str, object] | None:
    row = _mapping(value)
    if not row:
        return None
    in_range = row.get("in_range")
    return {
        "status": str(row.get("status") or "observed"),
        "position_key": str(row.get("position_key") or "") or None,
        "lower_tick": _safe_int(row.get("lower_tick")),
        "upper_tick": _safe_int(row.get("upper_tick")),
        "current_tick": _safe_int(row.get("current_tick")),
        "in_range": in_range if isinstance(in_range, bool) else None,
    }


def _value_label(row: dict[str, object]) -> str:
    value = str(row.get("value") or "0")
    symbol = str(row.get("value_symbol") or "assets")
    return f"{value} {symbol}"


def _pool_label(market: object) -> str:
    row = _mapping(market)
    return str(row.get("pool") or row.get("market_id") or "no external pool")


def _format_raw(value: int, decimals: int) -> str:
    rendered = f"{Decimal(value) / (Decimal(10) ** max(0, decimals)):.8f}".rstrip("0").rstrip(".")
    return rendered or "0"


def _slug_event_id(event_id: str) -> str:
    return event_id.lower().replace("0x", "", 1)


def _agent_id(summary: dict[str, object]) -> int:
    return _safe_int(_mapping(summary.get("agent")).get("id"))


def _mapping(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_int(value: object) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return 0


def _parse_datetime(value: object) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
