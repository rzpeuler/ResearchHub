import json
import os
import sys

print(json.dumps({
    "parser": {"id": "docling-local", "version": "fixture"},
    "pageCount": 2,
    "normalizedText": "AI Hardware\n\nGPU table",
    "chunks": [
        {"chunkId": "docling-0001", "text": "AI Hardware", "page": 1, "section": None, "locator": "page:1"},
        {"chunkId": "docling-0002", "text": "| Product | Market |\n| --- | --- |\n| GPU | AI |", "page": 2, "section": "AI Hardware", "locator": "page:2"},
    ],
    "structure": {"headingCount": 1, "tableCount": 1, "imageCount": 0},
    "quality": {"parserId": "docling-local", "pageCount": 2, "chunkCount": 2, "normalizedCharacters": 23, "emptyPageCount": 0, "tableCount": 1, "headingCount": 1, "imageCount": 0, "warnings": [os.environ.get("RESEARCHHUB_DOCLING_ARTIFACTS_PATH", "")]},
}))
