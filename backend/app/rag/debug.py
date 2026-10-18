"""Debug helper: print retrieved RAG chunks to the terminal.

This prints the **retrieved** context (the raw chunks pulled from the vector
store) — NOT the LLM-generated answer — so a developer can eyeball how well
retrieval is working by query.

NOTE: This is a testing aid only. It is intentionally isolated in its own
module behind a single function call from `chat.py`, gated by the
`DEBUG_PRINT_RETRIEVED` setting. To disable/remove later, delete this file,
delete the call in `chat.py`, and flip the flag — nothing else depends on it.
"""
from __future__ import annotations

import logging
from typing import Any, Sequence

logger = logging.getLogger(__name__)


def print_retrieved_chunks(query: str, hits: Sequence[dict[str, Any]]) -> None:
    """Print each retrieved chunk's full text to the terminal.

    Args:
        query: The sanitized user query that triggered retrieval.
        hits: The `hits` list returned by `store.query()` — each item holds
              `text`, `source`, `heading`, `page` and `distance`.

    Does not mutate anything; terminal output only.
    """
    banner = "=" * 78
    print(banner)
    print(f"RETRIEVED CHUNKS (query: {query[:120]!r})")
    print(banner)
    if not hits:
        print("  (no chunks retrieved)")
        print(banner)
        return

    for i, hit in enumerate(hits, start=1):
        text = str(hit.get("text", "")).strip()
        print(f"[{i}] source={hit.get('source', '?')} "
              f"heading={hit.get('heading', '?')} "
              f"page={hit.get('page', 0)} "
              f"distance={hit.get('distance', '?')}")
        print("-" * 64)
        print(text if text else "  (empty)")
        print()
    print(banner)