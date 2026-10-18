"""Native GGUF embedder for the multilingual bge-m3 model.

Loads `models/embedding/bge-m3-Q5_k_m.gguf` **in-process** via
`llama-cpp-python` (with `embedding=True`). No internet, no
`sentence-transformers`, no HuggingFace Hub access.

The embedder is a thread-safe singleton — the GGUF model is expensive to load,
so we initialize it once and reuse it for every ingest / query call.
"""
from __future__ import annotations

import logging
import threading
from typing import Sequence

import numpy as np

from ..core.config import settings

logger = logging.getLogger(__name__)


class BgeM3Embedder:
    """Thread-safe singleton wrapping a llama-cpp-python embedding model."""

    _instance: "BgeM3Embedder | None" = None
    _lock = threading.Lock()

    def __new__(cls) -> "BgeM3Embedder":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._init_model()
        return cls._instance

    # ------------------------------------------------------------------
    def _init_model(self) -> None:
        """Load the GGUF embedding model exactly once."""
        # Imported lazily so that `import app.main` works even before the
        # `llama_cpp` package is installed (e.g. during CI type checks).
        try:
            from llama_cpp import Llama
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "llama-cpp-python is not installed. Run "
                "`pip install -r backend/requirements.txt` and see the README "
                "for GPU-specific build instructions."
            ) from exc

        path = settings.EMBEDDING_MODEL_PATH
        if not path.exists():
            raise FileNotFoundError(
                f"Embedding model not found at {path}. The models under "
                "models/ are pre-existing; ensure bge-m3 GGUF is in place."
            )

        logger.info("Loading embedding model: %s", path)
        self._llm = Llama(
            model_path=str(path),
            embedding=True,
            n_gpu_layers=settings.EMBED_N_GPU_LAYERS,
            n_threads=settings.EMBED_N_THREADS,
            n_ctx=0,          # bge-m3 has a fixed context — use model default
            verbose=False,
        )
        logger.info("Embedding model ready.")

    # ------------------------------------------------------------------
    def embed(self, texts: str | Sequence[str]) -> np.ndarray:
        """Embed a single string or a batch of strings.

        Returns an `np.ndarray` of shape `(n, dim)` normalized to unit length
        so cosine similarity reduces to a simple dot product downstream.
        """
        single = isinstance(texts, str)
        items = [texts] if single else list(texts)
        if not items:
            return np.zeros((0, 1024), dtype=np.float32)

        vecs: list[list[float]] = []
        for i in range(0, len(items), settings.EMBED_BATCH_SIZE):
            batch = items[i : i + settings.EMBED_BATCH_SIZE]
            for text in batch:
                raw = self._llm.create_embedding([text])["data"][0]["embedding"]
                vecs.append(raw)

        arr = np.asarray(vecs, dtype=np.float32)
        # L2-normalize → cosine similarity == dot product
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        arr = arr / norms
        return arr[0] if single else arr

    @property
    def dim(self) -> int:
        return int(self._llm.n_embd())


# Module-level accessor — keeps the import surface clean.
def get_embedder() -> BgeM3Embedder:
    return BgeM3Embedder()
