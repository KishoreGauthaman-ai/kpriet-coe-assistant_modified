"""Voice-to-text transcription endpoint — faster-whisper CTranslate2 pipeline.

Loads local CTranslate2 model from `models/faster-whisper-small` (downloaded once,
zero external requests at runtime). The model is initialised lazily on first
request and kept as a singleton for the lifetime of the process.

The actual transcription runs in a thread pool so the FastAPI event loop
stays responsive for other concurrent requests.
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..core.config import settings
from ..core.security import require_active

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class TranscribeResponse(BaseModel):
    text: str
    language: str = "en"


# ---------------------------------------------------------------------------
# Thread-safe singleton Whisper model (faster-whisper with local CTranslate2 model)
# ---------------------------------------------------------------------------
_WHISPER_MODEL = None
_WLOCK = threading.Lock()


def _get_whisper_model():
    """Lazy-load faster-whisper model on first request. Thread-safe."""
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        with _WLOCK:
            if _WHISPER_MODEL is None:
                from faster_whisper import WhisperModel

                model_path = str(settings.VOICE_MODEL_PATH)
                logger.info(
                    "Loading Whisper model from: %s (device=%s, compute=%s)",
                    model_path, settings.VOICE_DEVICE, settings.VOICE_COMPUTE_TYPE,
                )
                _WHISPER_MODEL = WhisperModel(
                    model_size_or_path=model_path,
                    device=settings.VOICE_DEVICE,
                    compute_type=settings.VOICE_COMPUTE_TYPE,
                )
                logger.info("Whisper model ready (device=%s)", settings.VOICE_DEVICE)
    return _WHISPER_MODEL


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_voice(
    file: UploadFile = File(...),
    user: dict = Depends(require_active),
) -> TranscribeResponse:
    """Accept an audio blob and return transcribed text.

    CPU-bound transcription is offloaded to a thread pool.
    """
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(
            status_code=415,
            detail="Upload must be an audio file (audio/wav, audio/webm, etc.)",
        )

    audio_bytes = await file.read()
    await file.close()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Received empty audio file")

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    tmp_path = None
    try:
        model = _get_whisper_model()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
            tf.write(audio_bytes)
            tmp_path = tf.name

        # Run CPU-bound transcription in a thread pool
        loop = asyncio.get_running_loop()

        def _transcribe():
            segments, info = model.transcribe(
                tmp_path,
                language=settings.VOICE_LANGUAGE or None,
                beam_size=3,
                vad_filter=True,
            )
            parts = [seg.text.strip() for seg in segments]
            text = " ".join(parts).strip()
            return text, info

        text, info = await loop.run_in_executor(None, _transcribe)

        logger.info(
            "Transcribed | user=%s | duration=%.1fs | lang=%s | chars=%d",
            user.get("sub", "?"), info.duration, info.language, len(text),
        )
        return TranscribeResponse(
            text=text,
            language=info.language or settings.VOICE_LANGUAGE,
        )
    except Exception as exc:
        logger.exception("Whisper transcription failed")
        raise HTTPException(
            status_code=500,
            detail=f"Transcription error: {exc}",
        ) from exc
    finally:
        if tmp_path is not None:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except OSError:
                pass