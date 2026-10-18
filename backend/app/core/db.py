"""SQLite persistence for users, indexed files & metadata.

We deliberately use a tiny SQLAlchemy core layer (no heavy ORM clboot) so the
service stays lightweight and dependency-minimal. Auth users, file metadata
and chunk counts live here so the admin portal can render a clean table.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
    select,
    text,
)
from sqlalchemy.exc import IntegrityError

from .config import settings
from .security import hash_password

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Engine & schema
# ---------------------------------------------------------------------------
_metadata = MetaData()

users_table = Table(
    "users",
    _metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("email", String(255), nullable=False, unique=True),
    Column("name", String(255), nullable=True),
    Column("role", String(32), nullable=False, default="student"),
    Column("password_hash", String(255), nullable=False),
    Column("created_at", DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)),
)

files_table = Table(
    "indexed_files",
    _metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("file_name", String(255), nullable=False, unique=True),
    Column("file_path", String(512), nullable=False),
    Column("status", String(32), nullable=False, default="ok"),  # ok|failed
    Column("chunk_count", Integer, nullable=False, default=0),
    Column("mime_type", String(128), nullable=True),
    Column("created_at", DateTime, nullable=False, default=lambda: datetime.now(timezone.utc)),
)


class Database:
    """Thin, thread-safe wrapper around the SQLAlchemy core engine."""

    _instance: "Database | None" = None
    _lock = threading.Lock()

    def __new__(cls) -> "Database":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._init_engine()
        return cls._instance

    def _init_engine(self) -> None:
        # Ensure the sqlite directory exists
        settings.SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
        # `check_same_thread=False` because FastAPI uses an async event loop
        # backed by a threadpool. The GIL + our own lock keep writes safe.
        self._engine = create_engine(
            f"sqlite:///{settings.SQLITE_PATH}",
            connect_args={"check_same_thread": False},
            future=True,
        )
        self._write_lock = threading.Lock()
        _metadata.create_all(self._engine)
        # Display name is NOT a unique username — duplicate names are fine; only
        # email is unique (declared on the users table). Wrap in try/except so a
        # legacy DB that still has the old unique index can start up.
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    text("DROP INDEX IF EXISTS idx_users_name")
                )
        except Exception:
            logger.warning("Could not drop legacy unique index on users.name")
        self._seed_admin()
        logger.info("SQLite ready at %s", settings.SQLITE_PATH)

    # ------------------------------------------------------------------
    def _seed_admin(self) -> None:
        """Create the default admin account on first run."""
        with self._engine.connect() as conn:
            exists = conn.execute(
                select(users_table.c.id).where(users_table.c.email == settings.SEED_ADMIN_EMAIL)
            ).first()
        if exists:
            return
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    users_table.insert().values(
                        email=settings.SEED_ADMIN_EMAIL,
                        name=settings.SEED_ADMIN_NAME,
                        role="admin",
                        password_hash=hash_password(settings.SEED_ADMIN_PASSWORD),
                    )
                )
            logger.info("Seeded default admin: %s", settings.SEED_ADMIN_EMAIL)
        except IntegrityError:
            # Race with another worker — fine.
            pass

    # ------------------------------------------------------------------
    # User operations
    # ------------------------------------------------------------------
    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                select(users_table).where(users_table.c.email == email)
            ).mappings().first()
        return dict(row) if row else None

    def get_user_by_name(self, name: str) -> dict[str, Any] | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                select(users_table).where(users_table.c.name == name)
            ).mappings().first()
        return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> dict[str, Any] | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                select(users_table).where(users_table.c.id == user_id)
            ).mappings().first()
        return dict(row) if row else None

    def list_users(self) -> list[dict[str, Any]]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                select(users_table.c.id, users_table.c.email, users_table.c.name, users_table.c.role)
                .order_by(users_table.c.id)
            ).mappings().all()
        return [dict(r) for r in rows]

    def create_user(self, *, email: str, password: str, name: str | None = None, role: str = "student") -> dict[str, Any]:
        with self._write_lock, self._engine.begin() as conn:
            res = conn.execute(
                users_table.insert().values(
                    email=email,
                    name=name,
                    role=role,
                    password_hash=hash_password(password),
                )
            )
            uid = res.inserted_primary_key[0]
        user = self.get_user_by_email(email)
        return user or {"id": uid, "email": email, "name": name, "role": role}

    def update_user_role(self, user_id: int, role: str) -> dict[str, Any] | None:
        with self._write_lock, self._engine.begin() as conn:
            res = conn.execute(
                users_table.update()
                .where(users_table.c.id == user_id)
                .values(role=role)
            )
            if res.rowcount == 0:
                return None
        return self.get_user_by_id(user_id)

    def delete_user(self, user_id: int) -> bool:
        with self._write_lock, self._engine.begin() as conn:
            res = conn.execute(users_table.delete().where(users_table.c.id == user_id))
            return res.rowcount > 0

    def update_user_password(self, user_id: int, new_password: str) -> bool:
        """Update a user's password hash (does NOT re-verify old password here)."""
        with self._write_lock, self._engine.begin() as conn:
            res = conn.execute(
                users_table.update()
                .where(users_table.c.id == user_id)
                .values(password_hash=hash_password(new_password))
            )
            return res.rowcount > 0

    def update_user_email(self, user_id: int, email: str) -> dict[str, Any] | None:
        """Update a user's email/username. Returns the updated row."""
        with self._write_lock, self._engine.begin() as conn:
            res = conn.execute(
                users_table.update()
                .where(users_table.c.id == user_id)
                .values(email=email)
            )
            if res.rowcount == 0:
                return None
        return self.get_user_by_id(user_id)

    # ------------------------------------------------------------------
    # Indexed-file operations
    # ------------------------------------------------------------------
    def upsert_file(self, *, file_name: str, file_path: str, mime_type: str, chunk_count: int, status: str = "ok") -> dict[str, Any]:
        with self._write_lock, self._engine.begin() as conn:
            existing = conn.execute(
                select(files_table.c.id).where(files_table.c.file_name == file_name)
            ).first()
            if existing:
                conn.execute(
                    files_table.update()
                    .where(files_table.c.file_name == file_name)
                    .values(
                        file_path=str(file_path),
                        mime_type=mime_type,
                        chunk_count=chunk_count,
                        status=status,
                        created_at=datetime.now(timezone.utc),
                    )
                )
            else:
                conn.execute(
                    files_table.insert().values(
                        file_name=file_name,
                        file_path=str(file_path),
                        mime_type=mime_type,
                        chunk_count=chunk_count,
                        status=status,
                    )
                )
        return self.get_file(file_name)  # type: ignore[return-value]

    def list_files(self) -> list[dict[str, Any]]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                select(files_table).order_by(files_table.c.created_at.desc())
            ).mappings().all()
        return [dict(r) for r in rows]

    def get_file(self, file_name: str) -> dict[str, Any] | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                select(files_table).where(files_table.c.file_name == file_name)
            ).mappings().first()
        return dict(row) if row else None

    def delete_file(self, file_name: str) -> bool:
        with self._write_lock, self._engine.begin() as conn:
            res = conn.execute(files_table.delete().where(files_table.c.file_name == file_name))
            deleted = res.rowcount > 0
        return deleted


def get_db() -> Database:
    """Accessor for the singleton DB."""
    return Database()
