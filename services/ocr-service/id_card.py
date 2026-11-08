"""ID-front schema: horizontal name band, left address block, number footer.

Uses positioned evidence instead of the business-license column collector.
No identity or address values are inferred from another document or hidden pixels.
"""
from __future__ import annotations
import re
import unicodedata
from statistics import median

from layout import TextBox, reading_order, normalize_page_boxes
from validators import is_valid_id_number
from ocr_types import Extraction, FieldEvidence, FIELDS

_LABEL = re.compile(r'姓名|性别|民族|出生|住址|地址|公民身份号码|身份证号码|签发机关|有效期限')
_STOP = re.compile(r'性别|(?<!性)别(?=[男女])|民族|出生|公民身份号码|身份证号码|签发机关|有效期限')


def compact(text):
    return re.sub(r'\s+', '', text)


def role(box):
    text = compact(unicodedata.normalize('NFKC',box.text))
    match = _LABEL.match(text)
    if match:
        key = {'姓名':'name', '住址':'address', '地址':'address', '公民身份号码':'number',
               '身份证号码':'number'}.get(match.group(), 'other')
        return key, text[match.end():]
    if re.match(r'^别[男女](?:民族|$)', text):
        return 'other', text
    if re.fullmatch(r'[0-9]{17}[0-9Xx]', text):
        return 'number', text
    return None


def join_labels(boxes):
    # Address characters can be detected separately because blue labels are
    # widely spaced. Only join the same visual row, never a text fragment below.
    remaining = list(boxes)
    for prefix in boxes:
        ending = {'住':'址', '地':'址', '姓':'名'}.get(compact(prefix.text))
        if not ending or prefix not in remaining:
            continue
        options = [b for b in remaining if b is not prefix and compact(b.text).startswith(ending)
                   and 0 <= b.left-prefix.right <= max(prefix.height,b.height)*6
                   and abs(b.cy-prefix.cy) <= min(prefix.height,b.height)*0.65]
        if options:
            suffix = min(options, key=lambda b:b.left)
            remaining.remove(prefix)
            remaining.remove(suffix)
            remaining.append(TextBox(compact(prefix.text)+suffix.text, prefix.left, suffix.top,
                                     suffix.right, suffix.bottom, min(prefix.confidence,suffix.confidence)))
    return reading_order(remaining)


def _clean_value(value):
    return _STOP.split(value, maxsplit=1)[0].strip(' :：')


def id_direction_score(boxes):
    """Resolve page direction from field order even when the number is masked.

    Expected row order: name, sex/ethnicity, birth, address, number. This also
    works when the number shares a box with its label, unlike number-only tests.
    """
    stages = []
    for box in boxes:
        found = role(box)
        if not found:
            continue
        key = found[0]
        text = compact(box.text)
        stage = {'name':0, 'address':3, 'number':4}.get(key)
        if stage is None:
            stage = 2 if text.startswith('出生') else 1 if re.match(r'性别|别[男女]|民族',text) else None
        if stage is not None:
            stages.append((stage,box))
    differences = [(b.cy-a.cy)*(1 if sb>sa else -1)
                   for i,(sa,a) in enumerate(stages) for sb,b in stages[i+1:]
                   if sa != sb and abs(b.cy-a.cy)>min(a.height,b.height)*0.5]
    return median(differences) if differences else 0.0


def upright_id_boxes(boxes):
    if id_direction_score(boxes)<0:
        boxes = [TextBox(b.text,-b.right,-b.bottom,-b.left,-b.top,b.confidence) for b in boxes]
    return reading_order(boxes)


def extract_id_front(input_boxes):
    evidence = {key:FieldEvidence() for key in FIELDS}
    boxes = join_labels(upright_id_boxes(normalize_page_boxes(input_boxes)))
    roles = {id(b): role(b) for b in boxes}
    anchors = [(b,roles[id(b)]) for b in boxes if roles[id(b)]]
    numbers = [b for b,(key,_) in anchors if key == 'number']
    for anchor,(key,inline) in anchors:
        if key not in ('name','address'):
            continue
        h = anchor.height
        parts = [_clean_value(inline)] if inline else []
        used = [anchor] if inline else []
        if key == 'name':
            first_row = sorted([b for b in boxes if b is not anchor and roles[id(b)] is None
                                and abs(b.cy-anchor.cy) <= min(h,b.height)*0.65
                                and b.left >= anchor.right - min(h,b.height)*0.5], key=lambda b:b.left)
            right = min((b.left for b,info in anchors if info[0] != 'name'
                         and abs(b.cy-anchor.cy) < h*0.65 and b.left>anchor.right), default=float('inf'))
            for b in first_row:
                if b.right <= right:
                    parts.append(_clean_value(compact(b.text)))
                    used.append(b)
            value = ''.join(parts)
            is_han = lambda c: '\u3400' <= c <= '\u9fff' or '\U00020000' <= c <= '\U0002fa1f' or c == '·'
            valid = 2 <= len(value) <= 32 and all(is_han(c) for c in value)
        else:
            # Text above the address (name/sex/birth) estimates the left text
            # block's width. The portrait and 中国 security feature lie to its right.
            upper = [b for b in boxes if b.cy < anchor.cy-h*0.5
                     and (roles[id(b)] is None or roles[id(b)][0] != 'number')]
            right = max([b.right for b in upper]+[anchor.right]) + h*3
            bottom = min((b.top for b in numbers if b.cy>anchor.cy), default=float('inf'))
            previous_y = anchor.cy
            heights = [h]
            rows = [b for b in boxes if b is not anchor and roles[id(b)] is None
                    and b.left >= anchor.left-h*0.25 and b.right <= right
                    and b.cy >= anchor.cy-min(h,b.height)*0.5 and b.top < bottom]
            for b in reading_order(rows):
                scale = median(heights)
                if b.cy-previous_y > scale*2.5 or b.height > scale*1.9:
                    break
                value_piece = _clean_value(compact(b.text))
                if not value_piece:
                    continue
                parts.append(value_piece)
                used.append(b)
                heights.append(b.height)
                previous_y = max(previous_y,b.cy)
            value = ''.join(parts)
            valid = len(value)>=4 and any('\u3400'<=c<='\u9fff' for c in value)
        score = sum(b.confidence for b in used)/len(used) if used else 0
        result = FieldEvidence(value if valid else '', score if valid else 0, used,
                               'id_field_region' if valid else 'invalid_or_incomplete')
        if result.score>evidence[key].score or evidence[key].reason=='label_not_found':
            evidence[key]=result
    # Whitespace/fullwidth normalization and fragments on one number row are
    # safe to combine; never bridge separate document rows or correct digits by guess.
    for anchor in numbers:
        row = [b for b in boxes if abs(b.cy-anchor.cy)<=min(b.height,anchor.height)*0.65]
        text = ''.join(compact(unicodedata.normalize('NFKC',b.text)) for b in sorted(row,key=lambda b:b.left))
        for number in re.findall(r'(?<!\d)\d{17}[\dXx](?!\d)', text):
            if is_valid_id_number(number):
                evidence['id_number']=FieldEvidence(number.upper(),1,row,'checksum')
                break
    return Extraction({key:evidence[key].value for key in FIELDS},evidence,len(anchors))
