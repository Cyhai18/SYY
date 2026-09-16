# 构建上下文为仓库根目录，见根 docker-compose.yml 里的 `context: .`
# 方案细节见 docs/docker-deploy.md 二.1

FROM node:20.19-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
# 先只拷贝依赖声明文件，命中 Docker 层缓存：源码没变时这一层不用重新 install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
# 再拷贝源码进行构建
COPY . .
RUN pnpm --filter @funtax/api exec prisma generate
RUN pnpm --filter @funtax/api build
# 生成自包含产物目录：只含 @funtax/api 运行时需要的代码 + 生产依赖
# pnpm v10 默认要求 workspace 设置 inject-workspace-packages=true 才能 deploy，
# 本仓库没有开启该选项，用 --legacy 走旧版 deploy 行为（打包解析后的生产依赖，效果等价）
RUN pnpm --filter @funtax/api deploy --prod --legacy /out/api

FROM node:20.19-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /out/api ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
