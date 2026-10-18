"""Chat endpoints — Knowledge (RAG) vs Reasoning routing, streamed via SSE.

Routing logic (matches the spec's ReasoningToggle):
  • `reasoning = false` (Knowledge Mode):
      1. Embed the (sanitized) query with the in-process bge-m3 embedder
         (offloaded to a thread pool to keep the event loop free).
      2. Query ChromaDB for k nearest neighbours (cosine distance).
      3. If best distance > DISTANCE_THRESHOLD → emit the zero-hallucination
         fallback message instead of calling the LLM. No fabrication.
      4. Otherwise build a context block from the top hits and stream the
         base model's response (llama-server :8080) over SSE.
  • `reasoning = true` (Reasoning Mode):
      Skip RAG entirely. Stream the reasoning-model response from
      llama-server :8081 with the reasoning system prompt.

Both ports speak llama.cpp's OpenAI-compatible `/v1/chat/completions` endpoint
(stream=true), so we proxy chunks through as SSE `data:` frames.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..core.config import settings
from ..core.security import require_active, sanitize_prompt
from ..rag.debug import print_retrieved_chunks
from ..rag.embedder import get_embedder
from ..rag.store import get_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["chat"])

# ---------------------------------------------------------------------------
# Shared httpx client pool (B2 — socket exhaustion fix)
# ---------------------------------------------------------------------------
_httpx_client: httpx.AsyncClient | None = None
_httpx_lock = __import__("threading").Lock()

def _get_http_client() -> httpx.AsyncClient:
    global _httpx_client
    if _httpx_client is None or _httpx_client.is_closed:
        with _httpx_lock:
            if _httpx_client is None or _httpx_client.is_closed:
                timeout = httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0)
                limits = httpx.Limits(max_keepalive_connections=10, max_connections=20)
                _httpx_client = httpx.AsyncClient(timeout=timeout, limits=limits)
    return _httpx_client


# ---------------------------------------------------------------------------
# System prompts (from Innovation_final_prompt.md)
# ---------------------------------------------------------------------------
SYSTEM_PROMPT_BASE = """[SYSTEM INSTRUCTION: KPRIET COE KNOWLEDGE ASSISTANT]

IDENTITY:
You are the official institutional AI Assistant for the Centre of Excellence (COE) at KPRIET.

OPERATIONAL RULES:
1. KNOWLEDGE MODE (Reasoning = OFF):
   - Answer strictly using the provided context snippets.
   - If context is empty, state exactly: "I couldn't find verified information in the COE knowledge base."
   - Never invent dates, schedules, faculty, or policies.

2. REASONING MODE (Reasoning = ON):
   - Provide structured, step-by-step career mentoring and skill guidance.
   - Never invent institutional facts or official notices.

3. MULTILINGUAL MIRRORING:
   - Detect the language/script of the user (English, Tamil, Telugu, Hindi, Tanglish).
   - Answer in the EXACT matching language and dialect style used by the user.

4. SCOPE CONSTRAINTS:
   - Reject complex out-of-domain coding tasks. Restrict code to basic COE IoT/Embedded lab snippets.
"""

SYSTEM_PROMPT_REASONING = """[SYSTEM INSTRUCTION: KPRIET COE KNOWLEDGE ASSISTANT]

IDENTITY:
You are the official AI Assistant for the Centre of Excellence (COE) at KPRIET.

OPERATIONAL RULES (REASONING MODE):
1. Provide structured, step-by-step career mentoring and skill guidance.
   Break problems into clear stages: understand → plan → execute → reflect.
2. Never invent institutional facts or official notices. If asked for official
   notices, schedules, faculty lists, redirect the user to KNOWLEDGE MODE.

3. MULTILINGUAL MIRRORING:
   - Detect the language/script of the user (English, Tamil, Telugu, Hindi, Tanglish).
   - Answer in the EXACT matching language and dialect style used by the user.

4. SCOPE CONSTRAINTS:
   - Reject complex out-of-domain coding tasks. Restrict code to basic COE IoT/Embedded lab snippets.
