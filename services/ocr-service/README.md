# FunTax OCR Service（RapidOCR 微服务）

见 `docs/client-profile-design.md` 第 3 节整体方案。这是一个独立的 Python/FastAPI 服务，
负责调用 RapidOCR 做文字识别，并在 `parsers.py` 中完成营业执照/身份证结构化字段的
标签定位、正则匹配与校验位算法校验；Nest 侧只做字段名 snake_case 到 camelCase 的映射，
不重复维护规则。

## 本地启动（首次）

要求 Python 3.9+（建议用独立虚拟环境，避免和系统 Python 冲突）。

```bash
cd services/ocr-service
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt  # 首次安装较慢（含 ONNXRuntime 推理引擎）
uvicorn app:app --host 0.0.0.0 --port 8000
```

首次调用识别接口时会自动下载 RapidOCR 中文识别模型到本地缓存目录（需联网），下载完成后
后续启动直接复用缓存，无需重复下载。

## 日常启动

已装好依赖后，日常开发只需：

```bash
cd services/ocr-service
source .venv/bin/activate
uvicorn app:app --reload --port 8000
```

## 接入 Nest API

在 `apps/api/.env` 增加：

```
OCR_SERVICE_URL=http://127.0.0.1:8000
```

重启 `apps/api` 进程后，OCR provider 会自动调用本服务；未配置或本服务未启动时，
OCR 接口优雅降级为"未识别"，不影响客户新增向导的其余流程。

## 接口

```
GET  /health                                健康检查
POST /recognize  (multipart: file, doc_type=business_license|id_card_front|id_card_back)
                                             → { docType, fields: {...}, rawText: string[] }
```

`doc_type` 用于区分证照类型，三者共用同一套通用文字识别逻辑，再各自按 `doc_type` 调用
`parsers.py` 里的规则提取结构化字段：

- `business_license` → `credit_code`（统一社会信用代码，含校验位纠错）、`name`、`address`、`legal_person`
- `id_card_front` → `name`、`id_number`（含校验位校验）、`address`
- `id_card_back` → 暂不提取字段

识别前会做图像预处理：灰度 CLAHE 对比度增强 + Hough 直线检测纠偏 + 多帧
（原图/增强图/纠偏图）识别取并集去重，用于提升手机翻拍件的召回率。

## 已知限制 / 后续优化方向

- 当前用 RapidOCR 通用文字识别 + `parsers.py` 规则提取，未接入专用结构化产线，
  版式差异较大的证件图片可能提取失败。
- CPU 推理，首次请求加载模型较慢（几秒到十几秒），生产部署建议服务启动后主动打一次
  健康检查+空转请求做预热，避免首个真实用户请求超时。
- 未做鉴权：本服务只应监听内网地址，由 Nest API 单向调用，不对公网暴露（见部署方案第 6 节）。
