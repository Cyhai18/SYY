"""
授权证书生成微服务：见 docs/certificate-generation-design.md 第五节。

按 `templateKey`（= AgentCompany 枚举值）选中对应 .docx 模板，用 docxtpl（基于
Jinja2）渲染占位符与表格循环（shops），再用 LibreOffice headless 模式转换为 PDF
并返回二进制流。模板中的 Jinja2 占位符已直接写入 `templates/*.docx`（见第四节），
本服务不做字段名转换，`apps/api` 侧负责组装好符合模板占位符命名的渲染数据。

证书生成频率低，用简单的 asyncio.Lock 避免并发请求同时调用 soffice 冲突，
不引入重型任务队列。
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

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


# 转 PDF 是 CPU/IO 密集的外部进程调用，同一时间只允许一个 soffice 实例运行，
# 避免并发请求争用同一份 profile 目录导致锁文件冲突/僵死进程。
_soffice_lock = asyncio.Lock()


@app.get("/health")
async def health():
    return {"status": "ok"}


def _render_docx(template_path: Path, data: CertificateData, out_path: Path) -> None:
    tpl = DocxTemplate(str(template_path))
    tpl.render(data.model_dump())
    tpl.save(str(out_path))


def _convert_to_pdf(docx_path: Path, out_dir: Path) -> Path:
    profile_dir = Path(tempfile.gettempdir()) / f"lo_{uuid.uuid4().hex}"
    soffice_bin = os.environ.get("SOFFICE_BIN", "soffice")
    try:
        subprocess.run(
            [
                soffice_bin,
                "--headless",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to",
                "pdf",
                "--outdir",
                str(out_dir),
                str(docx_path),
            ],
            timeout=30,
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        logger.exception("soffice 转 PDF 失败: %s", exc.stderr)
        raise HTTPException(status_code=500, detail="生成 PDF 失败") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="生成 PDF 超时") from exc
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)

    pdf_path = out_dir / (docx_path.stem + ".pdf")
    if not pdf_path.exists():
        raise HTTPException(status_code=500, detail="生成 PDF 失败：未找到输出文件")
    return pdf_path


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

        async with _soffice_lock:
            pdf_path = await asyncio.get_event_loop().run_in_executor(
                None, _convert_to_pdf, docx_path, tmp_dir
            )
        pdf_bytes = pdf_path.read_bytes()

    return Response(content=pdf_bytes, media_type="application/pdf")
