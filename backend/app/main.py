"""FastAPI application factory for the KPRIET COE Assistant.

Start with:
    uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

This must NOT import embedder/voice models at module level — those are loaded
lazily on first request.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import auth, chat, ingest, voice
from .core.config import settings

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO if settings.ENV == "dev" else logging.WARNING,
    format="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
# pdfminer (used by pdfplumber for PDF parsing) emits benign "Cannot set gray
# non-stroke color" warnings for PDFs with pattern/shading fills. Those are
# false positives — text/table extraction still succeeds. Quiet them to ERROR.
logging.getLogger("pdfminer").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def _lifespan(app: FastAPI):
    from .core.db import get_db
    get_db()
    logger.info("Application started — DB initialised")
    yield
    # Cleanup httpx client if it was created
    try:
        from .api.chat import _httpx_client
        if _httpx_client and not _httpx_client.is_closed:
            await _httpx_client.aclose()
            logger.info("httpx client pool closed")
    except Exception:
        pass
    logger.info("Application shutting down")


# ---------------------------------------------------------------------------
# FastAPI instance
# ---------------------------------------------------------------------------
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=_lifespan,
    docs_url="/docs" if settings.ENV == "dev" else None,
    redoc_url=None,
)

# CORS — restrict to explicit allowed origins; no wildcard with credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# ---------------------------------------------------------------------------
# Router registration
# ---------------------------------------------------------------------------
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(ingest.router)
app.include_router(voice.router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"app": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.ENV == "dev",
    )