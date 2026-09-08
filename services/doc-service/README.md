# FunTax Doc Service（授权证书生成微服务）

见 `docs/certificate-generation-design.md` 整体方案，转 PDF 部分的技术选型见
`docs/doc-service-html-weasyprint-poc.md`。这是一个独立的 Python/FastAPI 服务，负责用
`docxtpl`（基于 Jinja2）渲染授权证书 `.docx` 模板占位符与表格循环（shops），再调用
Gotenberg（基于 LibreOffice 的文档转换 HTTP 微服务）转换为 PDF 并返回二进制流。

## 依赖 Gotenberg

本服务通过 HTTP 调用 Gotenberg 做 docx → PDF 转换，不再需要本机安装 LibreOffice/`soffice`。

本地启动 Gotenberg（Docker）：

```bash
docker run -d --name gotenberg --restart unless-stopped -p 3010:3000 gotenberg/gotenberg:8
```

通过环境变量 `GOTENBERG_URL` 指定地址，默认值为 `http://localhost:3010`；如本机 3010
端口已被占用，可将容器映射到其他端口后通过该环境变量指定，例如
`GOTENBERG_URL=http://localhost:3300`。

与 `apps/api` 一致，环境变量维护在 `.env` 文件里（参考 `.env.example`），不写进代码/命令行：

```bash
cd services/doc-service
cp .env.example .env
# 按本机实际情况修改 .env 里的 GOTENBERG_URL（如端口被占用）
```

`uvicorn[standard]` 自带 `python-dotenv`，启动时加 `--env-file .env` 即可自动加载，
不需要额外安装依赖或在 `app.py` 里手写加载逻辑。

## 本地启动（首次）

```bash
cd services/doc-service
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # 按本机实际情况修改 GOTENBERG_URL
uvicorn app:app --host 0.0.0.0 --port 8001 --env-file .env
```

## 日常启动

```bash
cd services/doc-service
source .venv/bin/activate
uvicorn app:app --reload --port 8001 --env-file .env
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

- 并发与健康检查由 Gotenberg 内部管理，本服务不再自行维护转换进程锁/重启逻辑；如后续需要
  批量生成（如 200 份证书），可评估提升 Gotenberg 容器的资源配额或并发实例数。
- 未做鉴权：本服务只应监听内网地址，由 Nest API 单向调用，不对公网暴露。
- 生成的 PDF 当前由 `apps/api` 落盘到本地磁盘，未来接入对象存储时无需改动本服务。
