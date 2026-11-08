"""Schema-driven field extraction. A field owns a bounded, connected text region.

There is deliberately no whole-page string fallback: failure to locate a field
is represented as missing evidence, rather than guessing a value from another
column. Recognition and extraction confidence are separate concepts.
"""
from __future__ import annotations

from ocr_types import FIELDS, FieldEvidence, Extraction
import re
from statistics import median

from layout import (TextBox, reading_order, label_of, normalize_page_boxes,
                    join_split_labels, filter_license_watermarks)
from validators import find_credit_code

COMPANY_ENDINGS = ('有限公司', '有限责任公司', '股份有限公司', '公司', '工作室', '经营部',
                   '商行', '商店', '合作社', '中心', '事务所', '工程队', '餐厅', '酒店',
                   '饭店', '超市', '便利店', '经销处', '加工场', '厂', '店', '合伙企业')



def _anchor(box: TextBox, doc_type: str, recover_address_fragment=True):
    compact = re.sub(r'\s+', '', box.text)
    if re.fullmatch(r'[0-9A-Z]{18}', compact):
        return '_stop', ''
    found = label_of(box)
    if found:
        return found
    # Fragment labels have the same field ownership rules as complete labels;
    # they never trigger an unrestricted suffix/whole-page search.
    if doc_type == 'business_license':
        text = re.sub(r'\s+', '', box.text)
        for prefix, key in (('称', 'name'), ('型', '_stop'), ('营者', 'legal_person')):
            if text.startswith(prefix):
                return key, text[len(prefix):].lstrip(':：')
        # A detached/lost 住 glyph can leave 所 attached to a clearly geographic
        # value. This is still a positioned label fragment, not a page search.
        if recover_address_fragment and re.match(r'^所[\u4e00-\u9fff]{2,12}(?:省|市|自治区|自治州|区|县)', text):
            return 'address', text[1:].lstrip(':：')
    return None


def _validate(key: str, value: str, doc_type: str) -> bool:
    if not value:
        return False
    if key == 'name' and doc_type == 'business_license':
        core = re.sub(r'[（(][^（）()]+[）)]$', '', value).strip()
        if core in COMPANY_ENDINGS:
            return False
        return any(core.endswith(ending) and len(core) >= len(ending) + 2
                   for ending in COMPANY_ENDINGS)
    if key in ('legal_person', 'name'):
        if re.search(r'市场|监督|管理|登记|机关|注册|经营|公司|企业', value):
            return False
        return bool(re.fullmatch(r'[\u4e00-\u9fff·]{2,8}', value))
    if key == 'address':
        return len(value) >= 4 and bool(re.search(r'[\u4e00-\u9fff]', value))
    return True


def _region(anchor, inline, anchors, boxes, key=None, doc_type='business_license'):
    """Build a connected text region, delimited by sibling columns and labels."""
    h = anchor.height
    same_column = [b for b, _ in anchors if abs(b.left - anchor.left) <= 6 * h]
    next_columns = [b.left for b, _ in anchors if b.left > anchor.left + 6 * h
                    and b.cy <= anchor.cy + h * 0.65]
    right = min(next_columns, default=float('inf'))
    bottom = min((b.top for b in same_column if b.cy > anchor.cy + h * 0.65),
                 default=float('inf'))
    anchor_ids = {id(b) for b, _ in anchors}
    candidates = [b for b in boxes if id(b) not in anchor_ids
                  and b.left >= anchor.left - h * 0.5 and b.right <= right
                  and b.top < bottom and b.cy >= anchor.cy - h * 0.5]
    same_row = sorted([b for b in candidates if abs(b.cy - anchor.cy) <= h * 0.65
                       and b.left >= anchor.right - h * 0.15], key=lambda b: b.left)
    parts = [inline] if inline else []
    used = [anchor] if inline else []
    edge = anchor.right
    for box in same_row:
        if box.left - edge > h * 3:
            break
        parts.append(box.text)
        used.append(box)
        edge = box.right
    if not used:
        # Some layouts print the label on a separate line. Start only near the
        # label's column, never from arbitrary text elsewhere on the document.
        left = anchor.left
        previous_y = anchor.cy
        heights = [h]
    else:
        left = used[0].left if used[0] is not anchor else anchor.left
        previous_y = max(b.cy for b in used)
        heights = [b.height for b in used]
    below = [b for b in candidates if b not in same_row and
             (b.cy > anchor.cy + min(h, b.height) * 0.45 if doc_type == 'business_license'
              else b.cy > anchor.cy + h * 0.65)]
    for box in reading_order(below):
        if (doc_type == 'business_license' and key == 'name'
                and _validate('name', ''.join(parts), doc_type)
                and not box.text.lstrip().startswith(('（', '('))):
            break
        scale = median(heights)
        if box.left < left - scale * 1.5:
            continue
        if box.cy - previous_y > scale * 2.5 or box.height > scale * 1.9:
            break
        if box.right - box.left < 0.4 * box.height:
            break
        parts.append(box.text)
        used.append(box)
        heights.append(box.height)
        previous_y = box.cy
    return ''.join(parts).strip(' :：'), used


def extract_document(doc_type: str, input_boxes: list[TextBox]) -> Extraction:
    if doc_type == 'id_card_front':
        from id_card import extract_id_front
        return extract_id_front(input_boxes)
    evidence = {key: FieldEvidence() for key in FIELDS}
    boxes = normalize_page_boxes(input_boxes)
    text = '\n'.join(b.text for b in boxes)
    wrong_type = doc_type == 'business_license' and re.search(r'公民身份号码|居民身份证', text)
    if wrong_type or doc_type == 'id_card_back':
        return Extraction(dict.fromkeys(FIELDS, ''), evidence)
    if doc_type == 'business_license':
        boxes = filter_license_watermarks(boxes)
    boxes = join_split_labels(boxes)
    anchors = [(b, found) for b in boxes if (found := _anchor(b, doc_type))]
    for anchor, (key, inline) in anchors:
        if key == '_stop':
            continue
        value, used = _region(anchor, inline, anchors, boxes, key, doc_type)
        score = sum(b.confidence for b in used) / len(used) if used else 0
        valid = _validate(key, value, doc_type)
        candidate = FieldEvidence(value if valid else '', score if valid else 0,
                                  used, 'anchored_region' if valid else 'invalid_or_incomplete')
        if candidate.score > evidence[key].score or evidence[key].reason == 'label_not_found':
            evidence[key] = candidate
    # Check digits are global invariants, not address/name fallback heuristics.
    if doc_type == 'business_license':
        code = find_credit_code(text)
        if code:
            evidence['credit_code'] = FieldEvidence(code, 1, reason='checksum')
    return Extraction({key: evidence[key].value for key in FIELDS}, evidence, len(anchors))


def select_candidate(candidates: list[tuple[list[TextBox], Extraction]]):
    """Choose complete coherent evidence, never reward string length.

    A candidate that drops a populated field cannot replace the original. Ties
    prefer the original image. Do not splice conflicting fields across frames.
    """
    best_boxes, best = candidates[0]
    for boxes, result in candidates[1:]:
        retains_fields = all(not value or result.fields[key] == value
                             for key, value in best.fields.items())
        if retains_fields and result.quality > best.quality + 0.05:
            best_boxes, best = boxes, result
    return best_boxes, best
