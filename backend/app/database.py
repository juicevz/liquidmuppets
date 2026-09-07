from __future__ import annotations

import json
import secrets
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path


@dataclass(frozen=True)
class KeeperRunRecord:
    vault: str
    task_id: int
    action: str
    amount: str
    reason: str
    status: str
    tx_hash: str | None = None


@dataclass(frozen=True)
class PerformanceCheckpointRecord:
    agent_id: int
    vault: str
    task_id: int
    block_number: int
    block_timestamp: str
    asset_symbol: str
    asset_decimals: int
    share_symbol: str
    share_decimals: int
    total_assets: str
    total_supply: str
    share_price_raw: str
    idle_assets: str
    deployed_assets: str
    cumulative_deposits: str
    cumulative_withdrawals: str


@dataclass(frozen=True)
class ProofCardRecord:
    proof_id: str
    kind: str
    event_timestamp: str
    agent_id: int | None
    creator: str | None
    payload: dict[str, object]


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS keeper_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    vault TEXT NOT NULL,
                    task_id INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    status TEXT NOT NULL,
                    tx_hash TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS wallet_profiles (
                    wallet TEXT PRIMARY KEY,
                    handle TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS profile_challenges (
                    nonce TEXT PRIMARY KEY,
                    wallet TEXT NOT NULL,
                    handle TEXT NOT NULL,
                    message TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS performance_checkpoints (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id INTEGER NOT NULL,
                    vault TEXT NOT NULL,
                    task_id INTEGER NOT NULL,
                    block_number INTEGER NOT NULL,
                    block_timestamp TEXT NOT NULL,
                    asset_symbol TEXT NOT NULL,
                    asset_decimals INTEGER NOT NULL,
                    share_symbol TEXT NOT NULL,
                    share_decimals INTEGER NOT NULL,
                    total_assets TEXT NOT NULL,
                    total_supply TEXT NOT NULL,
                    share_price_raw TEXT NOT NULL,
                    idle_assets TEXT NOT NULL,
                    deployed_assets TEXT NOT NULL,
                    cumulative_deposits TEXT NOT NULL,
                    cumulative_withdrawals TEXT NOT NULL,
                    captured_at TEXT NOT NULL,
                    UNIQUE(vault, block_number)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS performance_checkpoints_agent_time
                ON performance_checkpoints (agent_id, block_number)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS marketplace_performance (
                    agent_id INTEGER PRIMARY KEY,
                    payload TEXT NOT NULL,
                    observed_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_events (
                    id TEXT PRIMARY KEY,
                    block_number INTEGER NOT NULL,
                    log_index INTEGER NOT NULL,
                    payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS activity_events_chain_order
                ON activity_events (block_number DESC, log_index DESC)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_orders (
                    market TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    order_id INTEGER NOT NULL,
                    key_address TEXT NOT NULL,
                    block_number INTEGER NOT NULL,
                    PRIMARY KEY (market, kind, order_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_indexer_state (
                    source TEXT PRIMARY KEY,
                    next_block INTEGER NOT NULL,
                    last_success_at TEXT NOT NULL,
                    last_error_at TEXT,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS service_snapshots (
                    key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    observed_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS proof_cards (
                    proof_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    event_timestamp TEXT NOT NULL,
                    agent_id INTEGER,
                    creator TEXT,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS proof_cards_time
                ON proof_cards (event_timestamp DESC, proof_id DESC)
                """
            )

    def add_keeper_run(self, record: KeeperRunRecord) -> int:
        values = asdict(record)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO keeper_runs (vault, task_id, action, amount, reason, status, tx_hash, created_at)
                VALUES (:vault, :task_id, :action, :amount, :reason, :status, :tx_hash, :created_at)
                """,
                {**values, "created_at": datetime.now(UTC).isoformat()},
            )
            if cursor.lastrowid is None:
                raise RuntimeError("keeper run insert did not return an id")
            return int(cursor.lastrowid)

    def list_keeper_runs(self, limit: int = 50) -> list[dict[str, object]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM keeper_runs ORDER BY id DESC LIMIT ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_last_keeper_run(self, vault: str) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM keeper_runs WHERE LOWER(vault) = LOWER(?) ORDER BY id DESC LIMIT 1",
                (vault,),
            ).fetchone()
        return dict(row) if row else None

    def add_performance_checkpoint(self, record: PerformanceCheckpointRecord) -> dict[str, object]:
        values = asdict(record)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO performance_checkpoints (
                    agent_id, vault, task_id, block_number, block_timestamp,
                    asset_symbol, asset_decimals, share_symbol, share_decimals,
                    total_assets, total_supply, share_price_raw, idle_assets, deployed_assets,
                    cumulative_deposits, cumulative_withdrawals, captured_at
                ) VALUES (
                    :agent_id, :vault, :task_id, :block_number, :block_timestamp,
                    :asset_symbol, :asset_decimals, :share_symbol, :share_decimals,
                    :total_assets, :total_supply, :share_price_raw, :idle_assets, :deployed_assets,
                    :cumulative_deposits, :cumulative_withdrawals, :captured_at
                )
                """,
                {**values, "captured_at": datetime.now(UTC).isoformat()},
            )
            row = connection.execute(
                "SELECT * FROM performance_checkpoints WHERE LOWER(vault) = LOWER(?) AND block_number = ?",
                (record.vault, record.block_number),
            ).fetchone()
        if row is None:
            raise RuntimeError("performance checkpoint insert could not be read")
        return dict(row)

    def get_latest_performance_checkpoint(self, vault: str) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM performance_checkpoints
                WHERE LOWER(vault) = LOWER(?)
                ORDER BY block_number DESC, id DESC
                LIMIT 1
                """,
                (vault,),
            ).fetchone()
        return dict(row) if row else None

    def list_performance_checkpoints(self, agent_id: int) -> list[dict[str, object]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM performance_checkpoints
                WHERE agent_id = ?
                ORDER BY block_number ASC, id ASC
                """,
                (agent_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def upsert_marketplace_performance(self, agent_id: int, payload: dict[str, object]) -> None:
        observed_at = str(payload["market_observed_at"])
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO marketplace_performance (agent_id, payload, observed_at)
                VALUES (?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET
                    payload = excluded.payload,
                    observed_at = excluded.observed_at
                """,
                (agent_id, json.dumps(payload, separators=(",", ":"), sort_keys=True), observed_at),
            )

    def list_marketplace_performance(self) -> list[dict[str, object]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM marketplace_performance ORDER BY agent_id ASC"
            ).fetchall()
        return [json.loads(str(row["payload"])) for row in rows]

    def get_marketplace_performance(self, agent_id: int) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload FROM marketplace_performance WHERE agent_id = ?",
                (agent_id,),
            ).fetchone()
        return json.loads(str(row["payload"])) if row else None

    def commit_activity_index(
        self,
        source: str,
        next_block: int,
        events: list[dict[str, object]],
        orders: list[tuple[str, str, int, str, int]],
        *,
        rewind_from_block: int | None = None,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        with self.connect() as connection:
            if rewind_from_block is not None:
                connection.execute("DELETE FROM activity_events WHERE block_number >= ?", (rewind_from_block,))
                connection.execute("DELETE FROM activity_orders WHERE block_number >= ?", (rewind_from_block,))
            connection.executemany(
                """
                INSERT INTO activity_events (id, block_number, log_index, payload)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    block_number = excluded.block_number,
                    log_index = excluded.log_index,
                    payload = excluded.payload
                """,
                [
                    (
                        str(event["id"]),
                        int(str(event["block_number"])),
                        int(str(event["log_index"])),
                        json.dumps(event, separators=(",", ":"), sort_keys=True),
                    )
                    for event in events
                ],
            )
            connection.executemany(
                """
                INSERT INTO activity_orders (market, kind, order_id, key_address, block_number)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(market, kind, order_id) DO UPDATE SET
                    key_address = excluded.key_address,
                    block_number = excluded.block_number
                """,
                orders,
            )
            connection.execute(
                """
                INSERT INTO activity_indexer_state (source, next_block, last_success_at, last_error_at, updated_at)
                VALUES (?, ?, ?, NULL, ?)
                ON CONFLICT(source) DO UPDATE SET
                    next_block = excluded.next_block,
                    last_success_at = excluded.last_success_at,
                    last_error_at = NULL,
                    updated_at = excluded.updated_at
                """,
                (source, next_block, now, now),
            )

    def mark_activity_index_error(self, source: str) -> None:
        now = datetime.now(UTC).isoformat()
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE activity_indexer_state
                SET last_error_at = ?, updated_at = ?
                WHERE source = ?
                """,
                (now, now, source),
            )

    def get_activity_index_state(self, source: str) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM activity_indexer_state WHERE source = ?",
                (source,),
            ).fetchone()
        return dict(row) if row else None

    def list_activity_events(self, limit: int = 200, agent_id: int | None = None) -> list[dict[str, object]]:
        bounded = max(1, min(limit, 200))
        with self.connect() as connection:
            if agent_id is None:
                rows = connection.execute(
                    "SELECT payload FROM activity_events ORDER BY block_number DESC, log_index DESC LIMIT ?",
                    (bounded,),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT payload FROM activity_events
                    WHERE CAST(json_extract(payload, '$.agent_id') AS INTEGER) = ?
                    ORDER BY block_number DESC, log_index DESC
                    LIMIT ?
                    """,
                    (agent_id, bounded),
                ).fetchall()
        return [json.loads(str(row["payload"])) for row in rows]

    def list_proof_activity_events(self, limit: int = 10_000) -> list[dict[str, object]]:
        bounded = max(1, min(limit, 10_000))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT payload FROM activity_events
                WHERE json_extract(payload, '$.action') IN (
                    'launched', 'deposited', 'bought', 'sold',
                    'opened range', 'closed range', 'reserve bought'
                )
                ORDER BY block_number DESC, log_index DESC
                LIMIT ?
                """,
                (bounded,),
            ).fetchall()
        return [json.loads(str(row["payload"])) for row in rows]

    def first_activity_event_ids(self, action: str) -> set[str]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT payload FROM activity_events
                WHERE json_extract(payload, '$.action') = ?
                ORDER BY block_number ASC, log_index ASC
                """,
                (action,),
            ).fetchall()
        first_by_agent: dict[int, str] = {}
        for row in rows:
            payload = json.loads(str(row["payload"]))
            agent_id = payload.get("agent_id")
            event_id = payload.get("id")
            if isinstance(agent_id, int) and isinstance(event_id, str):
                first_by_agent.setdefault(agent_id, event_id)
        return set(first_by_agent.values())

    def list_all_keeper_runs(self, limit: int = 10_000) -> list[dict[str, object]]:
        bounded = max(1, min(limit, 10_000))
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM keeper_runs ORDER BY id DESC LIMIT ?",
                (bounded,),
            ).fetchall()
        return [dict(row) for row in rows]

    def store_proof_card(self, record: ProofCardRecord, *, replace: bool = False) -> None:
        now = datetime.now(UTC).isoformat()
        values = (
            record.proof_id,
            record.kind,
            record.event_timestamp,
            record.agent_id,
            record.creator.lower() if record.creator else None,
            json.dumps(record.payload, separators=(",", ":"), sort_keys=True),
            now,
        )
        with self.connect() as connection:
            if replace:
                connection.execute(
                    """
                    INSERT INTO proof_cards (
                        proof_id, kind, event_timestamp, agent_id, creator, payload, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(proof_id) DO UPDATE SET
                        kind = excluded.kind,
                        event_timestamp = excluded.event_timestamp,
                        agent_id = excluded.agent_id,
                        creator = excluded.creator,
                        payload = excluded.payload,
                        updated_at = excluded.updated_at
                    """,
                    values,
                )
            else:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO proof_cards (
                        proof_id, kind, event_timestamp, agent_id, creator, payload, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )

    def get_proof_card(self, proof_id: str) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload FROM proof_cards WHERE proof_id = ?",
                (proof_id,),
            ).fetchone()
        return json.loads(str(row["payload"])) if row else None

    def list_proof_cards(
        self,
        limit: int = 50,
        *,
        kind: str | None = None,
        creator: str | None = None,
        agent_id: int | None = None,
    ) -> list[dict[str, object]]:
        bounded = max(1, min(limit, 200))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT payload FROM proof_cards
                WHERE (? IS NULL OR kind = ?)
                  AND (? IS NULL OR LOWER(creator) = LOWER(?))
                  AND (? IS NULL OR agent_id = ?)
                ORDER BY event_timestamp DESC, proof_id DESC
                LIMIT ?
                """,
                (kind, kind, creator, creator, agent_id, agent_id, bounded),
            ).fetchall()
        return [json.loads(str(row["payload"])) for row in rows]

    def list_activity_orders(self) -> list[tuple[str, str, int, str, int]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT market, kind, order_id, key_address, block_number FROM activity_orders"
            ).fetchall()
        return [
            (
                str(row["market"]),
                str(row["kind"]),
                int(row["order_id"]),
                str(row["key_address"]),
                int(row["block_number"]),
            )
            for row in rows
        ]

    def upsert_service_snapshot(self, key: str, payload: dict[str, object]) -> None:
        observed_at = datetime.now(UTC).isoformat()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO service_snapshots (key, payload, observed_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, observed_at = excluded.observed_at
                """,
                (key, json.dumps(payload, separators=(",", ":"), sort_keys=True), observed_at),
            )

    def get_service_snapshot(self, key: str) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT payload, observed_at FROM service_snapshots WHERE key = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None
        return {"payload": json.loads(str(row["payload"])), "observed_at": str(row["observed_at"])}

    def create_profile_challenge(self, wallet: str, handle: str) -> dict[str, str]:
        now = datetime.now(UTC)
        expires_at = now + timedelta(minutes=10)
        nonce = secrets.token_urlsafe(24)
        message = (
            "liquidmuppets.io wallet profile\n"
            f"wallet: {wallet}\n"
            f"handle: @{handle}\n"
            f"nonce: {nonce}\n"
            f"expires: {expires_at.isoformat()}"
        )
        with self.connect() as connection:
            connection.execute("DELETE FROM profile_challenges WHERE expires_at <= ?", (now.isoformat(),))
            connection.execute(
                """
                INSERT INTO profile_challenges (nonce, wallet, handle, message, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (nonce, wallet.lower(), handle, message, expires_at.isoformat(), now.isoformat()),
            )
        return {"nonce": nonce, "message": message, "expires_at": expires_at.isoformat()}

    def get_profile_challenge(self, nonce: str) -> dict[str, str] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT nonce, wallet, handle, message, expires_at FROM profile_challenges WHERE nonce = ?",
                (nonce,),
            ).fetchone()
        return dict(row) if row else None

    def claim_wallet_profile(self, wallet: str, handle: str, nonce: str) -> None:
        now = datetime.now(UTC).isoformat()
        with self.connect() as connection:
            existing = connection.execute(
                "SELECT wallet FROM wallet_profiles WHERE handle = ? AND wallet != ?",
                (handle, wallet.lower()),
            ).fetchone()
            if existing:
                raise ValueError("handle already claimed")
            connection.execute(
                """
                INSERT INTO wallet_profiles (wallet, handle, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(wallet) DO UPDATE SET handle = excluded.handle, updated_at = excluded.updated_at
                """,
                (wallet.lower(), handle, now, now),
            )
            connection.execute("DELETE FROM profile_challenges WHERE nonce = ?", (nonce,))

    def get_wallet_profile(self, wallet: str) -> dict[str, str] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT wallet, handle, created_at, updated_at FROM wallet_profiles WHERE wallet = ?",
                (wallet.lower(),),
            ).fetchone()
        return dict(row) if row else None

    def get_wallet_profiles(self, wallets: list[str]) -> dict[str, str]:
        normalized = sorted({wallet.lower() for wallet in wallets if wallet})
        if not normalized:
            return {}
        placeholders = ",".join("?" for _ in normalized)
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT wallet, handle FROM wallet_profiles WHERE wallet IN ({placeholders})",  # noqa: S608
                normalized,
            ).fetchall()
        return {str(row["wallet"]): str(row["handle"]) for row in rows}
