"""
授权证书生成微服务：见 docs/certificate-generation-design.md 第五节，
转 PDF 部分的技术选型见 docs/doc-service-html-weasyprint-poc.md。

按 `templateKey`（= AgentCompany 枚举值）选中对应 .docx 模板，用 docxtpl（基于
Jinja2）渲染占位符与表格循环（shops），再调用 Gotenberg（基于 LibreOffice 的
文档转换 HTTP 微服务，见 GOTENBERG_URL）转换为 PDF 并返回二进制流。模板中的
Jinja2 占位符已直接写入 `templates/*.docx`（见第四节），本服务不做字段名转换，
`apps/api` 侧负责组装好符合模板占位符命名的渲染数据。

Gotenberg 内部自行管理 LibreOffice 常驻实例的并发与健康检查，本服务不需要再
自己维护 soffice 子进程锁/重启逻辑。
"""

from __future__ import annotations

import io
import logging
import math
import os
import re
import tempfile
import uuid
from pathlib import Path

import httpx
from docxtpl import DocxTemplate
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("doc-service")

app = FastAPI(title="FunTax Doc Service")

TEMPLATES_DIR = Path(__file__).parent / "templates"

# 与 apps/api 侧 CertificateModule 组装的渲染数据结构一一对应，见设计文档第三/五节
SHOP_KEYS = (
    "platform",
    "shop_url",
    "shop_id",
    "shop_name",
    "brand_names",
    "product_names_cn",
    "product_names_en",
)


class ShopData(BaseModel):
    platform: str
    shop_url: str = ""
    shop_id: str = ""
    shop_name: str = ""
    brand_names: str = ""
    product_names_cn: str = ""
    product_names_en: str = ""


class CertificateData(BaseModel):
    agreement_number: str
    effective_range_en: str
    effective_range_cn: str
    party_a_name_cn: str = ""
    party_a_name_en: str = ""
    party_a_address_cn: str = ""
    party_a_address_en: str = ""
    party_a_zip: str = ""
    party_a_contact: str = ""
    party_a_tel: str = ""
    party_a_email: str = ""
    signing_date: str
    shops: list[ShopData] = []


class GenerateRequest(BaseModel):
    templateKey: str
    data: CertificateData


GOTENBERG_URL = os.environ.get("GOTENBERG_URL", "http://localhost:3010")
DOCX_MIME = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


@app.get("/health")
async def health():
    return {"status": "ok"}


def _render_docx(template_path: Path, data: CertificateData, out_path: Path) -> None:
    tpl = DocxTemplate(str(template_path))
    tpl.render(data.model_dump())
    tpl.save(str(out_path))


def _mask_phone(tel: str) -> str:
    """手机号中间 4 位打码，如 `13800138000` -> `138****8000`；长度不足 8 位时整体打码。"""
    tel = tel or ""
    if len(tel) > 7:
        return f"{tel[:3]}****{tel[-4:]}"
    return "*" * len(tel) if tel else ""


def _format_effective_range(effective_range_en: str) -> str:
    """`2026/10/15 to 2027/10/15` -> `2026-10-15/2027-10-15`：起止日期分隔符改 `-`，中间用 `/` 连接。"""
    parts = [p.strip().replace("/", "-") for p in effective_range_en.split(" to ")]
    return "/".join(parts)


def _format_generated_date(agreement_number: str) -> str:
    """证书编号形如 `20260903xxxx`，前 8 位是生成日期，转为 `2026-09-03`。"""
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", agreement_number or "")
    if not m:
        return agreement_number or ""
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"


def _build_watermark_lines(data: "CertificateData") -> list[str]:
    line1 = data.party_a_name_en or ""
    line2 = _format_effective_range(data.effective_range_en)
    line3 = f"{_format_generated_date(data.agreement_number)}-{_mask_phone(data.party_a_tel)}"
    return [line1, line2, line3]


def _watermark_block_bbox(
    lines: list[str], font_name: str, font_size: int, line_gap: int, angle: float
) -> tuple[float, float, float, float]:
    """计算水印文字块（左对齐、从锚点 (0,0) 向左下方展开）旋转后的轴对齐外接矩形。

    返回 (min_x, max_x, min_y, max_y)：是相对锚点的偏移量，锚点放在页面坐标
    系中的某个位置后，外接矩形就是 [anchor_x+min_x, anchor_x+max_x] x
    [anchor_y+min_y, anchor_y+max_y]。
    """
    rad = math.radians(angle)
    max_line_width = max(
        (stringWidth(line, font_name, font_size) for line in lines if line),
        default=0,
    )
    block_height = line_gap * len(lines)
    # 旋转前，文字块左对齐，局部坐标范围：x in [0, max_line_width]，y in [-block_height, 0]
    corners = [(0.0, 0.0), (max_line_width, 0.0), (0.0, -block_height), (max_line_width, -block_height)]
    rotated = [
        (x * math.cos(rad) - y * math.sin(rad), x * math.sin(rad) + y * math.cos(rad))
        for x, y in corners
    ]
    xs = [p[0] for p in rotated]
    ys = [p[1] for p in rotated]
    return min(xs), max(xs), min(ys), max(ys)


