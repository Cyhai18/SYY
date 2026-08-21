# 用户认证与个人中心 · 实现方案

技术栈：NestJS 11 + Prisma（MySQL）+ React 19 + Vite + Ant Design 6，遵循 `agent.md` 色板与规范。此文档为**方案**，未落地代码，供确认后再实施。

## 1. 数据库设计（Prisma）

```prisma
enum Role {
  USER
  ADMIN
  SUPERADMIN
}

model User {
  id           String   @id @default(uuid())
  phone        String   @unique
  password     String?  // 存 bcrypt 哈希值（字段名 password，内容仍是哈希，非明文），密码登录可选
  email        String?  @unique
  nickname     String   @default("用户")
  avatarUrl    String?
  role         Role     @default(USER)
  status       Int      @default(1) // 1 正常 0 禁用，预留封禁能力
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  actionLogs   ActionLog[]
  refreshTokens RefreshToken[]
}

model ActionLog {
  id        String   @id @default(uuid())
  userId    String?
  action    String   // LOGIN / REGISTER / UPDATE_PROFILE / LOGOUT / SEND_CODE ...
  detail    String?  @db.Text
  ip        String?
  userAgent String?  @db.Text
  createdAt DateTime @default(now())
  user      User?    @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([action])
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String   @unique // 只存哈希，不存明文
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
}
```

- `role` 用枚举而非布尔位，未来加角色只需扩展枚举 + 权限表，不动已有数据。
- **RBAC 扩展预留**：后续如需细粒度权限，可加 `Permission`/`RolePermission` 表，`role` 字段保持不变即可平滑升级为“角色-权限”多对多模型。
- `RefreshToken` 独立建表而非只塞 Cookie，便于登出时吊销、多端管理、审计。

## 2. 注册 / 登录流程

**注册（手机号+验证码）**
1. `POST /api/auth/sms-code` `{ phone, scene: 'register' }` → 生成 6 位码，Redis `sms:register:<phone>` 存 60s 发送频控 + **1 分钟有效期**，调用 `SmsService`（预留阿里云/腾讯云接口，当前 mock 打印日志，你后续提供具体服务商再接入）。
2. `POST /api/auth/register` `{ phone, code, password? }` → 校验验证码 → 创建 `User(role=USER)` → 写 `ActionLog(REGISTER)` → 直接签发双 Token（免二次登录）。

**登录（二选一）**
- `POST /api/auth/login` `{ phone, code }`（验证码登录）
- `POST /api/auth/login` `{ phone, password }`（密码登录，`bcrypt.compare`）
- 成功后：Access Token（JWT，2h，返回体内，前端存内存/Zustand，不落 localStorage）+ Refresh Token（JWT，7d，`Set-Cookie` HttpOnly+Secure+SameSite=Strict）。
- `POST /api/auth/refresh`：校验 Cookie 中 Refresh Token + DB 哈希比对，签发新 Access Token（可选滚动刷新 Refresh）。
- `POST /api/auth/logout`：撤销 DB 中该 Refresh Token 记录 + 清 Cookie。

**密码安全**：`bcrypt` salt rounds 10~12；设置密码/改密码时二次校验旧密码。

**为什么登录态用 Cookie，Cookie 里存的是什么**：
Cookie（HttpOnly + Secure + SameSite=Strict）里存的是 **Refresh Token**，不是 Access Token。原因：
- Access Token 有效期短（2h），每次请求都要带，若也放 Cookie 会被动附带到所有同源请求，扩大 CSRF 面；所以它走响应体，前端手动加到 `Authorization` 头，只存内存。
- Refresh Token 有效期长（7d），一旦泄露风险更大，必须防 JS 读取——这正是 HttpOnly Cookie 的作用（`document.cookie` 读不到，XSS 无法直接窃取）。用 Cookie 承载它，本质是用浏览器原生机制换取"长期凭证不可被脚本访问"，代价是要单独做 CSRF 防护（第 6 节已说明：SameSite=Strict + Origin/自定义头校验）。
- 因此两个 Token 定位不同："短效、每请求都用" 用内存变量；"长效、仅刷新时用" 用 HttpOnly Cookie。

## 3. 后端模块结构

```
apps/api/src/
  auth/
    auth.module.ts / auth.controller.ts / auth.service.ts
    strategies/ (jwt.strategy.ts, jwt-refresh.strategy.ts)
    decorators/public.decorator.ts   // @Public()
    guards/jwt-auth.guard.ts (全局注册，@Public 放行)
    guards/roles.guard.ts + decorators/roles.decorator.ts  // 角色扩展位
  sms/sms.service.ts (interface + mock 实现，接口预留第三方 SDK)
  users/users.module.ts / users.service.ts / users.controller.ts  // 个人中心 CRUD
  common/action-log/action-log.service.ts  // 各处调用记录日志
```

