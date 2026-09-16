# 构建上下文为仓库根目录，见根 docker-compose.yml 里的 `context: .`
# 运行阶段用 Caddy 而不是 Nginx，顺带解决 HTTPS 自动签发/续期，见 docs/docker-deploy.md 二.2 / 六

FROM node:20.19-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @funtax/web build

FROM caddy:2-alpine
COPY --from=builder /repo/apps/web/dist /usr/share/caddy
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
