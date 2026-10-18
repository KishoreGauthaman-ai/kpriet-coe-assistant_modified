"""LangChain document loaders for multi-format ingestion.

Dispatches on file extension and yields `(heading, text)` pairs so the
chunker (`chunker.py`) can keep its existing metadata contract
(`source` / `heading` / `page`) regardless of the source format.

Supported formats (via `langchain-community` document loaders):
  * `.pdf`                    — pdfplumber (text + tables)
  * `.docx`                   — Docx2txtLoader
  * `.doc`                    — UnstructuredWordDocumentLoader (legacy Word)
  * `.csv`                    — CSVLoader
  * `.xlsx` / `.xls`          — UnstructuredExcelLoader
  * `.txt` / `.md`            — TextLoader
  * `.html` / other           — UnstructuredFileLoader fallback

All parsing is fully local: no network calls, no model downloads.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Extension dispatch
# ---------------------------------------------------------------------------
def load_document(path: Path) -> Iterator[tuple[str, str]]:
    """Yield `(heading, text)` pairs for `path` using the right loader.

    Loaders are imported lazily so the module can be imported even before the
    LangChain / parter packages are installed (e.g. during type checks).
    """
    path = Path(path)
    suffix = path.suffix.lower()
    source = path.name

    if suffix == ".pdf":
        yield from _load_pdf(path, source)
    elif suffix == ".docx":
        yield from _load_docx(path, source)
    elif suffix == ".doc":
        yield from _load_word_doc(path, source)
    elif suffix == ".csv":
        yield from _load_csv(path, source)
    elif suffix in (".xlsx", ".xls"):
        yield from _load_excel(path, source)
    elif suffix in (".txt", ".md", ".markdown"):
        yield from _load_text(path, source)
    else:
        yield from _load_unstructured(path, source)


# ---------------------------------------------------------------------------
# Individual loaders
# ---------------------------------------------------------------------------
def _load_pdf(path: Path, source: str) -> Iterator[tuple[str, str]]:
    """Extract PDF text + tables via pdfplumber (fully local).

    Body text and tables are extracted separately so table cells stay in
    row/column order instead of being scrambled into the reading stream.
    Each table is rendered as markdown-style rows (`| cell | cell |`).
    """
    import pdfplumber

    try:
        with pdfplumber.open(str(path)) as pdf:
            for page_no, page in enumerate(pdf.pages, start=1):
                page_text, tables = _split_text_and_tables(page)
                text = (page_text.extract_text() or "").strip()
                if text:
                    yield (f"Page {page_no}", text)
                for idx, table in enumerate(tables, start=1):
                    rendered = _render_table(table.extract())
                    if rendered:
                        yield (f"Page {page_no} — Table {idx}", rendered)
    except Exception as exc:
        logger.warning("pdfplumber failed for %s: %s", source, exc)


def _split_text_and_tables(page):
    """Split a pdfplumber page into (text-only page, detected tables).

    Characters that fall inside a detected table bbox are dropped from the
    text stream so the same cell content is not indexed twice (once in body,
    once in the rendered table).
    """
    tables = page.find_tables()
    if not tables:
        return page, []
    boxes = [t.bbox for t in tables]

    def _outside_tables(obj: dict) -> bool:
        if obj.get("object_type") in ("table", "table-settings"):
            return True
        x0, top = obj.get("x0", 0.0), obj.get("top", 0.0)
        x1, bottom = obj.get("x1", 0.0), obj.get("bottom", 0.0)
        for bx0, btop, bx1, bbottom in boxes:
            if (
                x0 >= bx0 - 1
                and top >= btop - 1
                and x1 <= bx1 + 1
                and bottom <= bbottom + 1
            ):
                return False
        return True

    return page.filter(_outside_tables), tables


def _render_table(rows: list[list | None] | None) -> str | None:
    """Render pdfplumber rows (cells may be None) as markdown table rows."""
    if not rows:
        return None
    cleaned: list[list[str]] = []
    for row in rows:
        cells: list[str] = []
        for c in row or []:
            cell = ((c or "").replace("\n", " ").strip())
            # Collapse runs of empty cells (pdfplumber's wide grid often
            # yields many blank columns between real values).
            if cell or not cells or cells[-1]:
                cells.append(cell)
        if any(cells):
            cleaned.append(cells)
    if not cleaned:
        return None
    header = cleaned[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    for row in cleaned[1:]:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _load_docx(path: Path, source: str) -> Iterator[tuple[str, str]]:
    from langchain_community.document_loaders import Docx2txtLoader

    loader = Docx2txtLoader(str(path))
    doc = loader.load()[0]
    text = (doc.page_content or "").strip()
    if text:
        yield (source, text)


def _load_word_doc(path: Path, source: str) -> Iterator[tuple[str, str]]:
    from langchain_community.document_loaders import UnstructuredWordDocumentLoader

    loader = UnstructuredWordDocumentLoader(str(path), mode="single")
    doc = loader.load()[0]
    text = (doc.page_content or "").strip()
    if text:
        yield (source, text)


def _load_csv(path: Path, source: str) -> Iterator[tuple[str, str]]:
    from langchain_community.document_loaders import CSVLoader

    loader = CSVLoader(str(path))
    for row in loader.load():
        text = (row.page_content or "").strip()
        if text:
            yield (source, text)


def _load_excel(path: Path, source: str) -> Iterator[tuple[str, str]]:
    from langchain_community.document_loaders import UnstructuredExcelLoader

    # `single` mode keeps the whole sheet as one document; the flattened
    # cell text (header + rows) is preserved in a single chunk.
    loader = UnstructuredExcelLoader(str(path), mode="single", do_hi_res=False)
    try:
        docs = loader.load()
    except Exception as exc:  # pragma: no cover
        logger.warning("UnstructuredExcelLoader failed for %s: %s", source, exc)
        return
    for doc in docs:
        text = (doc.page_content or "").strip()
        if text:
            sheet = (doc.metadata or {}).get("sheet", "")
            yield (sheet or source, text)


def _load_text(path: Path, source: str) -> Iterator[tuple[str, str]]:
    from langchain_community.document_loaders import TextLoader

    loader = TextLoader(str(path))
    doc = loader.load()[0]
    text = (doc.page_content or "").strip()
    if text:
        yield (source, text)


def _load_unstructured(path: Path, source: str) -> Iterator[tuple[str, str]]:
    from langchain_community.document_loaders import UnstructuredFileLoader

    loader = UnstructuredFileLoader(str(path), mode="single")
    try:
        docs = loader.load()
    except Exception as exc:  # pragma: no cover
        logger.warning("UnstructuredFileLoader failed for %s: %s", source, exc)
        return
    for doc in docs:
        text = (doc.page_content or "").strip()
        if text:
            yield (source, text)