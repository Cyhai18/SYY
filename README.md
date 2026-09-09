# FunTax

跨境卖家税务 SaaS 的 monorepo 骨架。已实现手机号验证码/密码登录注册与个人中心，客户画像与税引擎等业务模块尚未开始。

## 技术栈

- 前端：React + Vite + Ant Design
- 后端：NestJS + TypeScript
- 数据库：MySQL + Prisma
- 工作区：pnpm + Turborepo

## 环境要求

- Node.js >= 20.19.0
- pnpm 10.33.0（见根 `package.json` `packageManager`）
- 本地或远程可访问的 MySQL 服务
- 本地或远程可访问的 Redis 服务（批量导入客户功能的 BullMQ 队列依赖，见下方「本地依赖」一节）

## 新环境启动步骤

1. 安装依赖：

   ```bash
   pnpm install
   ```

2. 配置后端环境变量：复制 `apps/api/.env.example` 为 `apps/api/.env`，按实际情况修改：

   ```
   PORT=3000
   DATABASE_URL="mysql://<user>:<password>@<host>:3306/<database>"
   ```

   - 目标数据库需提前手动创建（Prisma migrate 只建表，不建库）。
   - 生产环境（`NODE_ENV=production`）必须额外配置 `JWT_ACCESS_SECRET` 与 `JWT_REFRESH_SECRET`，否则启动时会直接报错拒绝运行（本地开发有默认兜底值，无需配置）。

3. 生成 Prisma Client 并建表：

   ```bash
   pnpm --filter @funtax/api prisma:generate
   pnpm --filter @funtax/api exec prisma migrate deploy   # 生产/CI：应用已有迁移
   # 或本地开发新增/调整表结构时用：
   pnpm --filter @funtax/api prisma:migrate
   ```

4. 启动服务：

   ```bash
   pnpm dev        # 本地开发：turbo 并行启动 web + api，带热更新
   # 生产部署：
   pnpm build
   pnpm --filter @funtax/api start   # API：node dist/main.js
   # Web 为静态构建产物（apps/web/dist），交由 Nginx/CDN 等静态托管
   ```

- Web：http://localhost:5173
- API：http://localhost:3000/api/health

## 本地依赖

### Redis（批量导入客户功能用，BullMQ 队列）

授权客户批量导入（见 `docs/client-batch-import-design.md`）用 BullMQ + Redis 做异步任务队列，本地开发需要一个可用的 Redis 实例：

```bash
brew install redis        # 首次安装（macOS，已安装可跳过）
brew services start redis # 后台常驻启动，默认监听 127.0.0.1:6379
# 或用 Docker：docker run -d --name funtax-redis -p 6379:6379 redis
```

`apps/api/.env` 中的 `REDIS_URL` 默认回退到 `redis://127.0.0.1:6379`，与上述默认端口一致，本地开发通常无需额外配置。生产环境务必显式配置指向真实 Redis 服务（建议独立实例，不与其他项目共用，避免队列任务互相干扰）。

## 常见问题

- API 报 `ECONNREFUSED` / 前端接口 500：通常是 API 进程未起来，先看 `pnpm dev` 终端里 `@funtax/api` 的编译日志，多半是 Prisma Client 与 `schema.prisma` 不匹配（缺表/字段）或数据库连接失败。
- Prisma 报 `P1000: Authentication failed`：`.env` 里 `DATABASE_URL` 的账号密码不对。
- Prisma 报 `Following migration have not yet been applied`：执行第 3 步的 `migrate deploy`（或本地用 `migrate dev`）建表。
