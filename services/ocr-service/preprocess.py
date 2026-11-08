"""Conservative document quadrilateral detection; never depends on a red annotation."""
from __future__ import annotations

import cv2
import numpy as np


def document_crop(image: np.ndarray) -> tuple[np.ndarray, bool]:
    """Return a perspective-corrected large rectangular candidate or the original.

    This is a candidate, not proof of a license border. The caller must retain
    original-image OCR as fallback. No fixed template coordinates or color mask.
    """
    height, width = image.shape[:2]
    scale = min(1.0, 1200 / max(height, width))
    small = image if scale == 1 else cv2.resize(image, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 40, 120)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        fraction = cv2.contourArea(contour) / (small.shape[0] * small.shape[1])
        if not 0.45 <= fraction <= 0.97:
            continue
        quad = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        if len(quad) != 4 or not cv2.isContourConvex(quad):
            continue
        points = quad[:, 0].astype(np.float32) / scale
        # Sort around center, starting at top-left. Works for modest perspective.
        center = points.mean(axis=0)
        points = points[np.argsort(np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0]))]
        points = np.roll(points, -np.argmin(points.sum(axis=1)), axis=0)
        top_left, top_right, bottom_right, bottom_left = points
        w = int(max(np.linalg.norm(top_right - top_left), np.linalg.norm(bottom_right - bottom_left)))
        h = int(max(np.linalg.norm(bottom_left - top_left), np.linalg.norm(bottom_right - top_right)))
        if min(w, h) < 200 or max(w, h) / min(w, h) > 2.2:
            continue
        target = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
        matrix = cv2.getPerspectiveTransform(points, target)
        cropped = cv2.warpPerspective(image, matrix, (w, h), flags=cv2.INTER_CUBIC)
        return cropped, True
    return image, False
