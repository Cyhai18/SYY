"""Document pipeline: image candidates -> evidence -> validation -> one result."""
from __future__ import annotations

from dataclasses import asdict
from io import BytesIO
from PIL import Image
import logging
from threading import Lock
import time

import cv2
import numpy as np

from engine import orient_document, _recognize_frame, prepare_frame
from extraction import extract_document, select_candidate
from layout import TextBox, normalize_page_boxes
from preprocess import document_crop
from refinement import refine_business_name

VERSION = 'structured-v4'
logger = logging.getLogger('ocr-service')
_inference_lock = Lock()


def _parse_boxes(doc_type: str, boxes: list[TextBox]) -> dict:
    return extract_document(doc_type, boxes).fields


def recognize(image_bytes: bytes, doc_type: str) -> dict:
    started = time.monotonic()
    # Reject oversized dimensions from headers before OpenCV allocates pixels.
    try:
        with Image.open(BytesIO(image_bytes)) as header:
            if header.width * header.height > 24_000_000:
                raise ValueError('图片像素不能超过 2400 万，请压缩后重试')
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError('无法解码图片或图片尺寸过大') from exc
    decoded = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError('无法解码图片')
    image, seed = orient_document(decoded, doc_type)
    del decoded
    candidates = []
    refinements = []

    def recognize_candidate(frame, seed=None):
        frame, seed = prepare_frame(frame, seed)
        candidate_boxes = normalize_page_boxes(_recognize_frame(frame, seed, prepared=True))
        extraction = extract_document(doc_type, candidate_boxes)
        if doc_type == 'business_license':
            candidate_boxes, extraction, metadata = refine_business_name(
                frame, candidate_boxes, extraction, prepared=True)
            refinements.append(metadata)
        candidates.append((candidate_boxes, extraction))

    recognize_candidate(image, seed)
    if doc_type == 'business_license':
        cropped, detected = document_crop(image)
        if detected:
            recognize_candidate(cropped)
        del cropped
    del image, seed
    boxes, result = select_candidate(candidates)
    conflicts = sorted({key for _, candidate in candidates for key, value in result.fields.items()
                        if value and candidate.fields[key] and candidate.fields[key] != value})
    diagnostics = {
        'nameRefinement': refinements,
        'conflictingFields': conflicts,
        'pipeline': VERSION,
        'elapsedMs': round((time.monotonic() - started) * 1000),
        'candidateCount': len(candidates),
        'selectedCandidate': next(i for i, candidate in enumerate(candidates) if candidate[0] is boxes),
        'fields': {key: {'reason': evidence.reason, 'evidenceScore': round(evidence.score, 3),
                         'sourceBoxes': [asdict(box) for box in evidence.boxes]}
                   for key, evidence in result.evidence.items()},
        'missingFields': [key for key in ('name', 'address', 'credit_code' if doc_type == 'business_license' else 'id_number')
                          if not result.fields[key]],
    }
    return {'docType': doc_type, 'fields': result.fields,
            'rawText': [box.text for box in boxes], 'diagnostics': diagnostics}


def recognize_document(image_bytes: bytes, doc_type: str) -> tuple[list[str], dict]:
    result = recognize(image_bytes, doc_type)
    return result['rawText'], result['fields']


def recognize_serialized(image_bytes: bytes, doc_type: str) -> dict:
    # One engine instance per worker. Queue inference off the async event loop.
    with _inference_lock:
        return recognize(image_bytes, doc_type)
