"""RapidOCR adapter and image geometry; no field extraction or HTTP concerns."""
from __future__ import annotations
import logging
import cv2
import numpy as np
from rapidocr_onnxruntime import RapidOCR
from layout import TextBox, fuse_frames, page_direction_score
logger = logging.getLogger("ocr-service")

# RapidOCR 底层用 ONNXRuntime 推理，跨平台稳定。模型首次加载较慢，做成进程级单例，
# 避免每次请求重新加载。
_ocr_engine: RapidOCR | None = None


def get_engine() -> RapidOCR:
    global _ocr_engine
    if _ocr_engine is None:
        logger.info("Loading RapidOCR model (first request may take a while)...")
        _ocr_engine = RapidOCR()
    return _ocr_engine


def _enhance(image: np.ndarray) -> np.ndarray:
    """灰度 + CLAHE 对比度增强：提升淡色字体/水印遮挡区域（如营业执照「名称」行）的识别召回。"""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def _estimate_skew(image: np.ndarray) -> float:
    """估计整页文本倾角（度，正值表示需逆时针纠正）。

    手机翻拍常带几度倾斜，OCR 对此召回骤降。用 Hough 直线检测近水平线
    （证照矩形边框 + 文本行都是强水平特征）取中位角，比 minAreaRect 稳健。
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    h, w = gray.shape[:2]
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=120,
        minLineLength=int(w * 0.3), maxLineGap=20,
    )
    if lines is None:
        return 0.0
    angles = []
    for x1, y1, x2, y2 in lines[:, 0]:
        ang = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(ang) < 20:  # 仅保留近水平线
            angles.append(ang)
    if not angles:
        return 0.0
    median = float(np.median(angles))
    # 仅纠正小角度整体倾斜，避免把竖排/异常版面误转。
    return 0.0 if abs(median) > 15 else median


def _deskew(image: np.ndarray, angle: float) -> np.ndarray:
    h, w = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
    return cv2.warpAffine(
        image, matrix, (w, h),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
    )


def _ocr_lines(image: np.ndarray) -> list[TextBox]:
    """Preserve full text bounds and recognition confidence for layout parsing."""
    result, _ = get_engine()(image)
    lines = []
    for entry in result or []:
        if not entry or len(entry) < 2 or not str(entry[1]).strip():
            continue
        xs = [pt[0] for pt in entry[0]]
        ys = [pt[1] for pt in entry[0]]
        lines.append(TextBox(str(entry[1]).strip(), min(xs), min(ys), max(xs), max(ys),
                             float(entry[2]) if len(entry) > 2 else 1.0))
    return lines


def _rotate90(image: np.ndarray, k: int) -> np.ndarray:
    """按 90 度倍数旋转（k=1 顺时针 90，2 为 180，3 为逆时针 90）。"""
    if k % 4 == 0:
        return image
    return np.rot90(image, k=-k).copy()


def _upright_score(image: np.ndarray) -> float:
    """Use the largest license title, not a thumbnail, to resolve 180° ambiguity.

    Text-line orientation classifiers can read upside-down pages correctly, so
    recognition confidence and horizontal boxes alone cannot determine page order.
    """
    return page_direction_score(_ocr_lines(image))


def orient_document(image: np.ndarray, doc_type: str | None = None) -> tuple[np.ndarray, list[TextBox]]:
    # Keep detections, not four full-resolution image buffers.
    detections = [_ocr_lines(_rotate90(image, index)) for index in range(4)]
    ratios = [sum((b.right - b.left) > b.height for b in boxes) / max(1, len(boxes))
              for boxes in detections]
    best = max(range(4), key=lambda index: ratios[index])
    opposite = (best + 2) % 4
    score_page = page_direction_score
    if doc_type == 'id_card_front':
        from id_card import id_direction_score
        score_page = id_direction_score
    scores = {index: score_page(detections[index]) for index in (best, opposite)}
    if scores[opposite] > scores[best]:
        best = opposite
    logger.info("orientation rotation=%s horizontal_ratio=%.3f", best * 90, ratios[best])
    return _rotate90(image, best), detections[best]


def _auto_orient(image: np.ndarray) -> np.ndarray:
    return orient_document(image)[0]


def prepare_frame(image: np.ndarray, seed: list[TextBox] | None = None):
    """Prepare geometry once; OCR and any ROI refinement share these pixels."""
    skew = _estimate_skew(image)
    if abs(skew) >= 0.5:
        return _deskew(image, skew), None
    return image, seed


def _recognize_frame(image: np.ndarray, seed: list[TextBox] | None = None,
                     *, prepared: bool = False) -> list[TextBox]:
    if not prepared:
        image, seed = prepare_frame(image, seed)
    return fuse_frames([seed if seed is not None else _ocr_lines(image), _ocr_lines(_enhance(image))])
