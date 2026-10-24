"""Bounded text-layer extraction for PDFs that already contain searchable text."""

from __future__ import annotations

import importlib.metadata
import json
import sys
import unicodedata
from pathlib import Path
from typing import Any


MINIMUM_CHARACTER_COUNT = 1_500
MINIMUM_TEXT_PAGE_COVERAGE = 0.75
MAXIMUM_PAGE_COUNT = 2_000


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        print(json.dumps({"status": "INVALID_INPUT", "reason": "PDF path is required"}))
        return 2
    source = Path(sys.argv[1]).resolve()
    try:
        from pypdf import PdfReader

        with source.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                print(json.dumps({"status": "INVALID_INPUT", "reason": "PDF header is invalid"}))
                return 0
        reader = PdfReader(str(source), strict=False)
        if reader.is_encrypted:
            print(json.dumps({"status": "INSUFFICIENT", "reason": "Encrypted PDFs are not eligible for text-only extraction"}))
            return 0
        page_count = len(reader.pages)
        if page_count < 1 or page_count > MAXIMUM_PAGE_COUNT:
            print(json.dumps({"status": "INSUFFICIENT", "reason": "PDF page count is outside the bounded text-parser range", "pageCount": page_count}))
            return 0

        sections: list[dict[str, Any]] = []
        blocks: list[dict[str, Any]] = []
        page_texts: list[str] = []
        for page_number, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text(extraction_mode="layout") or ""
            except (TypeError, ValueError):
                text = page.extract_text() or ""
            text = unicodedata.normalize("NFKC", text).replace("\x00", "").strip()
            page_texts.append(text)
            if not text:
                continue
            section_id = f"section-page-{page_number:04d}"
            block_id = f"block-page-{page_number:04d}"
            sections.append({"sectionId": section_id, "title": None, "level": None, "parentSectionRef": None, "blockRefs": [block_id], "pageStart": page_number, "pageEnd": page_number})
            blocks.append({"blockId": block_id, "type": "paragraph", "text": text, "sectionRef": section_id, "page": page_number, "locator": {"page": page_number, "parserItemRef": f"pypdf-page-{page_number:04d}", "sectionPath": [section_id], "sourceOrder": page_number}, "order": len(blocks) + 1})

        total_characters = sum(len(text) for text in page_texts)
        nonempty_pages = sum(bool(text) for text in page_texts)
        page_coverage = nonempty_pages / page_count
        if total_characters < MINIMUM_CHARACTER_COUNT or page_coverage < MINIMUM_TEXT_PAGE_COVERAGE:
            print(json.dumps({"status": "INSUFFICIENT", "reason": "PDF text layer does not meet minimum character/page coverage", "pageCount": page_count, "extractedCharacterCount": total_characters, "nonEmptyPageCount": nonempty_pages, "textBearingPageCoverage": round(page_coverage, 4)}, ensure_ascii=False))
            return 0

        normalized_text = "\n\n".join(block["text"] for block in blocks).strip()
        payload = {
            "status": "USABLE",
            "document": {
                "documentId": f"document-pypdf-{source.stat().st_size:x}-{page_count:x}",
                "parser": {"id": "pypdf-text-only", "version": importlib.metadata.version("pypdf")},
                "metadata": {"originalFilename": source.name, "mediaType": "application/pdf", "pageCount": page_count, "parserMetadata": {"extractionMode": "layout", "textBearingPageCoverage": round(page_coverage, 4), "tableStructure": "TEXT_ONLY"}},
                "normalizedText": normalized_text,
                "sections": sections,
                "blocks": blocks,
                "stats": {"pageCount": page_count, "sectionCount": len(sections), "blockCount": len(blocks), "normalizedCharacters": len(normalized_text), "tableCount": 0, "headingCount": 0, "listCount": 0, "captionCount": 0},
                "warnings": ["Text-only extraction preserves page locators but does not reconstruct complex table cells."],
            },
        }
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception as error:
        status = "INVALID_INPUT" if type(error).__name__ in {"PdfReadError", "EmptyFileError"} else "ERROR"
        print(json.dumps({"status": status, "reason": type(error).__name__, "message": str(error)[:240]}, ensure_ascii=False))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
