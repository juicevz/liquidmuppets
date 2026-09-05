from __future__ import annotations

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
