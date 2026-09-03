"""
RapidOCR 微服务：见 docs/client-profile-design.md 第 3.1/3.4 节。

用 RapidOCR 做通用文字识别，再用 `parsers.py` 在识别出的文本行上做标签定位、正则
校验、校验位算法，提取结构化字段（信用代码/身份证号/姓名/住所/法定代表人等），
连同原始文本行（`rawText`）一并返回给 Nest 侧。结构化字段提取是本服务职责，
Nest 侧不重复实现规则。

接口按 `doc_type` 区分证照类型，取值：business_license / id_card_front / id_card_back，
三者共用同一套通用文字识别 + 预处理逻辑，按类型分别提取对应字段。

识别前做图像预处理（整体朝向纠正、灰度 CLAHE 对比度增强、Hough 直线检测纠偏、
多帧识别取并集），用于提升手机翻拍件的召回率：整体旋转 90/180/270 度的照片会先
被纠正为正向（否则文本框坐标是竖排的，按坐标排序会把跨行字段如住址换行拆散）；
手写/淡色印刷字体、水印遮挡、轻微倾斜这些场景下单帧原图识别效果不稳定，多帧
（原图 + 增强图 [+ 纠偏图]）按框位置合并排序、去重后再交给字段提取逻辑定位字段，
能显著减少漏识。
"""

from __future__ import annotations

import logging
import re

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from rapidocr_onnxruntime import RapidOCR

from parsers import extract_fields
from translate import translate_business_license_fields, translate_id_card_fields

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr-service")

app = FastAPI(title="FunTax OCR Service")

ALLOWED_DOC_TYPES: set[str] = {"business_license", "id_card_front", "id_card_back"}

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


def _ocr_lines(image: np.ndarray) -> list[tuple[str, float, float]]:
    """返回每行文字及其位置（框中心 y、x），用于跨帧合并后按版面阅读顺序重排。"""
    result, _ = get_engine()(image)
    lines: list[tuple[str, float, float]] = []
    for entry in result or []:
        # entry: [box, text, confidence]
        if not entry or len(entry) < 2:
            continue
        text = str(entry[1]).strip()
        if not text:
            continue
        box = entry[0]
        ys = [pt[1] for pt in box]
        xs = [pt[0] for pt in box]
        cy = sum(ys) / len(ys)
        cx = sum(xs) / len(xs)
        lines.append((text, cy, cx))
    return lines


def _rotate90(image: np.ndarray, k: int) -> np.ndarray:
    """按 90 度倍数旋转（k=1 顺时针 90，2 为 180，3 为逆时针 90）。"""
    if k % 4 == 0:
        return image
    return np.rot90(image, k=-k).copy()


def _horizontal_ratio(image: np.ndarray) -> float:
    """RapidOCR 的检测/识别对竖排文字框依然能出字，字数并不能反映图片朝向是否正确；
    但版面朝向对时，绝大多数文本框应是「宽 > 高」的横向框。用横向框占比衡量朝向。"""
    result, _ = get_engine()(image)
    boxes = result or []
    if not boxes:
        return 0.0
    horizontal = 0
    for entry in boxes:
        if not entry or len(entry) < 1:
            continue
        box = entry[0]
        xs = [pt[0] for pt in box]
        ys = [pt[1] for pt in box]
        if (max(xs) - min(xs)) > (max(ys) - min(ys)):
            horizontal += 1
    return horizontal / len(boxes)


def _upright_score(image: np.ndarray) -> float:
    """在「横向文本框占比」已确定的基础上，仍可能整体上下颠倒 180 度（旋转轴选对了，
    方向选反了）——文字本身因 RapidOCR 内置的方向分类器仍能正常识别，只是行序上下颠倒。
    身份证正面版式固定：姓名在最上面，18 位身份证号在最下面，用这一先验判断朝向是否
    正确（正确朝向下「姓名」所在行的 y 应明显小于身份证号所在行的 y）。"""
    result, _ = get_engine()(image)
    name_y = None
    id_y = None
    for entry in result or []:
        if not entry or len(entry) < 2:
            continue
        box, text = entry[0], str(entry[1])
        cy = sum(pt[1] for pt in box) / len(box)
        if name_y is None and re.search(r"姓\s*名", text):
            name_y = cy
        if re.fullmatch(r"\d{17}[\dXx]", text.strip()):
            id_y = cy
    if name_y is None or id_y is None:
        return 0.0
    return id_y - name_y


