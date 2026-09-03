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

## 二、新增数据表：Certificate（生成记录 / 归档 / 编号计数）

`Agreement Number` 要求"当天生成的第几份"精确递增且不能因并发重复，同时第八节遗留问题"生成结果是否需要归档"在此一并解决：新增 `Certificate` 表，每次成功生成一份证书就落一行记录。

```prisma
model Certificate {
  id              String    @id @default(uuid())
  agentInfoId     String
  agreementNumber String    @unique          // 2026-09-03-0005
  fileUrl         String?   @db.Text         // 生成的 PDF 本地磁盘存储路径，后续接入对象存储后改存 URL
  generatedById   String?                    // 操作人
  agentInfo       AgentInfo @relation(fields: [agentInfoId], references: [id], onDelete: Cascade)
  generatedBy     User?     @relation(fields: [generatedById], references: [id])
  createdAt       DateTime  @default(now())

  @@index([agentInfoId])
  @@index([createdAt])
}
```

**编号生成的并发安全方案**：不用"先 COUNT 再 +1"（有竞态），改为按天维护一张计数表，用 MySQL `INSERT ... ON DUPLICATE KEY UPDATE seq = seq + 1` 原子自增后读回：

```prisma
model CertificateDailyCounter {
  day String @id            // "2026-09-03"
  seq Int    @default(0)
}
```

`CertificateService` 生成流程：
1. 原子自增当天计数器，拿到 `seq`（不足 4 位补零）；
2. 拼出 `agreementNumber = "${today}-${String(seq).padStart(4, '0')}"`；
3. 组装模板数据 → 调 doc-service 渲染 PDF；
4. 渲染成功后，在同一事务里写入 `Certificate` 行（`agreementNumber` 唯一约束兜底防重复）；渲染失败则回滚计数器自增。

## 三、字段映射表（Client 数据 → 模板占位符）

> 一份证书对应一个 `AgentInfo`（= 一个代理公司/国家的组合，可覆盖多个店铺），因此生成入口是"针对某条 agentInfo 生成"，不是整个客户。

按当前 6 个模板（`apps/api/template/`，对应 `AgentCompany` 枚举）逐一核对高亮字段后，统一映射如下：

| 模板占位符（高亮内容） | 数据来源 | 取值/格式说明 |
|---|---|---|
| Agreement Number | `Certificate.agreementNumber` | 见第二节，生成时确定，不由用户填写 |
| 有效期（英文段） | `AgentInfo.expectedEffectiveDate` + `expiresAt` | `YYYY/MM/DD to YYYY/MM/DD` |
| 有效期（中文段） | 同上 | `YYYY年MM月DD日至YYYY年MM月DD日` |
| Name (中文名称) | `clientType===COMPANY` → `CompanyInfo.nameCn`；`INDIVIDUAL` → `LegalRepresentative.nameCn` | |
| Name (英文名称) | `COMPANY` → `CompanyInfo.nameEn`；`INDIVIDUAL` → `LegalRepresentative.namePinyin` | 个人客户没有独立英文名字段，用拼音充当 |
| Add(中文地址) | `COMPANY` → `CompanyInfo.addressCn`；`INDIVIDUAL` → `LegalRepresentative.idAddressCn` | |
| Add(英文地址) | `COMPANY` → `CompanyInfo.addressEn`；`INDIVIDUAL` → `LegalRepresentative.idAddressEn` | |
| Zip Code(邮编) | `COMPANY` → `CompanyInfo.postalCode`；`INDIVIDUAL` → `LegalRepresentative.idPostalCode` | |
| Contact Person（联系人） | `LegalRepresentative.namePinyin` | 不分客户类型，固定取法人拼音姓名 |
| Tel(联系电话) | `Client.phone` | |
| E-mail (邮箱) | `Client.email` | |
| PARTY A（落款） | 同"Name (英文名称)" | |
| Date（落款日期） | `AgentInfo.expectedEffectiveDate` | 格式同模板样例 `2026/09/18` |
| 店铺信息表格（每行一个 Shop） | `Shop.platform`（枚举转文案）/`shopUrl`/`shopId`/`shopName`/`brandNames` | 直接取值 |
| 产品名称（中文）单元格 | 该 `Shop` 下所有 `Product.productNameCn` | 用"、"拼接（对齐模板原有示例格式，如"衣服、鞋子、内裤"） |
| 产品名称（英文）单元格 | 该 `Shop` 下所有 `Product.productNameEn` | 用", "拼接（对齐模板原有示例格式，如"Clothes, shoes, underwear"） |

