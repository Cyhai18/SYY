"""Geometry-aware OCR fusion and label-anchored field reading (no model dependency)."""
from __future__ import annotations

from ocr_types import TextBox
import logging
import re
from statistics import median



def reading_order(boxes: list[TextBox]) -> list[TextBox]:
    """Cluster rows with height-relative tolerance; then read left to right."""
    rows: list[list[TextBox]] = []
    for box in sorted(boxes, key=lambda b: (b.cy, b.left)):
        if rows and abs(box.cy - median(b.cy for b in rows[-1])) <= 0.45 * min(box.height, median(b.height for b in rows[-1])):
            rows[-1].append(box)
        else:
            rows.append([box])
    return [b for row in rows for b in sorted(row, key=lambda b: b.left)]


def fuse_frames(frames: list[list[TextBox]]) -> list[TextBox]:
    """Replace competing readings of the same region; preserve repeated text elsewhere.

    All frames MUST share the same geometry. A split reading cannot coexist with
    an overlapping whole-line reading: select by covered area then confidence.
    """
    fused: list[TextBox] = []
    for frame in frames:
        for box in frame:
            overlaps = []
            for old in fused:
                width = max(0, min(box.right, old.right) - max(box.left, old.left))
                height = max(0, min(box.bottom, old.bottom) - max(box.top, old.top))
                area = min((box.right - box.left) * box.height, (old.right - old.left) * old.height)
                if area > 0 and width * height / area >= 0.65:
                    overlaps.append(old)
            if not overlaps:
                fused.append(box)
            elif len(overlaps) == 1:
                old = overlaps[0]
                # Prefer a complete line when an alternate pass only saw a fragment.
                if box.confidence >= old.confidence and len(box.text) >= len(old.text) * 0.8:
                    fused.remove(old)
                    fused.append(box)
            # Multiple overlaps usually mean an alternate pass merged distinct boxes.
            # Keep the existing segmentation to avoid destroying label/value geometry.
    return reading_order(fused)


_LABELS = {
    'name': ('名称', '姓名'),
    'address': ('主要经营场所', '生产经营场所', '经营场所', '营业场所', '住所', '住址', '地址'),
    'legal_person': ('法定代表人', '法定代表', '负责人', '经营者', '投资人'),
    '_stop': ('统一社会信用代码', '信用代码', '类型', '注册资本', '成立日期', '注册日期',
              '登记日期', '组成形式', '经营范围', '登记机关', '营业期限', '经营期限',
              '公民身份号码', '身份证号码', '性别', '民族', '出生', '签发机关', '有效期限'),
}
_LABEL_PATTERN = re.compile(r'^(' + '|'.join(
    re.escape(label) for labels in _LABELS.values() for label in labels
) + r')[:：]?')


def label_of(box: TextBox):
    text = re.sub(r'\s+', '', box.text)
    match = _LABEL_PATTERN.match(text)
    if not match:
        return None
    label = match.group(1)
    field = next(key for key, labels in _LABELS.items() if label in labels)
    return field, text[match.end():]


def page_direction_score(boxes: list[TextBox]) -> float:
    """Positive means upright; negative means upside down; zero is unknown."""
    titles = [b for b in boxes if re.sub(r'\s+', '', b.text) == '营业执照']
    if titles:
        title = max(titles, key=lambda b: (b.right - b.left) * b.height)
        body = [b for b in boxes if b.height >= title.height * 0.08
                and re.match(r'(?:名称|称|类型|经营者|经营场所|住所|注册日期|成立日期|经营范围|登记机关|法定代表)',
                             re.sub(r'\s+', '', b.text))]
        if len(body) >= 2:
            return median(b.cy for b in body) - title.cy
    names = [b.cy for b in boxes if re.search(r'姓\s*名', b.text)]
    ids = [b.cy for b in boxes if re.fullmatch(r'\d{17}[\dXx]', b.text.strip())]
    return max(ids) - min(names) if names and ids else 0.0


def normalize_page_boxes(boxes: list[TextBox]) -> list[TextBox]:
    """Final OCR passes may reveal layout missed during orientation probing.

    Rotate coordinates, not recognized strings, so rawText and field parsing use
    the same upright geometry even if the early image-level decision was wrong.
    """
    score = page_direction_score(boxes)
    if score < 0:
        logging.getLogger('ocr-service').info('final OCR layout inverted (score=%.2f); normalizing coordinates', score)
        boxes = [TextBox(b.text, -b.right, -b.bottom, -b.left, -b.top, b.confidence)
                 for b in boxes]
    return reading_order(boxes)


def join_split_labels(boxes: list[TextBox]) -> list[TextBox]:
    """Recover widely spaced labels split into separate detection boxes.

    Example: [住] [所佛山市…]. The full label must be recovered before
    collecting continuations, otherwise the plain-text fallback hits the other
    column's business-scope label and truncates the address.
    """
    remaining = list(boxes)
    for prefix in boxes:
        first = re.sub(r'\s+', '', prefix.text)
        last = {'住': '所', '地': '址', '名': '称', '姓': '名'}.get(first)
        if last is None or prefix not in remaining:
            continue
        matches = [b for b in remaining if b is not prefix
                   and re.sub(r'\s+', '', b.text).startswith(last)
                   and 0 <= b.left - prefix.right <= max(b.height, prefix.height) * 6
                   and abs(b.cy - prefix.cy) <= max(b.height, prefix.height) * 0.6]
        if not matches:
            continue
        suffix = min(matches, key=lambda b: b.left)
        remaining.remove(prefix)
        remaining.remove(suffix)
        # Use the value's baseline/height, not the isolated glyph's tall box;
        # an inflated row height could swallow the next address line.
        remaining.append(TextBox(first + suffix.text, prefix.left, suffix.top,
                                 suffix.right, suffix.bottom,
                                 min(prefix.confidence, suffix.confidence)))
    return reading_order(remaining)


def filter_license_watermarks(boxes: list[TextBox]) -> list[TextBox]:
    """Infer repeated Latin security-print families from the document itself.

    No hard-coded watermark text. Mixed Chinese/Latin room values are never
    removed. Short fragments need same-row and glyph-scale corroboration.
    """
    from collections import Counter

    def token(box):
        return re.sub(r'\s+', '', box.text).upper()

    counts = Counter(token(b) for b in boxes if re.fullmatch(r'[A-Z]{4,10}', token(b)))
    families = [value for value, count in counts.items() if count >= 2]
    anchors = [b for b in boxes if any(
        re.fullmatch(r'[A-Z]+', token(b)) and len(token(b)) <= len(family) + 2
        and (family in token(b) or token(b) == family)
        for family in families)]
    if not anchors:
        return boxes
    filtered = []
    for box in boxes:
        value = token(box)
        if box in anchors:
            continue
        fragment = re.fullmatch(r'[A-Z]{2,10}', value) and any(value in family for family in families)
        if fragment and any(
            abs(box.cy - anchor.cy) <= min(box.height, anchor.height) * 0.7
            and 0.55 <= ((box.right - box.left) / len(value)) /
                max(1, (anchor.right - anchor.left) / len(token(anchor))) <= 1.8
            for anchor in anchors
        ):
            continue
        filtered.append(box)
    return filtered


def spatial_fields(boxes: list[TextBox], doc_type: str) -> dict[str, str]:
    """Compatibility entrypoint; all field ownership is implemented once."""
    from extraction import extract_document
    return {key: value for key, value in extract_document(doc_type, boxes).fields.items() if value}