def _auto_orient(image: np.ndarray) -> np.ndarray:
    """部分手机拍摄/扫描件会整体旋转 90/180/270 度（文字整体竖排），常规倾斜纠偏
    （`_estimate_skew`/`_deskew`，仅处理 <=15 度小角度）无法处理这种情况：文字仍可被
    识别出来，但文本框坐标系是竖排的，会导致后续按坐标排序时阅读顺序错乱（如住址换行
    被拆散、与其他字段交错）。这里对 4 个方向各跑一次检测，取「横向文本框占比」最高的
    方向作为正确朝向候选；若该方向与其 180 度对侧同样是横向（只是上下颠倒），再用
    `_upright_score` 判断姓名/身份证号的相对位置，纠正上下颠倒。"""
    candidates = [image, _rotate90(image, 1), _rotate90(image, 2), _rotate90(image, 3)]
    ratios = [_horizontal_ratio(cand) for cand in candidates]
    best_idx = max(range(4), key=lambda i: ratios[i])
    opposite_idx = (best_idx + 2) % 4
    if ratios[opposite_idx] >= ratios[best_idx] - 0.05:
        if _upright_score(candidates[opposite_idx]) > _upright_score(candidates[best_idx]):
            best_idx = opposite_idx
    return candidates[best_idx]


def recognize_text_lines(image_bytes: bytes) -> list[str]:
    """多通道识别：先纠正整体旋转（0/90/180/270），再原图 + CLAHE 增强图
    （+ 纠偏图，当检测到明显小角度倾斜时），按文字框位置合并排序（同一文本首次出现的
    框位置为准），兼顾常规字段（原图）、淡色/水印遮挡字段（增强图）与倾斜翻拍件
    （纠偏图），保证输出顺序符合版面从上到下的阅读顺序，避免多帧拼接导致跨行字段
    （如住址换行）被拆散。"""
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    decoded = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError("无法解码图片")
    image = _auto_orient(decoded)

    skew = _estimate_skew(image)
    if abs(skew) >= 0.5:
        corrected = _deskew(image, skew)
        frames = [corrected, _enhance(corrected), image]
    else:
        frames = [image, _enhance(image)]

    seen: dict[str, tuple[float, float]] = {}
    for frame in frames:
        for text, cy, cx in _ocr_lines(frame):
            if text not in seen:
                seen[text] = (cy, cx)
    ordered = sorted(seen.items(), key=lambda item: (item[1][0], item[1][1]))
    return [text for text, _ in ordered]


async def read_upload(file: UploadFile) -> bytes:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="空文件")
    return data


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/recognize")
async def recognize(file: UploadFile = File(...), doc_type: str = Form(...)):
    """统一识别入口：按 doc_type 区分证照类型（business_license / id_card_front / id_card_back），
    三者共用同一套通用文字识别 + 预处理逻辑，再用 `extract_fields` 提取对应结构化字段。"""
    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="doc_type 无效")
    data = await read_upload(file)
    try:
        raw_text = recognize_text_lines(data)
        fields = extract_fields(doc_type, raw_text)
        if doc_type == "business_license":
            fields = translate_business_license_fields(fields)
        elif doc_type == "id_card_front":
            fields = translate_id_card_fields(fields)
    except Exception as exc:  # noqa: BLE001
        logger.exception("OCR failed for doc_type=%s", doc_type)
        raise HTTPException(status_code=500, detail=f"识别失败: {exc}") from exc
    logger.info(
        "doc_type=%s rawText=%s fields=%s", doc_type, raw_text, fields,
    )
    return {"docType": doc_type, "fields": fields, "rawText": raw_text}
