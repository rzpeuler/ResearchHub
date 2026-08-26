"""Local Docling adapter used by the ResearchHub document plugin.

The bridge writes one JSON parse result to stdout and never writes document
text to logs. It is intentionally a short-lived process, not a service.
"""

from __future__ import annotations

import json
import importlib.metadata
import os
import sys
from pathlib import Path
from typing import Any

def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        print("usage: docling_bridge.py <local-document-path>", file=sys.stderr)
        return 2

    source = Path(sys.argv[1]).resolve()
    if not source.is_file():
        print("document_parser_failed: source document does not exist", file=sys.stderr)
        return 2

    artifacts_path = os.environ.get("RESEARCHHUB_DOCLING_ARTIFACTS_PATH", "").strip()
    if not artifacts_path:
        print("document_parser_environment_not_ready: RESEARCHHUB_DOCLING_ARTIFACTS_PATH is required", file=sys.stderr)
        return 1
    artifacts_root = Path(artifacts_path).expanduser().resolve()
    if not artifacts_root.is_dir():
        print("document_parser_environment_not_ready: configured Docling artifacts directory does not exist", file=sys.stderr)
        return 1
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        pipeline_options = PdfPipelineOptions(
            artifacts_path=artifacts_root,
            do_ocr=False,
            do_picture_description=False,
            do_chart_extraction=False,
            generate_page_images=False,
            generate_picture_images=False,
            do_table_structure=True,
        )
        converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)})
        result = converter.convert(str(source))
        payload = adapt_document(result.document)
    except Exception as error:  # pragma: no cover - exercised by local runtime failures
        print(f"document_parser_failed: {error}", file=sys.stderr)
        return 1

    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0


def adapt_document(document: Any) -> dict[str, Any]:
    chunks: list[dict[str, Any]] = []
    headings = 0
    tables = 0
    images = 0
    section_stack: list[tuple[int, str]] = []
    warnings: list[str] = []

    for item_index, (item, level) in enumerate(document.iterate_items(with_groups=False, traverse_pictures=True), start=1):
        label = str(getattr(item, "label", "")).split(".")[-1].lower()
        page = first_page(item)
        if label in {"section_header", "title"}:
            headings += 1
            text = clean_text(getattr(item, "text", ""))
            if text:
                section_stack = [entry for entry in section_stack if entry[0] < level]
                section_stack.append((level, text))
                chunks.append(make_chunk(item_index, text, page, section_stack))
            continue
        if label == "table":
            tables += 1
            try:
                text = clean_block(item.export_to_markdown(document))
            except Exception:
                text = clean_block(getattr(item, "text", ""))
                warnings.append("A table could not be exported as Markdown.")
            if text:
                chunks.append(make_chunk(item_index, text, page, section_stack))
            continue
        if label in {"picture", "figure"}:
            images += 1
            continue
        text = clean_text(getattr(item, "text", ""))
        if text:
            chunks.append(make_chunk(item_index, text, page, section_stack))

    normalized_text = "\n\n".join(chunk["text"] for chunk in chunks).strip()
    page_numbers = [chunk["page"] for chunk in chunks if isinstance(chunk.get("page"), int)]
    page_count = max([int(page) for page in document.pages.keys()] + page_numbers + [0])
    empty_page_count = max(0, page_count - len({page for page in page_numbers})) if page_count else None
    if not normalized_text:
        warnings.append("Docling returned no extractable text.")

    return {
        "parser": {"id": "docling-local", "version": importlib.metadata.version("docling")},
        "pageCount": page_count or None,
        "normalizedText": normalized_text,
        "chunks": chunks,
        "structure": {"headingCount": headings, "tableCount": tables, "imageCount": images},
        "quality": {
            "parserId": "docling-local",
            "pageCount": page_count or None,
            "chunkCount": len(chunks),
            "normalizedCharacters": len(normalized_text),
            "emptyPageCount": empty_page_count,
            "tableCount": tables,
            "headingCount": headings,
            "imageCount": images,
            "warnings": warnings,
        },
    }


def first_page(item: Any) -> int | None:
    provenance = getattr(item, "prov", None) or []
    for entry in provenance:
        page_no = getattr(entry, "page_no", None)
        if isinstance(page_no, int):
            return page_no
    return None


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def clean_block(value: Any) -> str:
    lines = [" ".join(line.split()).strip() for line in str(value or "").splitlines()]
    return "\n".join(line for line in lines if line).strip()


def make_chunk(item_index: int, text: str, page: int | None, section_stack: list[tuple[int, str]]) -> dict[str, Any]:
    return {
        "chunkId": f"docling-{item_index:04d}",
        "text": text,
        "page": page,
        "section": " / ".join(entry[1] for entry in section_stack) or None,
        "locator": f"page:{page}" if page is not None else f"document:item:{item_index}",
    }


if __name__ == "__main__":
    raise SystemExit(main())
