import json
import os

print(json.dumps({
    "parser": {"id": "docling-local", "version": "fixture"},
    "normalizedText": "AI Hardware\n\nGPU market table\n\nFigure caption",
    "sections": [{
        "sectionId": "section-0001",
        "title": "AI Hardware",
        "level": 1,
        "parentSectionRef": None,
        "blockRefs": ["block-000001", "block-000002", "block-000003"],
        "pageStart": 1,
        "pageEnd": 2,
    }],
    "blocks": [
        {"blockId": "block-000001", "type": "heading", "text": "AI Hardware", "sectionRef": "section-0001", "page": 1, "locator": {"page": 1, "parserItemRef": "item-1", "sectionPath": ["section-0001"], "sourceOrder": 1}, "order": 1},
        {"blockId": "block-000002", "type": "table", "text": "| Product | Market |\n| --- | --- |\n| GPU | AI |", "sectionRef": "section-0001", "page": 2, "locator": {"page": 2, "parserItemRef": "item-2", "sectionPath": ["section-0001"], "sourceOrder": 2}, "order": 2, "structuredContent": {"kind": "table", "markdown": "| Product | Market |\n| --- | --- |\n| GPU | AI |"}},
        {"blockId": "block-000003", "type": "caption", "text": "Figure caption", "sectionRef": "section-0001", "page": 2, "locator": {"page": 2, "parserItemRef": "item-3", "sectionPath": ["section-0001"], "sourceOrder": 3}, "order": 3},
    ],
    "metadata": {"pageCount": 2, "imageCount": 1, "textFirst": os.environ.get("RESEARCHHUB_DOCLING_TEXT_FIRST")},
    "stats": {"pageCount": 2, "tableCount": 1, "headingCount": 1, "listCount": 0, "captionCount": 1},
    "warnings": [],
}))
