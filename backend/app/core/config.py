"""Centralized configuration for the KPRIET COE Assistant backend.

All paths are resolved relative to the project root (the parent of `backend/`)
so the service can be started from anywhere. Every value can be overridden via
environment variables (see `.env.example`).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------
#                                    project root
#                                       /  \
#                                 backend/   models/
BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent


# ---------------------------------------------------------------------------
# GPU auto-detection
# ---------------------------------------------------------------------------
# Detects CUDA availability at import time so the embedder (llama-cpp-python)
# and the voice transcriber (faster-whisper / CTranslate2) can automatically
# pick the right device. Override at any time via env vars:
#   EMBED_N_GPU_LAYERS=-1  (force GPU offload of bge-m3)
#   VOICE_DEVICE=cuda      (force GPU voice transcription)
def _detect_cuda() -> bool:
    """Return True if a CUDA-capable GPU is reachable from this process.

    Tries (in order): the `nvidia-smi` CLI, then `torch.cuda`, then `ct2` /
    CTranslate2's CUDA libs. Any hit → True. Silently returns False otherwise.
    """
    import os
    import shutil
    import subprocess

    # 1) nvidia-smi on PATH and exits cleanly.
    if shutil.which("nvidia-smi"):
        try:
            subprocess.run(
                ["nvidia-smi"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
            )
            return True
        except Exception:
            pass

    # 2) PyTorch CUDA (if installed — used by openai-whisper, not faster-whisper).
    try:
        import torch  # type: ignore
        if torch.cuda.is_available():
            return True
    except Exception:
        pass

    # 3) CTranslate2 CUDA libs present (faster-whisper's engine).
    try:
        import ctranslate2  # type: ignore
        if ctranslate2.get_cuda_device_count() > 0:
            return True
    except Exception:
        pass

    return False


_CUDA_AVAILABLE = _detect_cuda()


class Settings(BaseSettings):
    """Strongly-typed application settings loaded from env / .env."""

    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- General ---
    APP_NAME: str = "KPRIET COE Assistant"
    APP_VERSION: str = "1.0.0"
    ENV: Literal["dev", "prod"] = "dev"
    HOST: str = "127.0.0.1"
    PORT: int = 8000

    # --- CORS (Vite dev server) ---
    FRONTEND_URL: str = "http://127.0.0.1:5173"

    # --- Local model paths (DO NOT DOWNLOAD) ---
    MODELS_DIR: Path = PROJECT_ROOT / "models"
    BASE_MODEL_PATH: Path = PROJECT_ROOT / "models" / "base" / "Qwen3.5-4B-Q5_K_M.gguf"
    REASONING_MODEL_PATH: Path = PROJECT_ROOT / "models" / "reasoning" / "Qwen3.5-4B-Q5_K_M.gguf"
    EMBEDDING_MODEL_PATH: Path = PROJECT_ROOT / "models" / "embedding" / "bge-m3-Q5_K_M.gguf"
    VOICE_MODEL_PATH: Path = PROJECT_ROOT / "models" / "faster-whisper-small"

    # --- llama.cpp HTTP servers (served externally) ---
    BASE_SERVER_URL: str = "http://127.0.0.1:8080"
    REASONING_SERVER_URL: str = "http://127.0.0.1:8081"

    # --- Embedder (loaded natively in-process via llama-cpp-python) ---
    # -1 = offload all layers to GPU. 0 = CPU only. Auto-detected when left at
    # default (-999 sentinel) — picks -1 on CUDA, 0 otherwise. Override via env.
    EMBED_N_GPU_LAYERS: int = -1 if _CUDA_AVAILABLE else 0
    EMBED_N_THREADS: int = 4 if _CUDA_AVAILABLE else 8
    EMBED_BATCH_SIZE: int = 32

    # --- Voice (faster-whisper / CTranslate2, in-process) ---
    # Auto-detects CUDA at import time. Override via env: VOICE_DEVICE=cuda|cpu.
    VOICE_DEVICE: str = "cuda" if _CUDA_AVAILABLE else "cpu"
    VOICE_COMPUTE_TYPE: str = "float16" if _CUDA_AVAILABLE else "int8"
    VOICE_LANGUAGE: str = "en"           # autodetect fallback handled at call site

    # --- RAG / vector store ---
    DATA_DIR: Path = PROJECT_ROOT / "data"
    RAW_DOCS_DIR: Path = PROJECT_ROOT / "data" / "raw_documents"
    VECTOR_DB_DIR: Path = PROJECT_ROOT / "data" / "vector_db"
    SQLITE_PATH: Path = PROJECT_ROOT / "data" / "sqlite_db" / "coassistant.db"

    COLLECTION_NAME: str = "kpriet_coe"
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 64
    RETRIEVE_K: int = 5
    # Zero-hallucination gate: cosine distance > threshold => reject & fallback.
    # Calibrated for bge-m3: clearly relevant ~0.37-0.39, related ~0.49-0.56,
    # unrelated ~0.64+.
    DISTANCE_THRESHOLD: float = 0.45
    # Debug aid: when True, chat.py prints the raw retrieved chunks to the
    # terminal (see rag/debug.py). Set False / remove once testing is done to
    # reduce server log load.
    DEBUG_PRINT_RETRIEVED: bool = False

    # --- LLM generation limits (security.py enforces) ---
    MAX_TOKENS: int = 512
    TEMPERATURE: float = 0.3
    CONTEXT_TOP_K_RERANK: int = 3

    # --- Auth / JWT ---
    JWT_SECRET: str = "CHANGE-ME-in-production-please-use-a-long-random-string"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24h

    # --- Default seeded admin (created on first startup) ---
    SEED_ADMIN_EMAIL: str = "admin@kpriet.ac.in"
    SEED_ADMIN_PASSWORD: str = "KPR@1234"
    SEED_ADMIN_NAME: str = "COE Administrator"

    # --- File upload limits ---
    MAX_UPLOAD_MB: int = 50
    ALLOWED_MIME_TYPES: list[str] = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "text/markdown",
        "text/html",
        "application/octet-stream",
    ]
    ALLOWED_EXTENSIONS: list[str] = [
        ".pdf",
        ".docx",
        ".doc",
        ".csv",
        ".xlsx",
        ".xls",
        ".txt",
        ".md",
        ".html",
    ]

    # --- Prompt guard ---
    # Tags that must never reach the model (see security.sanitize_prompt)
    BANNED_TOKENS: list[str] = [
        "<|im_start|>",
        "<|im_end|>",
        "<|system|>",
        "<|user|>",
        "<|assistant|>",
        "[INST]",
        "[/INST]",
        "</s>",
        "<<SYS>>",
        "<</SYS>>",
    ]

    @model_validator(mode="after")
    def _enforce_prod_secrets(self) -> "Settings":
        """Fail fast in production if the JWT secret was never changed from its
        shipped default — prevents tokens being signed with a public constant.
        """
        _WEAK_DEFAULTS = (
            "CHANGE-ME-in-production-please-use-a-long-random-string",
            "change-this-to-a-long-random-secret-in-production",
        )
        if self.ENV == "prod" and (
            self.JWT_SECRET in _WEAK_DEFAULTS
            or self.JWT_SECRET.startswith("please-replace")
            or self.JWT_SECRET.startswith("change")
        ):
            raise ValueError(
                "JWT_SECRET must be set to a strong, unique secret in production "
                "(ENV=prod detected with the shipped default)."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance (created once per process)."""
    return Settings()


# Eager singleton importable as `from app.core.config import settings`
settings = get_settings()