def _make_watermark_overlay(width: float, height: float, lines: list[str]) -> bytes:
    """生成与页面同尺寸的透明水印层：颜色 #f2f2f2，每个水印块必须完整展示在页面内。

    每个方向（横/纵）最多铺 3 个、且居中分布；如果某个方向连 1 个完整的水印块都
    放不下，就不在该方向上重复铺（即该方向退化为 1 个，仍保证完整展示，不裁切）。
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width, height))
    font_name, font_size = "Helvetica", 18
    c.setFont(font_name, font_size)
    c.setFillColor(Color(0xF2 / 255, 0xF2 / 255, 0xF2 / 255))
    line_gap = 24
    angle = 45
    max_per_axis = 3
    gap_ratio = 1.15  # 相邻水印块之间的额外间距比例，避免紧贴

    min_x, max_x, min_y, max_y = _watermark_block_bbox(lines, font_name, font_size, line_gap, angle)
    bbox_w = max_x - min_x
    bbox_h = max_y - min_y
    spacing_x = bbox_w * gap_ratio
    spacing_y = bbox_h * gap_ratio

    def axis_count(page_size: float, bbox_size: float, spacing: float) -> int:
        if bbox_size > page_size or bbox_size <= 0:
            return 0
        extra_range = page_size - bbox_size
        return max(1, min(max_per_axis, int(extra_range // spacing) + 1))

    cols = axis_count(width, bbox_w, spacing_x)
    rows = axis_count(height, bbox_h, spacing_y)

    if cols and rows:
        # 整个网格在页面内居中：先算网格总尺寸，再算起始锚点，使水印块外接矩形整体居中
        grid_w = bbox_w + (cols - 1) * spacing_x
        grid_h = bbox_h + (rows - 1) * spacing_y
        anchor_x0 = (width - grid_w) / 2 - min_x
        anchor_y0 = (height - grid_h) / 2 - min_y

        c.saveState()
        for row in range(rows):
            for col in range(cols):
                ax = anchor_x0 + col * spacing_x
                ay = anchor_y0 + row * spacing_y
                c.saveState()
                c.translate(ax, ay)
                c.rotate(angle)
                for i, line in enumerate(lines):
                    if not line:
                        continue
                    c.drawString(0, -i * line_gap, line)
                c.restoreState()
        c.restoreState()

    c.showPage()
    c.save()
    return buf.getvalue()


def _apply_watermark(pdf_bytes: bytes, data: "CertificateData") -> bytes:
    """给证书 PDF 每一页叠加水印层，水印内容含客户名/生效期/生成日期+打码电话。"""
    lines = _build_watermark_lines(data)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    overlay_bytes_cache: dict[tuple[float, float], bytes] = {}

    for page in reader.pages:
        size = (float(page.mediabox.width), float(page.mediabox.height))
        overlay_bytes = overlay_bytes_cache.get(size)
        if overlay_bytes is None:
            overlay_bytes = _make_watermark_overlay(size[0], size[1], lines)
            overlay_bytes_cache[size] = overlay_bytes
        # 水印层要在最底下：每页都从一份新的水印页出发，再把原页正文内容叠在它上面，
        # 不能反过来 merge（那样水印会盖在正文之上）；且每次需要全新的 PdfReader，
        # 因为 merge_page 会原地修改页面对象，同一份水印页不能跨页复用。
        overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
        watermark_page = overlay_reader.pages[0]
        watermark_page.merge_page(page)
        writer.add_page(watermark_page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


async def _convert_to_pdf(docx_path: Path) -> bytes:
    """通过 Gotenberg（LibreOffice HTTP 微服务）将 docx 转为 pdf。"""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            with open(docx_path, "rb") as f:
                resp = await client.post(
                    f"{GOTENBERG_URL}/forms/libreoffice/convert",
                    files={"files": (docx_path.name, f, DOCX_MIME)},
                )
            resp.raise_for_status()
            return resp.content
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="生成 PDF 超时") from exc
    except httpx.HTTPError as exc:
        logger.exception("调用 Gotenberg 转 PDF 失败: %s", exc)
        raise HTTPException(status_code=500, detail="生成 PDF 失败") from exc


@app.post("/certificate/generate")
async def generate_certificate(req: GenerateRequest):
    template_path = TEMPLATES_DIR / f"{req.templateKey}.docx"
    if not template_path.exists():
        raise HTTPException(status_code=404, detail=f"模板不存在: {req.templateKey}")

    with tempfile.TemporaryDirectory() as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)
        docx_path = tmp_dir / f"{uuid.uuid4().hex}.docx"
        try:
            _render_docx(template_path, req.data, docx_path)
        except Exception as exc:  # noqa: BLE001
            logger.exception("渲染 docx 失败")
            raise HTTPException(status_code=500, detail=f"渲染失败: {exc}") from exc

        pdf_bytes = await _convert_to_pdf(docx_path)

    try:
        pdf_bytes = _apply_watermark(pdf_bytes, req.data)
    except Exception as exc:  # noqa: BLE001
        logger.exception("添加水印失败")
        raise HTTPException(status_code=500, detail=f"添加水印失败: {exc}") from exc

    return Response(content=pdf_bytes, media_type="application/pdf")
