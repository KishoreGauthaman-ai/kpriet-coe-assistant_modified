"""Admin-only endpoints for document ingestion & management.

Flow (POST /api/v1/admin/ingest):
  upload PDF/DOCX ─▶ save to data/raw_documents/
                ─▶ semantic chunking (chunker.py)
                ─▶ in-process bge-m3 embedding (embedder.py) [thread-pool offloaded]
                ─▶ ChromaDB upsert (store.py)
                ─▶ record metadata in SQLite (db.py)

All admin endpoints are protected by `require_admin` (JWT role == 'admin').
"""
import asyncio
import logging
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..core.config import settings
from ..core.db import get_db
from ..core.security import require_admin
from ..rag.chunker import chunk_document
from ..rag.embedder import get_embedder
from ..rag.store import get_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class FileRow(BaseModel):
    id: int | None = None
    file_name: str
    file_path: str | None = None
    status: str = "ok"
    chunk_count: int = 0
    mime_type: str | None = None


class IngestResponse(BaseModel):
    file_name: str
    chunk_count: int
    status: str = "ok"
    message: str = "Indexed successfully"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _validate_upload(file: UploadFile) -> tuple[str, str]:
    name = (file.filename or "").lower()
    ext = Path(name).suffix
    if ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: "
            + ", ".join(settings.ALLOWED_EXTENSIONS),
        )
    mime = file.content_type or ""
    if mime and mime not in settings.ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported MIME: {mime}")
    return ext, (mime or "application/octet-stream")


def _guard_size(file: UploadFile) -> None:
    if not file.size:
        return
    if file.size > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {settings.MAX_UPLOAD_MB} MB limit",
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/ingest", response_model=IngestResponse)
async def ingest_file(
    file: UploadFile = File(...),
    _admin: dict = require_admin,
) -> IngestResponse:
    """Upload, chunk, embed and index a single PDF/DOCX file.

    RBAC: admin role only (checked by `require_admin` middleware at request time).
    """
    t0 = time.time()
    ext, mime = _validate_upload(file)
    _guard_size(file)

    settings.RAW_DOCS_DIR.mkdir(parents=True, exist_ok=True)
    file_name = Path(file.filename or "upload").name
    dest = settings.RAW_DOCS_DIR / file_name

    # B6: Persist upload data and close file handle explicitly
    with dest.open("wb") as fp:
        while True:
            block = await file.read(1024 * 1024)
            if not block:
                break
            fp.write(block)
    await file.close()

    logger.info("Ingesting file | file=%s | mime=%s | size=%s", dest, mime, file.size)
    try:
        chunks = chunk_document(dest, source_name=file_name)
        if not chunks:
            get_db().upsert_file(
                file_name=file_name,
                file_path=str(dest),
                mime_type=mime,
                chunk_count=0,
                status="failed",
            )
            raise HTTPException(
                status_code=422,
                detail="No extractable text found in the document.",
            )

        # B3: CPU-bound embedding offloaded to thread pool
        loop = asyncio.get_running_loop()
        embeddings = await loop.run_in_executor(
            None, get_embedder().embed, [c.text for c in chunks]
        )
        get_store().add_chunks(chunks, embeddings)
        get_db().upsert_file(
            file_name=file_name,
            file_path=str(dest),
            mime_type=mime,
            chunk_count=len(chunks),
            status="ok",
        )
        elapsed = time.time() - t0
        logger.info("Ingested %s (%d chunks) in %.1fs", file_name, len(chunks), elapsed)
        return IngestResponse(
            file_name=file_name,
            chunk_count=len(chunks),
            status="ok",
            message=f"Indexed {len(chunks)} chunks in {elapsed:.1f}s",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Ingest failed for %s: %s", file_name, exc)
        get_db().upsert_file(
            file_name=file_name,
            file_path=str(dest),
            mime_type=mime,
            chunk_count=0,
            status="failed",
        )
        raise HTTPException(status_code=500, detail=f"Ingest error: {exc}") from exc


@router.get("/files", response_model=list[FileRow])
def list_indexed_files(_admin: dict = require_admin) -> list[FileRow]:
    """List every indexed file (best-effort merge of SQLite + ChromaDB stats).

    RBAC: admin only.

    Notes:
    - SQLite is the source of truth for admin metadata.
    - ChromaDB stats are best-effort only; if vector-store enumeration fails,
      the endpoint still returns the SQLite rows instead of a 500.
    """
    sqlite_rows = get_db().list_files()
    chroma_stats: dict[str, int] = {}
    try:
        chroma_stats = {f["file"]: f["chunks"] for f in get_store().list_files()}
    except Exception as exc:
        logger.warning("Could not enumerate Chroma file stats; falling back to SQLite: %s", exc)

    out: list[FileRow] = []
    for r in sqlite_rows:
        out.append(
            FileRow(
                id=r.get("id"),
                file_name=r["file_name"],
                file_path=r.get("file_path"),
                status=r.get("status", "ok"),
                chunk_count=chroma_stats.get(r["file_name"], r.get("chunk_count", 0)),
                mime_type=r.get("mime_type"),
            )
        )
    seen = {r["file_name"] for r in sqlite_rows}
    for fname, chunks in chroma_stats.items():
        if fname not in seen:
            out.append(FileRow(file_name=fname, chunk_count=chunks))
    return out


@router.delete("/files/{file_name}")
def delete_indexed_file(file_name: str, _admin: dict = require_admin) -> dict:
    """Delete all chunks of a file from both ChromaDB and SQLite.

    RBAC: admin only.
    """
    removed_chunks = get_store().delete_file(file_name)
    get_db().delete_file(file_name)
    raw_path = settings.RAW_DOCS_DIR / file_name
    if raw_path.exists():
        try:
            raw_path.unlink()
        except OSError as exc:
            logger.warning("Could not delete raw file %s: %s", raw_path, exc)
    logger.info("Deleted indexed file: %s (%d chunks)", file_name, removed_chunks)
    return {
        "file_name": file_name,
        "removed_chunks": removed_chunks,
        "message": "Deleted",
    }


@router.get("/stats")
def admin_stats(_admin: dict = require_admin) -> dict:
    """Lightweight admin dashboard counts. RBAC: admin only."""
    store = get_store()
    db = get_db()
    return {
        "vector_count": store.count,
        "files_indexed": len(db.list_files()),
        "users": len(db.list_users()),
    }