- 全局 `JwtAuthGuard` + `@Public()` 白名单，符合“默认鉴权，显式放行”的安全基线。
- `RolesGuard` 现阶段只做 USER/ADMIN/SUPERADMIN 校验，接口按 `@Roles('ADMIN')` 声明，为后续权限系统打好扩展位。

## 4. 前端路由与状态

```
/login      Public
/register   Public
/profile    Private（RequireAuth 包裹，未登录 → /login，登录后回跳）
/           Private（主控制台，Header 全局展示）
```

- 使用 `react-router-dom` v7，`RequireAuth` 组件读取全局 `AuthStore`（Zustand，含 `accessToken` 内存态 + `user` 信息）。
- App 启动时先 `POST /api/auth/refresh`（走 Cookie）静默续登录态，成功则填充 `AuthStore`，避免刷新页面掉登录。
- Axios/fetch 拦截器：401 → 自动尝试 refresh 一次 → 仍失败则清态跳 `/login`。

**Header 头像下拉**（Ant Design `Dropdown` + 自定义 `menu.items`）：
1. 角色 `Tag`（USER→蓝 "普通用户" / ADMIN→金 "管理员" / SUPERADMIN→红 "超级管理员"）
2. "个人中心" → `navigate('/profile')`
3. "退出登录" → 调 `/api/auth/logout` → 清 `AuthStore` → `navigate('/login')`

## 5. UI 设计（沿用 agent.md Design Token）

Design Read：artifact=表单/后台页；audience=B端税务从业者；visual-language=延续现有清湛蓝科技感；mode=extension；variance 3 / motion 3 / density 6 / brand-fidelity 9。色值复用 `theme.ts` 中 `brandColors`，组件一律 Ant Design，不自绘基础控件。

**登录/注册页原型**（居中卡片，`colorBgLayout` 背景 `#F7F9FC`）：
```
┌───────────────────────────────┐
│      [pc_logo]  FunTax         │
│  ┌───────────────────────┐    │
│  │ Tabs: 密码登录 | 验证码登录│    │
│  │ [手机号 Input]          │    │
│  │ [密码 or 验证码+发送按钮] │    │
│  │ [主色 Button 登录/注册]  │    │
│  │ 没有账号？去注册（链接）  │    │
│  └───────────────────────┘    │
└───────────────────────────────┘
```
卡片圆角 8px（沿用 `borderRadius:8`），阴影轻投影，按钮 `type="primary"` loading 态提交中禁用防重复。

**个人中心原型**（Ant Design `Card` + `Form`，两栏在宽屏并排，移动端单列）：
```
头像（Avatar+更换入口） 昵称
────────────────────────
[昵称 Input]      [保存]
[手机号 Input+验证码校验] [保存]
[邮箱 Input]      [保存]
[原密码][新密码][确认] [保存]
```
每个分组独立表单+独立提交按钮，避免一次提交误改全部字段；修改手机号/密码需二次验证码或旧密码校验。

**全局 Header**：右侧 `Avatar`（无头像显示昵称首字母），点击展开上文 Dropdown。

## 6. 安全性说明

- **XSS**：Access Token 不写 localStorage，仅存内存（Zustand，非持久化），刷新丢失靠 `/refresh` 补齐，降低 XSS 窃取风险。
- **CSRF**：Refresh Token 走 HttpOnly+SameSite=Strict Cookie，配合 `/refresh`、`/logout` 校验 `Origin`/自定义 Header（如 `X-Requested-With`）双重防护。
- **验证码防刷**：同手机号 60s 一次、每日上限、IP 频控（Redis 计数），暂不加图形验证码。
- **日志**：业务操作与系统日志的完整方案见第 7 节。
- **头像**：暂无上传能力，统一用昵称首字母 + 背景色生成占位头像（前端纯展示，不落 DB 图片，`avatarUrl` 为空时前端兜底渲染）。

## 7. 日志体系全局设计

目标：不仅是"谁在什么时候改了什么"的审计，还要覆盖**系统报错、异常告警、问题排查**，三类日志需求本质不同，不能都塞进一张表，按"记什么 / 存哪 / 谁来查 / 怎么关联"拆成三层：

### 7.1 三层日志分类

