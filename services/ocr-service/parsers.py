"""Compatibility adapter for callers with text-only input.

Production always uses positioned text boxes via extraction.extract_document.
Do not add a separate set of whole-page regex field extraction rules here.
"""
from layout import TextBox
from extraction import extract_document
from validators import is_valid_id_number


def extract_fields(doc_type: str, lines: list[str]) -> dict:
    boxes = [TextBox(text, 0, i * 30, max(100, len(text) * 10), i * 30 + 20)
             for i, text in enumerate(lines) if text and text.strip()]
    return extract_document(doc_type, boxes).fields
