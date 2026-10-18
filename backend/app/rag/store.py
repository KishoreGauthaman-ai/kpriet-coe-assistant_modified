"""ChromaDB persistent vector store with the zero-hallucination gate.

The store holds a single collection (`kpriet_coe`) of L2-normalized bge-m3
embeddings. Cosine distance is computed by ChromaDB during query; we translate
that to a similarity decision using `DISTANCE_THRESHOLD` (default 0.45).

Key operations:
  * `add_chunks(chunks, embeddings)`  — bulk insert during ingest.
  * `query(embedding, k)`             — returns ranked hits (text + distance +
                                        source) while applying the zero-hallu-
                                        cination gate.
  * `list_files()` / `delete_file()`  — admin-facing file management.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Sequence

from ..core.config import settings
from .chunker import Chunk

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------
class RetrievalHit(dict):
    """Typed dict-ish result: {text, distance, source, heading, page}.

    `Objects returned by `query`."""
    __slots__ = ()


class RetrievalResult(dict):
    """Result envelope for the chat pipeline.

    Keys:
      `hits`     — list[RetrievalHit] of qualifying neighbours.
      `blocked`  — True when ALL nearest neighbours exceed the distance
                   threshold (the "zero-hallucination" fallback).
    """

    __slots__ = ()


# ---------------------------------------------------------------------------
# Singleton wrapper around a ChromaDB PersistentClient
# ---------------------------------------------------------------------------
class VectorStore:
    _instance: "VectorStore | None" = None
    _lock = threading.Lock()

    def __new__(cls) -> "VectorStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._init_client()
        return cls._instance

    def _init_client(self) -> None:
        import chromadb  # lazy import

        settings.VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("Opening ChromaDB at %s", settings.VECTOR_DB_DIR)
        self._client = chromadb.PersistentClient(
            path=str(settings.VECTOR_DB_DIR),
            # Use distance metric that mirrors cosine similarity for L2-normed
            # vectors. `cosine` is most explicit.
            settings=chromadb.Settings(anonymized_telemetry=False, allow_reset=True),
        )
        try:
            self._collection = self._client.get_or_create_collection(
                name=settings.COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
            self._collection.count()
        except TypeError:
            # Store was written by an incompatible ChromaDB version (e.g. the
            # metadata `seq_id` is an int instead of a blob). Rebuild cleanly.
            logger.warning(
                "Vector store at %s is incompatible/corrupt — rebuilding",
                settings.VECTOR_DB_DIR,
            )
            self._rebuild()
            return
        logger.info(
            "Collection '%s' ready with %d existing records",
            settings.COLLECTION_NAME,
            self._collection.count(),
        )

    def _rebuild(self) -> None:
        """Drop and recreate a fresh, compatible persistent store."""
        import chromadb  # lazy import

        try:
            self._client.reset()
        except Exception as exc:  # pragma: no cover
            logger.warning("Chroma reset failed (%s); removing store manually", exc)
        if settings.VECTOR_DB_DIR.exists():
            import shutil
            shutil.rmtree(settings.VECTOR_DB_DIR, ignore_errors=True)
        settings.VECTOR_DB_DIR.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=str(settings.VECTOR_DB_DIR),
            settings=chromadb.Settings(anonymized_telemetry=False, allow_reset=True),
        )
        self._collection = self._client.get_or_create_collection(
            name=settings.COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info("Rebuilt fresh vector store at %s", settings.VECTOR_DB_DIR)

    # ------------------------------------------------------------------
    @property
    def count(self) -> int:
        return self._collection.count()

    # ------------------------------------------------------------------
    def add_chunks(self, chunks: Sequence[Chunk], embeddings) -> None:
        """Bulk-upsert chunks with their embeddings."""
        if not chunks:
            return
        import numpy as np

        embs = np.asarray(embeddings, dtype=np.float32).tolist()
        ids = [c.id for c in chunks]
        texts = [c.text for c in chunks]
        metas = [c.metadata for c in chunks]
        self._collection.upsert(
            ids=ids, embeddings=embs, documents=texts, metadatas=metas
        )
        logger.info("Upserted %d chunks into '%s'", len(ids), settings.COLLECTION_NAME)

    # ------------------------------------------------------------------
    def query(self, embedding, *, k: int | None = None) -> dict[str, Any]:
        """Run a nearest-neighbour search and apply the zero-hallucination gate.

        Returns:
            {
              "hits":   [ {text, distance, source, heading, page}, ... ],
              "best_distance": float,
              "blocked": bool
            }

        `blocked=True` means: no neighbour was close enough → the caller MUST
        emit the fallback message instead of sending context to the LLM.
        """
        import numpy as np

        k = k or settings.RETRIEVE_K
        emb = np.asarray(embedding, dtype=np.float32).flatten().tolist()

        # ChromaDB's "distance" for cosine space == (1 - cosine_similarity),
        # i.e. 0 == identical. The spec's "cosine distance > 0.45 ⇒ block"
        # maps directly onto this metric.
        res = self._collection.query(
            query_embeddings=[emb],
            n_results=k,
            include=["documents", "metadatas", "distances"],
        )

        docs = (res.get("documents") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]

        if not docs:
            return {
                "hits": [],
                "best_distance": 1.0,
                "blocked": True,
                "threshold": settings.DISTANCE_THRESHOLD,
            }

        best = float(dists[0])
        hits: list[RetrievalHit] = []
        for doc, dist, meta in zip(docs, dists, metas):
            meta = meta or {}
            hits.append(
                RetrievalHit(
                    text=doc,
                    source=meta.get("source", ""),
                    heading=meta.get("heading", ""),
                    page=meta.get("page", 0),
                    distance=float(dist),
                )
            )

        blocked = best > settings.DISTANCE_THRESHOLD
        return {
            "hits": hits[: settings.CONTEXT_TOP_K_RERANK],
            "best_distance": best,
            "blocked": blocked,
            "threshold": settings.DISTANCE_THRESHOLD,
        }

    # ------------------------------------------------------------------
    def list_files(self) -> list[dict[str, Any]]:
        """Return one row per distinct source file with chunk counts."""
        all_recs = self._collection.get(include=["metadatas"])
        metas = all_recs.get("metadatas") or []
        seen: dict[str, int] = {}
        for meta in metas:
            source = (meta or {}).get("source", "?")
            seen[source] = seen.get(source, 0) + 1
        return [
            {"file": name, "chunks": count} for name, count in seen.items()
        ]

    def delete_file(self, file_name: str) -> int:
        """Delete every chunk whose `source` metadata equals `file_name`.

        Returns the number of vectors removed.
        """
        before = self._collection.count()
        self._collection.delete(where={"source": file_name})
        after = self._collection.count()
        removed = max(0, before - after)
        logger.info("Removed %d chunks for source '%s'", removed, file_name)
        return removed


def get_store() -> VectorStore:
    """Accessor for the singleton store."""
    return VectorStore()