Party B（代理公司自身信息：名称/地址/邮编/邮箱/电话/联系人）是模板里未高亮的固定文案，随模板走，不需要从数据库取值，doc-service 不用管这部分。

## 四、模板改造方案（`apps/api/template/*.docx` → docxtpl 占位符）

现有 6 份模板里高亮黄底的内容，统一替换为 Jinja2 占位符（由我批量处理，替换时保留原有字体/字号/颜色等 run 格式，**同时去掉黄色高亮底色**，只替换文字内容，不改变其余排版）：

| 高亮原文（示例） | 替换为 |
|---|---|
| `2026-08-20-0009` | `{{ agreement_number }}` |
| `2026/09/18 to 2027/09/17` | `{{ effective_range_en }}` |
| `2026年09月18日至 2027年09月17日` | `{{ effective_range_cn }}` |
| Name (中文名称) 内容 | `{{ party_a_name_cn }}` |
| Name (英文名称) 内容 | `{{ party_a_name_en }}` |
| Add(中文地址) 内容 | `{{ party_a_address_cn }}` |
| Add(英文地址) 内容 | `{{ party_a_address_en }}` |
| Zip Code(邮编) 内容 | `{{ party_a_zip }}` |
| Contact Person 内容 | `{{ party_a_contact }}` |
| Tel 内容 | `{{ party_a_tel }}` |
| E-mail 内容 | `{{ party_a_email }}` |
| PARTY A 落款内容 | `{{ party_a_name_en }}`（复用同一变量，无需重复传参） |
| Date 落款内容 | `{{ signing_date }}` |
| 店铺信息表格（数据行，`docxtpl` 表格循环语法） | 整行替换为 `{%tr for s in shops %}` ... `{{ s.platform }}` / `{{ s.shop_url }}` / `{{ s.shop_id }}` / `{{ s.shop_name }}` / `{{ s.brand_names }}` / `{{ s.product_names_cn }}` / `{{ s.product_names_en }}` ... `{%tr endfor %}` |

所有 6 个模板占位符命名保持完全一致（`agreement_number`/`party_a_*`/`effective_range_*`/`signing_date`/`shops` 循环字段），doc-service 只需一套渲染数据结构即可适配全部模板，无需按 `templateKey` 做字段差异处理。Party B 相关内容（代理公司自身信息）不动，保留各模板原文固定文案。

## 五、doc-service（新服务）设计

```
services/doc-service/
  app.py                 # FastAPI 入口
  templates/             # 由 apps/api/template/*.docx 复制/同步过来（占位符已替换）
    OVERSEA_WALKERS_GB.docx
    OVERSEA_WALKERS_EU.docx
    EU_CONSULTEN_SRLS.docx
    OVERSEA_WALKERS_US.docx
    OVERSEA_WALKERS_TR.docx
    OVERSEA_WALKERS_CA.docx
  requirements.txt        # fastapi, uvicorn, docxtpl, python-multipart
  README.md
```

接口：

```
POST /certificate/generate
Body: {
  "templateKey": "OVERSEA_WALKERS_GB",   // = AgentCompany 枚举值
  "data": {
    "agreement_number": "2026-09-03-0005",
    "effective_range_en": "2026/09/18 to 2027/09/17",
    "effective_range_cn": "2026年09月18日至2027年09月17日",
    "party_a_name_cn": "...", "party_a_name_en": "...",
    "party_a_address_cn": "...", "party_a_address_en": "...",
    "party_a_zip": "...", "party_a_contact": "...",
    "party_a_tel": "...", "party_a_email": "...",
    "signing_date": "2026/09/18",
    "shops": [
      { "platform": "TEMU", "shop_url": "...", "shop_id": "...", "shop_name": "...",
        "brand_names": "...", "product_names_cn": "衣服、鞋子", "product_names_en": "Clothes, shoes" }
    ]
  }
}
Response: application/pdf (binary stream)
```

