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

import logging
import os
import tempfile
import uuid
from pathlib import Path

import httpx
from docxtpl import DocxTemplate
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

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


GOTENBERG_URL = os.environ.get("GOTENBERG_URL", "http://localhost:3000")
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

    return Response(content=pdf_bytes, media_type="application/pdf")
