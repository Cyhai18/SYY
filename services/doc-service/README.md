# FunTax Doc Service（授权证书生成微服务）

见 `docs/certificate-generation-design.md` 整体方案。这是一个独立的 Python/FastAPI 服务，
负责用 `docxtpl`（基于 Jinja2）渲染授权证书 `.docx` 模板占位符与表格循环（shops），
再调用 LibreOffice headless 模式转换为 PDF 并返回二进制流。

## 依赖 LibreOffice

本服务依赖系统已安装 `soffice`（LibreOffice 命令行）：

```bash
# macOS
brew install --cask libreoffice

# Debian/Ubuntu
apt-get install -y libreoffice fonts-noto-cjk   # 需要中文字体，否则 PDF 中文内容显示为方框
```

如 `soffice` 不在 `PATH` 中，可通过环境变量 `SOFFICE_BIN` 指定可执行文件路径。

## 本地启动（首次）

```bash
cd services/doc-service
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001
```

## 日常启动

```bash
cd services/doc-service
source .venv/bin/activate
uvicorn app:app --reload --port 8001
```

## 接入 Nest API

在 `apps/api/.env` 增加：

```
DOC_SERVICE_URL=http://127.0.0.1:8001
```

重启 `apps/api` 进程后，`CertificateService` 会自动调用本服务；未配置或本服务调用失败时，
生成证书接口报错提示，不阻断其他流程（降级模式同 `OCR_SERVICE_URL`）。

## 接口

```
GET  /health                健康检查
POST /certificate/generate  { templateKey, data } → application/pdf（二进制流）
```

`templateKey` = `AgentCompany` 枚举值（`OVERSEA_WALKERS_GB` / `OVERSEA_WALKERS_EU` /
`EU_CONSULTEN_SRLS` / `OVERSEA_WALKERS_US` / `OVERSEA_WALKERS_TR`），对应 `templates/` 目录下
同名 `.docx` 模板。`data` 字段命名与模板占位符一致，详见设计文档第三/五节，所有模板共用
同一套渲染数据结构，无需按 `templateKey` 做字段差异处理。

## 已知限制 / 后续优化方向

- 每次请求同一时间只允许一个 `soffice` 转换进程运行（`asyncio.Lock`），证书生成频率低，
  未引入任务队列；如后续需要批量生成，需重新评估这里的并发策略。
- 未做鉴权：本服务只应监听内网地址，由 Nest API 单向调用，不对公网暴露。
- 生成的 PDF 当前由 `apps/api` 落盘到本地磁盘，未来接入对象存储时无需改动本服务。