内部流程：
1. `templateKey` 映射到 `templates/{key}.docx`，找不到返回 404。
2. `docxtpl.DocxTemplate(path).render(data)` 生成临时 docx（写到临时目录）。
3. `subprocess.run(["soffice", "--headless", "-env:UserInstallation=file:///tmp/lo_<uuid>", "--convert-to", "pdf", "--outdir", tmp_dir, docx_path], timeout=30)`：每次用独立 profile 目录，避免锁文件冲突/僵死进程互相影响。
4. 读取生成的 PDF 返回，`finally` 清理临时文件（docx 中间产物 + 独立 profile 目录）。
5. 加简单信号量/锁（如 `asyncio.Lock`），避免并发请求同时调用 `soffice` 冲突；证书生成频率低，无需引入重型任务队列。
6. 镜像需装中文字体（如 `fonts-noto-cjk`），否则转 PDF 后中文内容显示为方框。

## 六、apps/api 改动

- Schema 新增 `Certificate`、`CertificateDailyCounter`（见第二节）。
- 新增 `CertificateModule`：
  - `CertificateController`：`POST /agent-infos/:agentInfoId/certificate`（`AgentInfo` 已通过 `clientId` 关联 `Client`，无需再嵌一层 `clientId` 路径；权限校验时按 `agentInfo.client.ownerId` 过滤）。
  - `CertificateService`：
    1. 按 `agentInfoId` 查出 `AgentInfo` + `client(companyInfo, legalRepInfo)` + `shops(products)`；
    2. 按 `client.clientType` 分支取 `party_a_*` 字段（第三节映射表）；
    3. 计算 `effective_range_*`、`signing_date`；
    4. 原子生成 `agreement_number`（第二节流程）；
    5. 组装 `shops[]`（每个 shop 的 `product_names_cn/en` 用"、"/", " 拼接）；
    6. 调用 `DOC_SERVICE_URL + /certificate/generate`，`templateKey = agentInfo.agentCompany`；
    7. 拿到 doc-service 返回的 PDF 二进制后，先写入本地磁盘（如 `apps/api/uploads/certificates/{agreementNumber}.pdf`，目录不纳入 git，参照现有上传目录约定），`fileUrl` 存相对路径；
    8. 写入 `Certificate` 行，再将 PDF 流透传给前端（`Content-Type: application/pdf`）。
- `.env` 新增 `DOC_SERVICE_URL=http://127.0.0.1:8001`，参照现有 `OCR_SERVICE_URL` 的降级模式：调用失败时报错提示，不阻断其他流程。
- 本地磁盘存储只是过渡方案，后续接入对象存储时只需替换步骤 7 的落盘逻辑，`Certificate.fileUrl` 字段结构不变。

## 七、apps/web 改动

- 在客户详情页的每条 `AgentInfo` 上新增"生成证书"按钮（而非固定用第一条），触发对应 `agentInfoId` 的生成请求。
- 拿到 PDF 二进制后 `URL.createObjectURL` + `<a download>` 触发浏览器下载；文件名建议用 `${agreement_number}.pdf`。
- 证书生成记录（`Certificate` 列表）可选在详情页展示历史生成记录，不阻塞本期上线。

## 八、开发顺序

1. Schema：新增 `Certificate` / `CertificateDailyCounter` + migration（不依赖模板文件，可先行）。
2. 我批量处理 `apps/api/template/*.docx`，把高亮字段替换为第四节的 Jinja2 占位符，同步放入 `services/doc-service/templates/`。
3. 搭建 `services/doc-service` 骨架，用 1 个模板 + mock JSON 跑通"渲染 + 转 PDF"。
4. 实现 `CertificateModule`（编号生成、字段组装、调用 doc-service、落库 `Certificate`）。
5. `apps/web` 加"生成证书"按钮，端到端验证一次（含中文字符 PDF 渲染是否正常）。
6. 后续按需规划：证书历史列表展示、多份打包下载等交互细节。

## 九、待确认的遗留问题

- 证书生成是否需要与 `Attachment` 表打通（如需要在客户详情"附件"里统一展示，需要在 `AttachmentType` 新增 `CERTIFICATE` 枚举值）——**待定**。
