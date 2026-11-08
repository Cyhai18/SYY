"""Shared OCR evidence types, independent of recognition and field schemas."""
from __future__ import annotations
from dataclasses import dataclass, field

FIELDS = ('name', 'address', 'legal_person', 'credit_code', 'id_number')
@dataclass(frozen=True)
class TextBox:
    text: str
    left: float
    top: float
    right: float
    bottom: float
    confidence: float = 1.0

    @property
    def cy(self):
        return (self.top + self.bottom) / 2

    @property
    def height(self):
        return max(1.0, self.bottom - self.top)


@dataclass
class FieldEvidence:
    value: str = ''
    score: float = 0.0  # heuristic evidence score, NOT a calibrated probability
    boxes: list[TextBox] = field(default_factory=list)
    reason: str = 'label_not_found'


@dataclass
class Extraction:
    fields: dict[str, str]
    evidence: dict[str, FieldEvidence]
    anchor_count: int = 0

    @property
    def quality(self):
        return sum(e.score for e in self.evidence.values() if e.value)
