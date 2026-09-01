# 授权证书生成 - 技术实现方案

## 一、整体架构

```
apps/web (生成证书按钮)
   │  POST /clients/:id/certificates  { agentInfoId }
   ▼
apps/api (NestJS)
   │  1. 按 agentInfoId 查出 Client+CompanyInfo+LegalRepresentative+Shop+Product 数据
   │  2. 组装成结构化 JSON（字段命名对应模板占位符）
   │  3. HTTP POST 转发给 doc-service
   ▼
services/doc-service (FastAPI, 新建)
   │  1. 按 templateKey（=agentCompany 枚举值）选中对应 .docx 模板
   │  2. docxtpl 渲染占位符 + 表格循环（shops/products）
   │  3. subprocess 调 soffice --headless 转 PDF
   │  4. 返回 PDF 二进制
   ▼
apps/api 透传 PDF → apps/web 触发下载
```

选择新建独立 Python 微服务（而非在 apps/api 内直接调用 LibreOffice）的原因：
- 与现有 `services/ocr-service` 架构风格一致，团队已熟悉这套部署模式；
- LibreOffice 重依赖与主业务服务解耦，`apps/api` 镜像保持轻量；
- Python 的 `docxtpl`（基于 Jinja2）比 Node 生态更适合做模板字段填充与表格循环；
- 后续如需异步队列、批量生成、多模板管理，独立服务扩展更自然。

## 二、数据模型改动

在 `apps/api/prisma/schema.prisma` 新增字段（一起走一次 migration）：

- `Shop.shopId String?` — 用户手填的"店铺ID"，区别于主键 `id`
- `Product.productNameCn String?` — 产品中文名称
- `AgentInfo.agreementNumber String?` — Agreement Number，先固定写入 `"12345"`，后续规则确定后再调整生成逻辑

## 三、字段映射表（Client 数据 → 模板占位符）

| 模板占位符 | 数据来源 |
|---|---|
| `agreement_number` | `AgentInfo.agreementNumber`（先固定 "12345"） |
| `valid_from` / `valid_to` | `AgentInfo.expectedEffectiveDate` / `expiresAt`（格式化 `YYYY/MM/DD`；中文"年月日"另切分 `year`/`month`/`day` 变量） |
| `party_a_name` | `clientType===COMPANY ? CompanyInfo.nameEn : 个人姓名拼音`（当前需求仅覆盖公司英文名场景，个人分支留 TODO） |
| `party_a_address` | `CompanyInfo.addressEn` |
| `party_a_zip` | `CompanyInfo.postalCode` |
| `contact_person` | `LegalRepresentative.surnamePinyin + givenNamePinyin` |
| `tel` | `Client.phone` |
| `email` | `Client.email` |
| `shops`（表格循环，≤5） | 该 `AgentInfo` 所属 `Shop`（一个 AgentInfo 对应一个 Shop）：`platform`/`shopUrl`/`shopId`/`shopName`/`brandNames` |
| `products`（嵌套循环，每店铺≤5） | `Shop.products[]`：`productNameCn`/`productName`(英文) |

> 一份证书对应一个 `AgentInfo`（= 一个店铺 + 一个代理公司/国家的组合），因此生成入口是"针对某条 agentInfo 生成"，不是整个客户。

## 四、doc-service（新服务）设计

```
services/doc-service/
  app.py                 # FastAPI 入口
  templates/
    OVERSEA_WALKERS_GB.docx
    OVERSEA_WALKERS_EU.docx
    EU_CONSULTEN_SRLS.docx
    OVERSEA_WALKERS_US.docx
    OVERSEA_WALKERS_TR.docx
  requirements.txt        # fastapi, uvicorn, docxtpl, python-multipart
  README.md
```

接口：

```
POST /certificate/generate
Body: { "templateKey": "OVERSEA_WALKERS_GB", "data": { ...上表字段, "shops": [...] } }
Response: application/pdf (binary stream)
```

内部流程：
1. `templateKey` 映射到 `templates/{key}.docx`，找不到返回 404。
2. `docxtpl.DocxTemplate(path).render(data)` 生成临时 docx（写到临时目录）。
3. `subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", tmp_dir, docx_path])`。
4. 读取生成的 PDF 返回，`finally` 清理临时文件。
5. 加简单信号量/锁（如 `asyncio.Lock`），避免并发请求同时调用 `soffice` 冲突；证书生成频率低，无需引入重型任务队列。

## 五、apps/api 改动

- 新增 `CertificateModule`：
  - `CertificateController`：`POST /clients/:clientId/agent-infos/:agentInfoId/certificate`
  - `CertificateService`：查数据 → 组装 JSON → 调用 `DOC_SERVICE_URL + /certificate/generate` → 将响应流透传给前端（`Content-Type: application/pdf`）
- `.env` 新增 `DOC_SERVICE_URL=http://127.0.0.1:8001`，参照现有 `OCR_SERVICE_URL` 的降级模式：调用失败时报错提示，不阻断其他流程。

## 六、apps/web 改动

- 在客户向导（`ClientWizardPage`）新增"生成证书"临时测试按钮（mock 验证阶段）。
- 触发规则（哪个 agentInfo、是否需要客户先入库）待后续规划，先固定用第一个店铺的第一条 `agentInfo` 跑通链路。
- 拿到 PDF 二进制后 `URL.createObjectURL` + `<a download>` 触发浏览器下载。

## 七、开发顺序

1. Schema：加 `Shop.shopId` / `Product.productNameCn` / `AgentInfo.agreementNumber` + migration（不依赖模板文件，可先行）。
2. 整理 5 个 `.docx` 模板（占位符按上表命名，含表格循环语法），放入 `services/doc-service/templates/`。
3. 搭建 `services/doc-service` 骨架，先用 1 个模板 + mock JSON 跑通"渲染 + 转 PDF"。
4. 打通 `apps/api` → `doc-service` 调用链。
5. `apps/web` 加测试按钮，端到端验证一次。
6. 后续再规划正式触发规则、附件归档等交互细节。

## 八、待确认的遗留问题

- 生成证书的正式触发规则（是否要求客户已入库、是否支持多份/打包下载）。
- 生成结果是否需要作为 `Attachment` 落库归档。
- 个人客户（`clientType===INDIVIDUAL`）对应的 `party_a_name` 取值规则。
