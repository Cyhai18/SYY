"""Business-only targeted name re-recognition with multi-scale agreement.

No character dictionary or per-license correction is used. Contrast enhancement
can erase a fine stroke; verify uncertain name lines from the original pixels at
several scales, requiring repeated agreement rather than the highest score.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import replace
import math
import re

import cv2

from engine import _ocr_lines, _estimate_skew, _deskew
from extraction import _anchor, _validate, extract_document
from layout import reading_order


def refine_business_name(image, boxes, extraction, *, prepared=False):
    evidence = extraction.evidence['name']
    metadata = {'attempted': False, 'accepted': False}
    # Absent/redacted/structurally incomplete fields have no trustworthy region
    # to verify. Never synthesize a name from an arbitrary image crop.
    if not evidence.value or len(evidence.boxes) != 1 or evidence.score >= 0.985:
        return boxes, extraction, metadata
    source = evidence.boxes[0]
    if source.left < 0 or source.top < 0 or not any(box is source for box in boxes):
        return boxes, extraction, metadata
    if not prepared:
        skew = _estimate_skew(image)
        if abs(skew) >= 0.5:
            image = _deskew(image, skew)
    h = source.height
    x0, y0 = max(0, math.floor(source.left - h*0.15)), max(0, math.floor(source.top - h*0.22))
    x1, y1 = min(image.shape[1], math.ceil(source.right + h*0.15)), min(image.shape[0], math.ceil(source.bottom + h*0.22))
    crop = image[y0:y1, x0:x1]
    if not crop.size:
        return boxes, extraction, metadata
    metadata['attempted'] = True
    candidates = []
    for scale in (1, 2, 3):
        frame = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        lines = reading_order(_ocr_lines(frame))
        raw = ''.join(line.text for line in lines)
        compact = re.sub(r'\s+', '', raw)
        anchor = _anchor(replace(source, text=compact), 'business_license')
        value = anchor[1] if anchor and anchor[0] == 'name' else compact
        # A clipped label stroke can be read as an extra first character. Only
        # align to a leading pair already present in the anchored original read.
        offset = value.find(evidence.value[:2], 0, 4)
        if 0 <= offset <= 2:
            value = value[offset:]
        if value.startswith(evidence.value[:2]) and _validate('name', value, 'business_license'):
            candidates.append(value)
    counts = Counter(candidates)
    metadata['validReads'] = len(candidates)
    if not counts:
        return boxes, extraction, metadata
    ranked = counts.most_common()
    value, votes = ranked[0]
    metadata['agreement'] = votes
    if votes < 2 or (len(ranked) > 1 and ranked[1][1] == votes):
        return boxes, extraction, metadata
    metadata['accepted'] = True
    # Retain field provenance on the document, not the upscaled ROI coordinates.
    updated = [replace(box, text='名称' + value) if box is source else box for box in boxes]
    result = extract_document('business_license', updated)
    result.evidence['name'].reason = 'roi_consensus'
    return updated, result, metadata
