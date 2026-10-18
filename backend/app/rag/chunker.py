"""Semantic chunking for multiple document formats.

Strategy:
  1. Load text via LangChain document loaders (`loaders.py`) which support
     PDF, DOCX, legacy DOC, CSV, Excel, TXT/MD and HTML.
  2. Split the document into sections whenever a heading cue is encountered.
  3. If a section is longer than `CHUNK_SIZE` characters, slide a window of
     that size with `CHUNK_OVERLAP` characters of overlap.
  4. Emit chunks as dicts: `{id, text, metadata:{source, heading, page, ...}}`.

The chunker performs **no network calls**; all parsing is local.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from ..core.config import settings
from .loaders import load_document

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class Chunk:
    id: str
    text: str
    metadata: dict = field(default_factory=dict)


_HEADING_RE = re.compile(r"^(?:\s*)(#{1,6})\s+(.+)$")  # markdown-style fallback
_SENTENCE_END = re.compile(r"(?<=[.!?।])\s+")  # supports Devanagari danda too


# ---------------------------------------------------------------------------
# Windowing
# ---------------------------------------------------------------------------
def _window(text: str, size: int, overlap: int) -> list[str]:
    """Sliding-window split preserving whole sentences when possible."""
    text = text.strip()
    if len(text) <= size:
        return [text] if text else []

    sentences = _SENTENCE_END.split(text)
    windows: list[str] = []
    buf: list[str] = []
    buf_len = 0

    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue
        # Sentence itself bigger than window → hard split
        if len(sent) > size:
            if buf:
                windows.append(" ".join(buf))
                buf, buf_len = [], 0
            for i in range(0, len(sent), size - overlap):
                windows.append(sent[i : i + size])
            continue
        if buf and buf_len + len(sent) + 1 > size:
            windows.append(" ".join(buf))
            # keep overlap as the last few sentences
            kept: list[str] = []
            kept_len = 0
            for s in reversed(buf):
                if kept_len + len(s) > overlap:
                    break
                kept.insert(0, s)
                kept_len += len(s) + 1
            buf, buf_len = kept, kept_len
        buf.append(sent)
        buf_len += len(sent) + 1

    if buf:
        windows.append(" ".join(buf))
    return [w for w in windows if w.strip()]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def chunk_document(path: Path, *, source_name: str | None = None) -> list[Chunk]:
    """Read `path` via its LangChain loader and return semantic chunks.

    Supports: PDF, DOCX, DOC, CSV, XLSX/XLS, TXT/MD, HTML.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)

    source = source_name or path.name
    size = settings.CHUNK_SIZE
    overlap = settings.CHUNK_OVERLAP

    # Group consecutive paragraphs under the same heading before windowing,
    # so we don't fragment tiny paragraphs unnecessarily.
    sections: list[tuple[str, list[str]]] = []
    cur_head: str | None = None
    cur_buf: list[str] = []
    for heading, text in load_document(path):
        if heading != cur_head:
            if cur_buf:
                sections.append((cur_head or source, cur_buf))
            cur_head, cur_buf = heading, []
        cur_buf.append(text)
    if cur_buf:
        sections.append((cur_head or source, cur_buf))

    if not sections:
        return []

    chunks: list[Chunk] = []
    page = 1
    for heading, paras in sections:
        body = " ".join(paras).strip()
        if not body:
            continue
        for win in _window(body, size, overlap):
            chunks.append(
                Chunk(
                    id=f"{source}_{heading[:32]}_{page}".replace(" ", "_"),
                    text=win,
                    metadata={
                        "source": source,
                        "heading": heading,
                        "page": page,
                    },
                )
            )
            page += 1

    logger.info("Chunked %s → %d chunks", source, len(chunks))
    return chunks