"""

FALLBACK_MESSAGE = "I couldn't find verified information in the COE knowledge base."


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    reasoning: bool = False
    history: list[dict] = Field(default_factory=list)  # [{role, content}, ...]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _build_context_block(hits: list[dict]) -> str:
    """Render retrieved chunks as a fenced context block for the LLM."""
    if not hits:
        return ""
    parts: list[str] = []
    for i, h in enumerate(hits, start=1):
        parts.append(
            f"[{i}] (source: {h.get('source','')} › {h.get('heading','')})\n{h['text']}"
        )
    return "\n\n".join(parts)


async def _stream_llama_server(
    *,
    server_url: str,
    system_prompt: str,
    user_prompt: str,
    history: list[dict],
) -> AsyncIterator[str]:
    """Stream tokens from a llama.cpp OpenAI-compatible endpoint.

    Yields plain-string SSE `data:` frames (no `event:` prefix — the
    client-side SSE parser in api.js reads `data:` lines directly).

    Error frames are prefixed with `[ERROR] ` so the frontend can detect them.
    """
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for m in history[-8:]:
        role = m.get("role", "user")
        content = sanitize_prompt(m.get("content", ""))
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_prompt})

    payload = {
        "messages": messages,
        "temperature": settings.TEMPERATURE,
        "max_tokens": settings.MAX_TOKENS,
        "stream": True,
    }

    url = f"{server_url.rstrip('/')}/v1/chat/completions"
    client = _get_http_client()
    try:
        async with client.stream("POST", url, json=payload) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                yield f"[ERROR] LLM server returned {resp.status_code}"
                logger.error("LLM server %s error %s: %s", url, resp.status_code,
                             body.decode("utf-8", "ignore")[:400])
                return

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:"):].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                tok = delta.get("content")
                if tok:
                    yield tok
                if choices[0].get("finish_reason") == "stop":
                    break
    except httpx.ConnectError as exc:
        logger.error("Cannot reach llama-server at %s: %s", url, exc)
        yield (
            "[ERROR] Cannot reach LLM server. Ensure llama-server is running "
            "on the configured port (see backend/run.sh or docker-compose)."
        )
    except Exception as exc:
        logger.exception("Unexpected streaming error from %s", url)
        yield f"[ERROR] Streaming error: {exc}"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@router.post("/chat")
async def chat(
    req: ChatRequest,
    user: dict = Depends(require_active),
) -> EventSourceResponse:
    """Stream a chat completion. Routed by ReasoningToggle state."""

    t0 = time.time()
    actor = f"{user.get('sub','?')}/{user.get('role','?')}"
    logger.info(
        "chat request | user=%s | reasoning=%s | msglen=%d",
        actor, req.reasoning, len(req.message),
    )

    clean_msg = sanitize_prompt(req.message)
    if not clean_msg:
        async def _empty():
            yield _sse_frame("token", FALLBACK_MESSAGE)
            yield _sse_frame("done", "")
            yield _done_event()
        return EventSourceResponse(_empty())

    # ------------------------------------------------------------------
    # REASONING MODE → bypass RAG, stream from :8081
    # ------------------------------------------------------------------
    if req.reasoning:
        async def reasoning_stream():
            async for tok in _stream_llama_server(
                server_url=settings.REASONING_SERVER_URL,
                system_prompt=SYSTEM_PROMPT_REASONING,
                user_prompt=clean_msg,
                history=req.history,
            ):
                if tok.startswith("[ERROR]"):
                    yield _sse_frame("error", tok)
                else:
                    yield _sse_frame("token", tok)
            yield _sse_frame("meta", json.dumps({"mode": "reasoning"}))
            yield _sse_frame("done", "")
            logger.info("chat done | user=%s | mode=reasoning | time=%.2fs", actor, time.time() - t0)
        return EventSourceResponse(reasoning_stream())

    # ------------------------------------------------------------------
    # KNOWLEDGE MODE — RAG retrieval + zero-hallucination gate
    # ------------------------------------------------------------------
    embedder = get_embedder()
    store = get_store()
    try:
        # B3: Run CPU-bound embedding in a thread pool to keep event loop free
        lag = asyncio.get_running_loop()
        q_vec = await lag.run_in_executor(None, embedder.embed, clean_msg)
    except Exception as exc:
        logger.exception("Embedding failed: %s", exc)
        async def _embed_fallback():
            yield _sse_frame("meta", json.dumps({"mode": "knowledge", "blocked": True, "error": str(exc)}))
            async for chunk in _word_stream(FALLBACK_MESSAGE):
                yield _sse_frame("token", chunk)
            yield _sse_frame("done", "")
        return EventSourceResponse(_embed_fallback())

    retrieval = store.query(q_vec, k=settings.RETRIEVE_K)
    blocked = bool(retrieval.get("blocked"))
    hits = retrieval.get("hits", [])

    # Debug aid (testing only): print the raw retrieved chunks to the terminal.
    # Flag lives in config; the isolated helper lives in rag/debug.py so this
    # can be trivially removed later to cut server log load.
    if settings.DEBUG_PRINT_RETRIEVED:
        try:
            print_retrieved_chunks(clean_msg, hits)
        except Exception as exc:  # pragma: no cover — never break chat
            logger.warning("print_retrieved_chunks failed: %s", exc)

    async def knowledge_stream():
        yield _sse_frame("meta", json.dumps({
            "mode": "knowledge",
            "blocked": blocked,
            "best_distance": retrieval.get("best_distance"),
            "threshold": retrieval.get("threshold"),
            "sources": [{"source": h.get("source"), "heading": h.get("heading")} for h in hits],
        }))

        if blocked or not hits:
            async for chunk in _word_stream(FALLBACK_MESSAGE):
                yield _sse_frame("token", chunk)
            yield _sse_frame("done", "")
            logger.info("chat done | user=%s | mode=knowledge | result=%s | time=%.2fs",
                        actor, "blocked" if blocked else "empty", time.time() - t0)
            return

        context = _build_context_block(hits)
        user_prompt = (
            "Use ONLY the following verified context snippets to answer. "
            "If the snippets do not contain the answer, reply exactly: "
            f'"{FALLBACK_MESSAGE}". Do not invent facts.\n\n'
            f"CONTEXT:\n{context}\n\nUSER QUESTION:\n{clean_msg}"
        )
        async for tok in _stream_llama_server(
            server_url=settings.BASE_SERVER_URL,
            system_prompt=SYSTEM_PROMPT_BASE,
            user_prompt=user_prompt,
            history=req.history,
        ):
            if tok.startswith("[ERROR]"):
                yield _sse_frame("error", tok)
            else:
                yield _sse_frame("token", tok)
        yield _sse_frame("done", "")
        logger.info("chat done | user=%s | mode=knowledge | sources=%d | time=%.2fs",
                    actor, len(hits), time.time() - t0)

    return EventSourceResponse(knowledge_stream())


# ---------------------------------------------------------------------------
# SSE frame helper — always emits a clean `data:` line
# The `tag` param controls the first content character.
# Frontend api.js reads lines that start with `data:` and parses JSON.
# We prefix meta/error with a tag inside the JSON so the frontend routes correctly.
# ---------------------------------------------------------------------------
def _sse_frame(tag: str, payload: str = "") -> dict[str, str]:
    """Build a single SSE event dict for EventSourceResponse.

    For `tag==="token"`, payload is raw text (no JSON wrapping).
    For `tag==="done"`, data is an empty string.
    For anything else (meta, error), payload is a pre-serialized JSON string.
    """
    if tag == "done":
        return {"event": "done", "data": ""}
    return {"event": tag, "data": payload}


def _done_event() -> dict[str, str]:
    return {"event": "done", "data": ""}


# ---------------------------------------------------------------------------
# Word-by-word fallback emitter (B1 fix — proper async iteration)
# ---------------------------------------------------------------------------
async def _word_stream(text: str, *, chunk: int = 4) -> AsyncIterator[str]:
    for i in range(0, len(text), chunk):
        yield text[i : i + chunk]
        await asyncio.sleep(0.015)