| 层 | 内容 | 产生方式 | 存储 | 使用者 |
| --- | --- | --- | --- | --- |
| **业务审计日志**（沿用 `ActionLog`） | 登录/注册/改资料/登出/改密码等**业务语义**动作，"谁+做了什么+结果" | 业务 Service 显式调用 `ActionLogService.record()`，或用 `@Audit('UPDATE_PROFILE')` 装饰器 + `AuditInterceptor` 自动记录 | MySQL（结构化、可查询、长期保留） | 产品/运营/管理员在后台查"操作记录" |
| **应用运行日志**（新增） | 每次请求的进入/退出、耗时、参数摘要、警告、未捕获异常堆栈——**技术视角**，不关心业务语义 | 全局 `LoggerModule`（推荐 `nestjs-pino`）替换 Nest 默认 Logger；`LoggingInterceptor` 记请求级日志；`AllExceptionsFilter` 记异常级日志 | 结构化 JSON，输出到 stdout（容器场景）或按天滚动的本地文件（`pino/file` + `logrotate`），**不进 MySQL 业务库** | 开发排查问题、后续接入日志平台（如自建 Loki+Grafana，或 ELK） |
| **告警**（新增，MVP 阶段轻量实现） | 从运行日志中筛出 `error`/`fatal` 级别，触发通知 | 异常过滤器统一出口：先打 error 日志，再（可选）上报 Sentry / 发飞书机器人 Webhook | 不单独存储，依赖运行日志 + 第三方告警渠道 | 值班/开发人员 |

### 7.2 关联三层日志：requestId

问题排查最痛的是"业务日志说改资料失败了，但不知道具体哪次请求报的什么错"。方案：

- 全局中间件生成 `requestId`（`nanoid`），写入 `AsyncLocalStorage`（Nest 用 `nestjs-cls` 或手写 `RequestContext`），并回写到响应头 `X-Request-Id`。
- **应用运行日志**每条自动带 `requestId` + `userId`（已登录时）。
- **业务审计日志**新增 `requestId` 字段（`ActionLog.requestId String?`），写入时从上下文取。
- 排查流程：前端报错拿到 `X-Request-Id` → 在运行日志里按 `requestId` 搜到完整堆栈 → 同 `requestId` 能反查 `ActionLog` 里当时触发的业务动作。

对第 1 节 `ActionLog` 模型的增量：
```prisma
model ActionLog {
  // ...原字段不变
  requestId String?
  @@index([requestId])
}
```

### 7.3 落地方式（MVP，控制复杂度）

- 依赖：`nestjs-pino`（Nest 官方推荐的结构化日志方案，自动集成 `requestId`、耗时、状态码）。
- `LoggingInterceptor`：记录每个请求的 `method/url/status/duration/requestId/userId`，`info` 级别。
- `AllExceptionsFilter`（全局异常过滤器）：捕获所有未处理异常，`error` 级别打印堆栈 + 上下文，同时把这次异常写一条 `ActionLog(action='SYSTEM_ERROR')`（可选，取决于是否要在后台"操作记录"里也能看到系统级失败）。
- 敏感字段脱敏：`password`/`code`/`token` 等字段在日志序列化前统一用正则/白名单过滤，防止明文进日志。
- **告警**：MVP 先接 `error` 级别 → 控制台可见 + 预留 Sentry DSN 配置位（不强制立刻接），后续量大了再考虑日志平台阈值告警。
- 日志文件按天滚动 + 保留 30 天（本地磁盘场景），生产如上云可直接把 stdout 交给容器平台（如 K8s + Loki）采集，无需改代码。

### 7.4 为什么不把系统日志也写 MySQL

- 量级不对等：一次请求的运行日志（含 debug 明细）远多于一次业务动作，塞进业务库会拖慢查询、膨胀存储。
- 用途不同：运行日志是"最近这段时间发生了什么"，天然适合滚动保留、按时间检索的日志系统；业务审计日志是"历史上这个用户做过什么"，需要长期保留、结构化查询、和业务表关联，适合放关系库。
- 两者用 `requestId` 串联即可满足排查诉求，不需要合并存储。

## 8. 待确认事项（已收敛）
1. 数据库以现有 `schema.prisma`（MySQL）为准，短信服务商暂用 mock，接入哪家（阿里云/腾讯云）你后续提供。
2. ~~是否接入 Sentry~~ → 已确认：**现阶段不接 Sentry**，第 7.3 节告警部分仅做本地结构化日志（`nestjs-pino` + error 级堆栈），Sentry DSN 配置位保留但不启用，后续视量级/需求再评估接入。

方案已确认，接下来按此文档分模块实现：DB migration（含 `password` 改名、`RefreshToken`、`ActionLog.requestId`）→ 后端 `Logging`（`nestjs-pino` + requestId + 异常过滤器）→ `Auth`/`Users` 模块 → 前端路由与页面。
