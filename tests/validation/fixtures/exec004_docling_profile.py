"""Diagnostic-only stage profiler for the repository's configured Docling pipeline."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


def main() -> int:
    source = Path(sys.argv[1]).resolve()
    artifacts = Path(sys.argv[2]).resolve()
    bridge_path = Path(sys.argv[3]).resolve()
    progress_path = Path(sys.argv[4]).resolve()
    result: dict[str, object] = {"status": "FAILED", "stage": "IMPORT", "parserId": "docling-local"}
    started = time.perf_counter()
    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        imported = time.perf_counter()
        result = {"status": "RUNNING", "stage": "MODEL_INITIALIZATION", "importMs": round((imported - started) * 1000)}
        progress_path.write_text(json.dumps(result), encoding="utf-8")
        options = PdfPipelineOptions(
            artifacts_path=artifacts,
            do_ocr=False,
            do_picture_description=False,
            do_chart_extraction=False,
            generate_page_images=False,
            generate_picture_images=False,
            do_table_structure=True,
        )
        converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
        initialized = time.perf_counter()
        result = {"status": "RUNNING", "stage": "CONVERSION", "importMs": round((imported - started) * 1000), "parserStartupMs": round((initialized - imported) * 1000)}
        progress_path.write_text(json.dumps(result), encoding="utf-8")
        document = converter.convert(str(source)).document
        converted = time.perf_counter()
        result = {"status": "RUNNING", "stage": "NORMALIZATION", "importMs": round((imported - started) * 1000), "parserStartupMs": round((initialized - imported) * 1000), "conversionMs": round((converted - initialized) * 1000)}
        progress_path.write_text(json.dumps(result), encoding="utf-8")
        sys.path.insert(0, str(bridge_path.parent))
        from docling_bridge import adapt_document

        payload = adapt_document(document)
        normalized = time.perf_counter()
        blocks = payload.get("blocks", [])
        page_numbers = sorted({block.get("page") for block in blocks if isinstance(block.get("page"), int)})
        stats = payload.get("stats", {})
        result = {
            "status": "COMPLETED",
            "stage": "DONE",
            "parserId": payload.get("parser", {}).get("id"),
            "parserVersion": payload.get("parser", {}).get("version"),
            "importMs": round((imported - started) * 1000),
            "parserStartupMs": round((initialized - imported) * 1000),
            "conversionMs": round((converted - initialized) * 1000),
            "normalizationMs": round((normalized - converted) * 1000),
            "totalMs": round((normalized - started) * 1000),
            "pageCount": stats.get("pageCount"),
            "extractedCharacterCount": len(payload.get("normalizedText", "")),
            "tableCount": stats.get("tableCount", 0),
            "sectionCount": len(payload.get("sections", [])),
            "blockCount": len(blocks),
            "locatedPageCount": len(page_numbers),
            "firstLocatedPage": page_numbers[0] if page_numbers else None,
            "lastLocatedPage": page_numbers[-1] if page_numbers else None,
            "warnings": payload.get("warnings", []),
            "ocrEnabled": False,
            "tableStructureEnabled": True,
        }
        progress_path.write_text(json.dumps(result), encoding="utf-8")
    except Exception as error:
        result["errorCategory"] = type(error).__name__
        result["errorMessage"] = str(error)[:300]
        result["totalMs"] = round((time.perf_counter() - started) * 1000)
        progress_path.write_text(json.dumps(result), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0 if result.get("status") == "COMPLETED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
