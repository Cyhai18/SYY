# FunTax Agent Notes

跨境卖家税务 SaaS。当前只搭骨架：可访问的 Web index + API 健康检查。鉴权、客户画像、税引擎未实现。

## 架构决策

| 项     | 选择                                                 | 原因                                                                     |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| 后端   | NestJS 11 + TypeScript                               | 与前端同语言，模块边界清晰，后续 BullMQ / Prisma 接入成本低              |
| 前端   | React 19 + Vite + Ant Design 6                       | 税务后台用 Ant Design 组件，禁止自绘 Button/Input/Table                  |
| CSS    | 原生 CSS + hex token（antd 不支持 oklch seed token） | MVP 不用 Tailwind                                                        |
| 数据库 | PostgreSQL 16 + Prisma 7（已接入客户端，未建表）     | JSONB 适配多国申报字段；强一致性；Prisma 类型安全 + 迁移体验优于 TypeORM |
| 队列   | Redis + BullMQ（未接入）                             | 第三方申报异步任务                                                       |
| 仓库   | pnpm + Turborepo                                     | `apps/web`、`apps/api`、`packages/shared`                                |
| 鉴权   | JWT access + HttpOnly refresh（未实现）              | 邮箱密码登录；预留 MFA                                                   |

工作区：

- `apps/web`：Vite 5173，`/api` 代理到 3000
- `apps/api`：Nest 3000，`GET /api/health`
- `packages/shared`：跨端常量与类型
- `design/`：Logo 与色板源文件

Nest watch 注意：`deleteOutDir` 必须为 `false`，否则增量编译会清空 `dist`，导致 `Cannot find module dist/main`。

## 数据库（Prisma）

- `apps/api/prisma/schema.prisma`：数据模型定义，当前无业务表。
- `apps/api/prisma.config.ts`：读取 `DATABASE_URL`（`dotenv/config`）。
- `apps/api/src/prisma/`：`PrismaModule`（`@Global`）+ `PrismaService`，已注入 `AppModule`。
- `apps/api/.env`：本地真实连接串（已在 `.gitignore`，不提交）；`apps/api/.env.example` 为占位模板，默认 `postgres:postgres@localhost:5432/funtax`，需按本地实际情况修改。
- 常用命令：`pnpm --filter @funtax/api prisma:generate` / `prisma:migrate` / `prisma:studio`。
- 尚未建表，需先起本地 PostgreSQL 服务并核对 `.env` 再执行 `prisma migrate dev`。

## 设计 Token（hex，以 `docs/message.md` 表格为准）

> ⚠️ **重要坑点**：antd v6 用 `@ant-design/fast-color` 做主题算法（`colorPrimary` 等 seed token 的 hover/active/bg 派生色计算），**不支持解析 `oklch(...)` 这类 CSS 颜色函数字符串**（官方 issue [ant-design/ant-design#48698](https://github.com/ant-design/ant-design/issues/48698)）。把 oklch 字符串传给 `ConfigProvider theme.token` 会导致派生失败，按钮/Alert/Tag 等组件背景色会错误地渲染成黑灰色（文字色因为是直接赋值，反而看起来正常，容易误判）。
>
> 因此：**`apps/web/src/theme.ts` 里喂给 antd 的 token 必须是 hex（或 rgb/hsl），禁止用 oklch 字符串**。`apps/web/src/index.css` 里的纯 CSS 变量本可以用 oklch（浏览器原生支持），但为了和 `docs/message.md` 的色值表保持单一事实来源、避免后续再次引入 antd 不兼容的写法，也统一改成了 hex。**agent.md 与 docs/message.md 的色值如有出入，以 `docs/message.md` 为准。**

| 角色            | Token     | 业务命名（`docs/message.md`）                  | antd `theme.token`          | antd 官方角色定义                               |
| --------------- | --------- | ---------------------------------------------- | --------------------------- | ----------------------------------------------- |
| 主色·清湛蓝     | `#2563C9` | Logo、主按钮、导航栏、核心操作                 | `colorPrimary`              | 品牌主色，派生按钮/链接/选中态等全套主色梯度    |
| 辅助色·浅蓝科技 | `#4FC3F7` | 渐变、图标、信息卡片、次要按钮                 | `colorInfo`                 | 信息类提示色，Alert/Tag/Progress 等信息态使用   |
| 强调色·暖浅金   | `#F2BC4F` | 收益、提醒、高亮、税务成功提示（不作大面积底） | `colorHighlight`            | 引起用户强关注的背景色（目前仅 Tooltip 背景用） |
| 背景色·云白灰   | `#F7F9FC` | 后台页面、官网浅色背景                         | `colorBgLayout`             | 页面整体布局背景色（B1 视觉层级）               |
| 标题色·深墨灰   | `#1D2939` | 页面标题、重要信息                             | `colorTextBase`/`colorText` | 文本色派生基础 / 默认文本色                     |
| 正文色·中性灰   | `#667085` | 说明文字、次级信息                             | `colorTextSecondary`        | 次级文本色（Label、次要说明）                   |
| 成功色·青绿蓝   | `#12B76A` | 申报成功、核算完成、通过状态                   | `colorSuccess`              | 操作成功语义色                                  |
| 警示色·橙色     | `#F79009` | 待处理、风险提示、预警状态                     | `colorWarning`              | 操作警告语义色                                  |

**接入原则**：给 antd `theme.token` 配色时，按 token 的**官方角色定义**去匹配（例如 `colorHighlight` = "强关注背景色"），而不是按业务命名字面意思（"收益/提醒/税务成功提示"）去找同名 token——antd 没有 `colorAccent`，业务命名只是本项目内部叫法，实际落地时以 [Design Token 文档](https://ant.design/docs/react/customize-theme) 里每个 token 的语义描述为准。

映射：`apps/web/src/theme.ts`（Ant Design token，hex）与 `apps/web/src/index.css`（CSS 变量，hex）。字体：IBM Plex Sans + Noto Sans SC。Logo：`@brand/pc_logo.jpg` / `@brand/mobile_logo.jpg`。

Design Read：variance 3 / motion 3 / density 8 / brand-fidelity 9。左侧导航 + 顶栏后续再加，本页只做 index。

## API 契约

```
GET /api/health
{
  "status": "ok" | "degraded",
  "service": "api",
  "timestamp": "<ISO-8601>"
}
```

类型以 `@funtax/shared` 的 `HealthResponse` 为准。后续业务接口统一 `/api` 前缀。

## 本地启动

```bash
pnpm install
pnpm dev
```

- Web：http://localhost:5173
- API：http://localhost:3000/api/health

工程化：Prettier + ESLint + Husky `pre-commit`（lint-staged）。Git 仓库已初始化。

## 后续开发指南

1. 核对/替换 `apps/api/.env` 中的数据库连接信息，起本地 PostgreSQL，跑 `prisma migrate dev` 建表。
2. 设计业务数据模型（客户、税务主体等），再做 JWT 鉴权。
3. 客户/税务主体 CRUD；税引擎与真实申报只留接口。
4. 首批国家默认：DE / GB / JP；数据手填 + CSV 占位。
5. 产品是核算与报送工具，不是税务意见；界面需免责声明。
6. UI 只用 Ant Design；新色值统一写 hex（禁止把 oklch 字符串传给 antd `theme.token`，见上方“重要坑点”），且色值以 `docs/message.md` 表格为准；同时禁止 Inter / 紫粉渐变 / 左色条卡片。
