"""
models.py - Per-user SQLite database management for Quantio.
Each user gets their own database at data/user_{user_id}.db
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np

# ── Path helpers ──────────────────────────────────────────────────────────────
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

REGISTRY_DB = DATA_DIR / "registry.db"  # stores user accounts


def _db_path(user_id: int) -> Path:
    return DATA_DIR / f"user_{user_id}.db"


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ── Registry (accounts) ───────────────────────────────────────────────────────

def init_registry():
    """Create the global user registry."""
    with _connect(REGISTRY_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                email      TEXT    UNIQUE NOT NULL,
                password   TEXT    NOT NULL,
                created_at TEXT    NOT NULL
            )
        """)
        conn.commit()


def create_user(email: str, hashed_password: str) -> int:
    """Insert a new user; returns new user_id."""
    with _connect(REGISTRY_DB) as conn:
        cur = conn.execute(
            "INSERT INTO users (email, password, created_at) VALUES (?, ?, ?)",
            (email, hashed_password, _now()),
        )
        conn.commit()
        return cur.lastrowid


def get_user_by_email(email: str) -> Optional[dict]:
    with _connect(REGISTRY_DB) as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email,)
        ).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> Optional[dict]:
    with _connect(REGISTRY_DB) as conn:
        row = conn.execute(
            "SELECT id, email, created_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        return dict(row) if row else None


def count_users() -> int:
    with _connect(REGISTRY_DB) as conn:
        return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]


# ── Per-user DB ───────────────────────────────────────────────────────────────

def init_db(user_id: int):
    """Create tables for a user's personal database."""
    path = _db_path(user_id)
    with _connect(path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                text       TEXT    NOT NULL,
                role       TEXT    NOT NULL DEFAULT 'user',
                embedding  BLOB,
                tags       TEXT    NOT NULL DEFAULT '[]',
                timestamp  TEXT    NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS preferences (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        conn.commit()


def store_memory(
    user_id: int,
    text: str,
    role: str = "user",
    embedding: Optional[list] = None,
    tags: Optional[list] = None,
) -> int:
    path = _db_path(user_id)
    emb_bytes = _encode_embedding(embedding) if embedding else None
    tags_json = json.dumps(tags or [])
    with _connect(path) as conn:
        cur = conn.execute(
            "INSERT INTO memories (text, role, embedding, tags, timestamp) VALUES (?, ?, ?, ?, ?)",
            (text, role, emb_bytes, tags_json, _now()),
        )
        conn.commit()
        return cur.lastrowid


def retrieve_memories(user_id: int, limit: int = 200) -> list[dict]:
    path = _db_path(user_id)
    with _connect(path) as conn:
        rows = conn.execute(
            "SELECT id, text, role, tags, timestamp FROM memories ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_memory_row(r) for r in rows]


def search_memories_semantic(
    user_id: int, query_embedding: list, top_k: int = 5
) -> list[dict]:
    """Return top_k memories by cosine similarity to query_embedding."""
    path = _db_path(user_id)
    with _connect(path) as conn:
        rows = conn.execute(
            "SELECT id, text, role, tags, timestamp, embedding FROM memories WHERE embedding IS NOT NULL"
        ).fetchall()

    if not rows:
        return []

    q = np.array(query_embedding, dtype=np.float32)
    scored = []
    for row in rows:
        emb = _decode_embedding(row["embedding"])
        score = _cosine_sim(q, emb)
        scored.append((score, row))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [_memory_row(r) for _, r in scored[:top_k]]


def delete_memory(user_id: int, memory_id: int) -> bool:
    path = _db_path(user_id)
    with _connect(path) as conn:
        cur = conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        conn.commit()
        return cur.rowcount > 0


def get_preference(user_id: int, key: str, default: Any = None) -> Any:
    path = _db_path(user_id)
    with _connect(path) as conn:
        row = conn.execute(
            "SELECT value FROM preferences WHERE key = ?", (key,)
        ).fetchone()
        if row:
            try:
                return json.loads(row["value"])
            except Exception:
                return row["value"]
        return default


def set_preference(user_id: int, key: str, value: Any):
    path = _db_path(user_id)
    with _connect(path) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
            (key, json.dumps(value)),
        )
        conn.commit()


def get_all_preferences(user_id: int) -> dict:
    path = _db_path(user_id)
    with _connect(path) as conn:
        rows = conn.execute("SELECT key, value FROM preferences").fetchall()
        result = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except Exception:
                result[row["key"]] = row["value"]
        return result


def export_user_data(user_id: int) -> dict:
    user = get_user_by_id(user_id)
    memories = retrieve_memories(user_id, limit=10_000)
    prefs = get_all_preferences(user_id)
    return {
        "exported_at": _now(),
        "user": {"id": user_id, "email": user.get("email") if user else ""},
        "preferences": prefs,
        "memories": memories,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _encode_embedding(emb: list) -> bytes:
    return np.array(emb, dtype=np.float32).tobytes()


def _decode_embedding(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def _memory_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "text": row["text"],
        "role": row["role"],
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "timestamp": row["timestamp"],
    }
