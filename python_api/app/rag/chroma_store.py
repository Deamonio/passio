"""로컬 Chroma 영속 스토어 초기화 보강.

Chroma 1.x는 sysdb에 `default_tenant` / `default_database` 행이 있어야 하며,
SQLite 잠금·I/O 오류 시 클라이언트가 ChromaError가 아닌 예외를 받으면
"Could not connect to tenant default_tenant"처럼 오해의 소리 나는
ValueError로 감싸지기도 합니다. 디렉터리 생성·기본 행 보강·재시도로 완화합니다.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from pathlib import Path

import chromadb
from chromadb.config import DEFAULT_DATABASE, DEFAULT_TENANT
from langchain_chroma import Chroma
from langchain_core.embeddings import Embeddings

from ..settings import settings

logger = logging.getLogger(__name__)

LANGCHAIN_COLLECTION = "langchain"


def _ensure_persist_dir(path: str) -> Path:
    root = Path(path).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    if not os.access(root, os.W_OK):
        raise PermissionError(f"CHROMA_DB_DIR에 쓸 수 없습니다: {root}")
    return root


def _bootstrap_default_tenant_rows(sqlite_path: Path) -> None:
    """기존 DB에 tenants 테이블은 있으나 기본 행이 빠진 경우 보강."""
    if not sqlite_path.is_file():
        return
    uri = f"file:{sqlite_path}?mode=rwc"
    conn = sqlite3.connect(uri, uri=True, timeout=60.0)
    try:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenants'"
        ).fetchone()
        if row is None:
            return
        conn.execute(
            "INSERT OR IGNORE INTO tenants (id) VALUES (?)", (DEFAULT_TENANT,)
        )
        conn.execute(
            """INSERT OR IGNORE INTO databases (id, name, tenant_id)
               VALUES (?, ?, ?)""",
            (
                "00000000-0000-0000-0000-000000000000",
                DEFAULT_DATABASE,
                DEFAULT_TENANT,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_persistent_chroma_client(persist_directory: str) -> chromadb.ClientAPI:
    root = _ensure_persist_dir(persist_directory)
    sqlite_path = root / "chroma.sqlite3"
    last_exc: BaseException | None = None
    for attempt in range(1, 6):
        _bootstrap_default_tenant_rows(sqlite_path)
        try:
            return chromadb.PersistentClient(
                path=str(root),
                tenant=DEFAULT_TENANT,
                database=DEFAULT_DATABASE,
            )
        except (ValueError, sqlite3.OperationalError, OSError) as e:
            last_exc = e
            msg = str(e).lower()
            retryable = (
                "locked" in msg
                or "busy" in msg
                or "could not connect to tenant" in msg
            )
            logger.warning(
                "Chroma PersistentClient 시도 %s/5 실패 (%s): %s",
                attempt,
                type(e).__name__,
                e,
            )
            if not retryable or attempt == 5:
                break
            time.sleep(0.25 * attempt)
    raise RuntimeError(
        "벡터 DB(Chroma)를 열 수 없습니다. "
        f"CHROMA_DB_DIR={root} — 다른 프로세스가 DB를 잠갔거나, "
        f"chroma.sqlite3 손상·권한 문제일 수 있습니다. 원인: {last_exc!r}"
    ) from last_exc


def get_langchain_chroma(embedding_function: Embeddings) -> Chroma:
    client = get_persistent_chroma_client(settings.CHROMA_DB_DIR)
    return Chroma(
        client=client,
        collection_name=LANGCHAIN_COLLECTION,
        embedding_function=embedding_function,
        persist_directory=str(Path(settings.CHROMA_DB_DIR).resolve()),
    )
