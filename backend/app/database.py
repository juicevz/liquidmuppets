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
