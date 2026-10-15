"""Offline Docling bridge for the Lite StructuredDocument contract."""

from __future__ import annotations

import importlib.metadata
import json
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
    artifacts = os.environ.get("RESEARCHHUB_DOCLING_ARTIFACTS_PATH", "").strip()
    if not artifacts:
        print("document_parser_environment_not_ready: RESEARCHHUB_DOCLING_ARTIFACTS_PATH is required", file=sys.stderr)
        return 1
    artifacts_root = Path(artifacts).expanduser().resolve()
    if not artifacts_root.is_dir():
        print("document_parser_environment_not_ready: configured Docling artifacts directory does not exist", file=sys.stderr)
        return 1
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    try:
        payload = extract_text_first(source)
        if payload is not None:
            print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
            return 0
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        options = PdfPipelineOptions(
            artifacts_path=artifacts_root,
            do_ocr=False,
            do_picture_description=False,
            do_chart_extraction=False,
            generate_page_images=False,
            generate_picture_images=False,
            do_table_structure=True,
        )
        converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
        payload = adapt_document(converter.convert(str(source)).document)
    except Exception as error:  # pragma: no cover - requires a local Docling environment
        print(f"document_parser_failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0


def extract_text_first(source: Path, pdfium: Any = None) -> dict[str, Any] | None:
    """Fast extraction for readable born-digital pages, within the same Docling plugin.

    Mixed/scanned documents fall through to the existing layout pipeline. No text
    is interpreted as reconstructed table cells on this path.
    """
    if os.environ.get("RESEARCHHUB_DOCLING_TEXT_FIRST") != "1" or os.environ.get("RESEARCHHUB_DOCLING_FORCE_LAYOUT") == "1":
        return None
    try:
        if pdfium is None:
            import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(str(source))
        pages: list[str] = []
        try:
            for index in range(len(pdf)):
                page = pdf[index]
                try:
                    text_page = page.get_textpage()
                    try:
                        pages.append(clean_block(text_page.get_text_range()))
                    finally:
                        text_page.close()
                finally:
                    page.close()
        finally:
            pdf.close()
    except Exception:
        return None
    return adapt_text_pages(pages)


def adapt_text_pages(pages: list[str]) -> dict[str, Any] | None:
    if not pages or sum(len(text) >= 80 for text in pages) / len(pages) < 0.8:
        return None
    total = sum(len(text) for text in pages)
    if total < max(200, len(pages) * 200) or sum(text.count("\ufffd") for text in pages) / total > 0.02:
        return None
    sections: list[dict[str, Any]] = []
    blocks: list[dict[str, Any]] = []
    for page, text in enumerate(pages, start=1):
        if not text:
            continue
        section = {"sectionId": f"page-{page:04d}", "title": f"第{page}页", "level": 1, "parentSectionRef": None, "blockRefs": [], "pageStart": page, "pageEnd": page}
        sections.append(section)
        add_block(page, "paragraph", text, page, section, [], blocks)
        blocks[-1]["locator"]["parserItemRef"] = f"pdfium-text-page-{page}"
    return {
        "parser": {"id": "docling-local", "version": importlib.metadata.version("docling")},
        "normalizedText": "\n\n".join(f"[第{block['page']}页]\n{block['text']}" for block in blocks),
        "sections": sections, "blocks": blocks,
        "metadata": {"pageCount": len(pages), "extractionMode": "born_digital_text", "layoutReconstructed": False},
        "stats": {"pageCount": len(pages), "tableCount": 0, "headingCount": 0, "listCount": 0, "captionCount": 0},
        "warnings": ["Born-digital PDF text extracted per page; table cell structure and visual layout are not reconstructed. Scanned or text-poor pages use the Docling layout path."],
    }


def adapt_document(document: Any) -> dict[str, Any]:
    sections: list[dict[str, Any]] = []
    blocks: list[dict[str, Any]] = []
    stack: list[tuple[int, str, str]] = []
    warnings: list[str] = []
    image_count = 0

    def current_section() -> dict[str, Any] | None:
        return sections[-1] if sections else None

    for item_index, (item, level) in enumerate(document.iterate_items(with_groups=False, traverse_pictures=True), start=1):
        label = str(getattr(item, "label", "")).split(".")[-1].lower()
        page = first_page(item)
        if label in {"section_header", "title"}:
            title = clean_text(getattr(item, "text", ""))
            if not title:
                continue
            stack = [entry for entry in stack if entry[0] < level]
            parent = stack[-1][1] if stack else None
            section_id = f"section-{len(sections) + 1:04d}"
            section = {"sectionId": section_id, "title": title, "level": level, "parentSectionRef": parent, "blockRefs": [], "pageStart": page, "pageEnd": page}
            sections.append(section)
            stack.append((level, section_id, title))
            add_block(item_index, "heading", title, page, section, stack, blocks)
            continue
        if label in {"picture", "figure", "image"}:
            image_count += 1
            continue
        section = current_section()
        if section is None:
            section = {"sectionId": "section-0001", "title": None, "level": None, "parentSectionRef": None, "blockRefs": [], "pageStart": page, "pageEnd": page}
            sections.append(section)
        block_type = "table" if label == "table" else "list" if label in {"list", "list_item", "listitem"} else "caption" if label in {"caption", "figcaption"} else "paragraph"
        structured: dict[str, Any] | None = None
        if block_type == "table":
            try:
                text = clean_block(item.export_to_markdown(document))
            except Exception:
                text = clean_block(getattr(item, "text", ""))
                warnings.append("A table could not be exported as Markdown.")
            structured = {"kind": "table", "markdown": text}
        else:
            text = clean_text(getattr(item, "text", ""))
        if text:
            add_block(item_index, block_type, text, page, section, stack, blocks, structured)

    normalized = "\n\n".join(block["text"] for block in blocks).strip()
    page_numbers = [block["page"] for block in blocks if isinstance(block.get("page"), int)]
    page_keys = [int(page) for page in getattr(document, "pages", {}).keys() if str(page).isdigit()]
    page_count = max(page_keys + page_numbers + [0])
    if not normalized:
        warnings.append("Docling returned no extractable text.")
    return {
        "parser": {"id": "docling-local", "version": importlib.metadata.version("docling")},
        "normalizedText": normalized,
        "sections": sections,
        "blocks": blocks,
        "metadata": {"pageCount": page_count or None, "imageCount": image_count},
        "stats": {"pageCount": page_count or None, "tableCount": sum(block["type"] == "table" for block in blocks), "headingCount": sum(block["type"] == "heading" for block in blocks), "listCount": sum(block["type"] == "list" for block in blocks), "captionCount": sum(block["type"] == "caption" for block in blocks)},
        "warnings": warnings,
    }


def add_block(item_index: int, block_type: str, text: str, page: int | None, section: dict[str, Any], stack: list[tuple[int, str, str]], blocks: list[dict[str, Any]], structured: dict[str, Any] | None = None) -> None:
    block_id = f"block-{len(blocks) + 1:06d}"
    block: dict[str, Any] = {"blockId": block_id, "type": block_type, "text": text, "sectionRef": section["sectionId"], "page": page, "locator": {"page": page, "parserItemRef": f"docling-item-{item_index}", "sectionPath": [entry[1] for entry in stack], "sourceOrder": item_index}, "order": len(blocks) + 1}
    if structured is not None:
        block["structuredContent"] = structured
    blocks.append(block)
    section["blockRefs"].append(block_id)
    if page is not None:
        section["pageStart"] = page if section["pageStart"] is None else min(section["pageStart"], page)
        section["pageEnd"] = page if section["pageEnd"] is None else max(section["pageEnd"], page)


def first_page(item: Any) -> int | None:
    for entry in getattr(item, "prov", None) or []:
        page = getattr(entry, "page_no", None)
        if isinstance(page, int):
            return page
    return None


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def clean_block(value: Any) -> str:
    lines = [" ".join(line.split()).strip() for line in str(value or "").splitlines()]
    return "\n".join(line for line in lines if line).strip()


if __name__ == "__main__":
    raise SystemExit(main())
