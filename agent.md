# FunTax Agent Notes

跨境卖家税务 SaaS。当前只搭骨架：可访问的 Web index + API 健康检查。鉴权、客户画像、税引擎未实现。

## 架构决策

| 项 | 选择 | 原因 |
|---|---|---|
| 后端 | NestJS 11 + TypeScript | 与前端同语言，模块边界清晰，后续 BullMQ / Prisma 接入成本低 |
| 前端 | React 19 + Vite + Ant Design 6 | 税务后台用 Ant Design 组件，禁止自绘 Button/Input/Table |
| CSS | 原生 CSS + oklch token | MVP 不用 Tailwind |
| 数据库 | PostgreSQL 16（未接入） | JSONB 适配多国申报字段；强一致性 |
| 队列 | Redis + BullMQ（未接入） | 第三方申报异步任务 |
| 仓库 | pnpm + Turborepo | `apps/web`、`apps/api`、`packages/shared` |
| 鉴权 | JWT access + HttpOnly refresh（未实现） | 邮箱密码登录；预留 MFA |

工作区：

- `apps/web`：Vite 5173，`/api` 代理到 3000
- `apps/api`：Nest 3000，`GET /api/health`
- `packages/shared`：跨端常量与类型
- `design/`：Logo 与色板源文件

Nest watch 注意：`deleteOutDir` 必须为 `false`，否则增量编译会清空 `dist`，导致 `Cannot find module dist/main`。

## 设计 Token（oklch）

| 角色 | Token | 用途 |
|---|---|---|
| 清湛蓝 | `oklch(51.93% 0.1712 260)` | 主色、导航、主按钮 |
| 浅空青 | `oklch(77.26% 0.1268 231.1)` | 信息、辅助强调 |
| 暖浅金 | `oklch(82.45% 0.1384 82.1)` | 收益/成功高亮，不作大面积底 |
| 纸白 | `oklch(98.14% 0.0045 258.3)` | 页面底 |
| 墨色 | `oklch(27.76% 0.0341 255.8)` | 标题 |
| 灰字 | `oklch(54.44% 0.035 265.1)` | 正文 |
| 成功绿 | `oklch(68.59% 0.1667 154.9)` | 完成、通过 |
| 预警橙 | `oklch(74.69% 0.1701 62.1)` | 待处理、风险 |

映射：`apps/web/src/theme.ts`（Ant Design token）与 `apps/web/src/index.css`（CSS 变量）。字体：IBM Plex Sans + Noto Sans SC。Logo：`@brand/pc_logo.jpg` / `@brand/mobile_logo.jpg`。

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

工程化：Prettier + ESLint + Husky `pre-commit`（lint-staged）。仓库尚未 `git init` 时 `prepare` 会提示 `.git can't be found`，可忽略。

## 后续开发指南

1. 初始化 Git 后再装一次 husky。
2. 接入 Prisma + PostgreSQL，再做 JWT 鉴权。
3. 客户/税务主体 CRUD；税引擎与真实申报只留接口。
4. 首批国家默认：DE / GB / JP；数据手填 + CSV 占位。
5. 产品是核算与报送工具，不是税务意见；界面需免责声明。
6. UI 只用 Ant Design；新色值必须写 oklch，禁止 Inter / 紫粉渐变 / 左色条卡片。
