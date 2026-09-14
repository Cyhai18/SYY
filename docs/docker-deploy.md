# Docker 镜像部署方案

与 `docs/tencent-cloud-deploy.md`（CVM + PM2 + Nginx 原生部署）对应的容器化方案。
**注意：本仓库目前还没有 Dockerfile/docker-compose 文件**，以下是需要新增的文件内容和落地步骤；
如果你确认要走这条路线，我可以照此把文件实际创建到仓库里。

## 一、整体架构

用 `docker-compose` 在同一台腾讯云 CVM 上编排 6 个容器：

| 容器 | 说明 | 对外端口 |
|---|---|---|
| `web` | 前端构建产物 + Nginx，同时反向代理 `/api` 到 `api` 容器 | 80/443 |
| `api` | NestJS 后端 | 仅容器内网 3000 |
| `ocr-service` | FastAPI + RapidOCR | 仅容器内网 8000 |
| `doc-service` | FastAPI + docxtpl | 仅容器内网 8001 |
| `gotenberg` | 官方镜像，docx→PDF 转换 | 仅容器内网 3000 |
| `mysql` / `redis` | 数据库与队列 | 仅容器内网 3306/6379（或用云托管数据库替代，见下文） |

所有服务放进同一个 `docker-compose.yml` 定义的自定义网络，容器间用服务名互相访问
（如 `DATABASE_URL=mysql://funtax:xxx@mysql:3306/funtax`），只有 `web` 容器对公网暴露端口。

## 二、需要新增的 Dockerfile

### 1. `apps/api/Dockerfile`（多阶段构建）

```dockerfile
FROM node:20.19-slim AS builder
WORKDIR /repo
COPY . .
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funtax/api exec prisma generate
RUN pnpm --filter @funtax/api build

FROM node:20.19-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/api/package.json ./package.json
COPY --from=builder /repo/apps/api/prisma ./prisma
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

> pnpm monorepo 的依赖是提升（hoist）到根 `node_modules` 的，构建镜像时要把根目录一起拷进去，
> 否则运行时会报模块找不到；实际编写时建议用 `pnpm deploy` 命令生成一个自包含产物目录，比手动拷贝更可靠。

### 2. `apps/web/Dockerfile`

```dockerfile
FROM node:20.19-slim AS builder
WORKDIR /repo
COPY . .
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @funtax/web build

FROM nginx:1.27-alpine
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`apps/web/nginx.conf` 内容与原生部署一致（SPA fallback + `/api` 反代到 `api:3000`）。

### 3. `services/ocr-service/Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

> `opencv-python` 依赖系统的 `libgl1`/`libglib2.0-0`，`python:3.11-slim` 默认没有，必须手动装，
> 否则容器启动会直接报 `ImportError: libGL.so.1`。

### 4. `services/doc-service/Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
```

## 三、`docker-compose.yml`（仓库根目录新增）

```yaml
services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: funtax
      MYSQL_USER: funtax
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - mysql-data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    restart: unless-stopped

  gotenberg:
    image: gotenberg/gotenberg:8
    restart: unless-stopped

  ocr-service:
    build: ./services/ocr-service
    restart: unless-stopped

  doc-service:
    build: ./services/doc-service
    restart: unless-stopped
    environment:
      GOTENBERG_URL: http://gotenberg:3000

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    depends_on: [mysql, redis, ocr-service, doc-service]
    env_file: apps/api/.env.production
    environment:
      DATABASE_URL: mysql://funtax:${MYSQL_PASSWORD}@mysql:3306/funtax
      REDIS_URL: redis://redis:6379
      OCR_SERVICE_URL: http://ocr-service:8000
      DOC_SERVICE_URL: http://doc-service:8001
    volumes:
      - uploads-data:/app/uploads

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    restart: unless-stopped
    depends_on: [api]
    ports:
      - '80:80'

volumes:
  mysql-data:
  uploads-data:
```

## 四、部署步骤（在 CVM 上）

```bash
# 1. 只需要装 Docker + docker compose 插件，不需要装 Node/Python/MySQL/Redis
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# 2. 拉代码，配置根目录 .env（MYSQL_ROOT_PASSWORD/MYSQL_PASSWORD）与 apps/api/.env.production
git clone <仓库地址> /data/funtax && cd /data/funtax
cp apps/api/.env.example apps/api/.env.production   # 按需修改 JWT_* 等

# 3. 构建并启动
docker compose up -d --build

# 4. 数据库迁移（容器内执行）
docker compose exec api npx prisma migrate deploy

# 5. 查看日志/状态
docker compose ps
docker compose logs -f api
```

## 五、需要注意的坑

- **文件上传持久化**：`UPLOAD_DIR` 必须挂载 Docker volume（如上面的 `uploads-data`），否则 `docker compose up --build` 重建容器会把已上传的附件/证书全部丢失。
- **OCR 模型下载**：`rapidocr-onnxruntime` 首次调用会联网下载模型到容器内，若不挂载 volume 持久化模型缓存目录，每次重建容器都要重新下载（浪费时间和流量），建议额外挂载模型缓存目录。
- **镜像体积**：`opencv-python` + `onnxruntime` 会让 `ocr-service` 镜像明显偏大（几百 MB 到 1G+），构建/传输较慢，建议用国内镜像加速或私有镜像仓库（腾讯云 TCR）缓存层。
- **pnpm monorepo 构建上下文**：`api`/`web` 的 Dockerfile 构建上下文是仓库根目录（`context: .`），因为要拿到根 `pnpm-lock.yaml` 和 `packages/shared`；构建时会把整个仓库（含 `node_modules`、`.git`）发给 Docker daemon，务必配置好 `.dockerignore` 排除这些目录，否则构建缓慢且镜像臃肿。
- **多阶段构建产物路径**：pnpm 提升式的 `node_modules` 拷贝容易漏依赖，更稳妥的做法是用 `pnpm deploy --filter @funtax/api --prod out` 生成自包含目录再拷贝，减少踩坑。
- **数据库/Redis 用容器还是云托管**：容器化的 MySQL 数据全靠 volume 保证持久化，一旦误删 volume 数据全丢；生产环境更稳妥的做法是数据库/Redis 用腾讯云托管版（云数据库 MySQL / 云数据库 Redis），`docker-compose.yml` 里去掉 `mysql`/`redis` 服务，`DATABASE_URL`/`REDIS_URL` 直接指向云数据库内网地址。
- **HTTPS**：`web` 容器只处理 80 端口，如需 HTTPS 可以额外加一个 Nginx/Caddy/Traefik 容器做证书终止，或者在 CVM 上单独装 Nginx + Certbot 做反代（相当于 Docker 服务外面再包一层原生 Nginx）。
- **环境变量管理**：不要把真实密钥写进 `docker-compose.yml` 提交到仓库，用 `.env` 文件（加入 `.gitignore`）或部署平台的 secret 管理。

## 六、与原生部署方案（PM2 + Nginx）对比

| 维度 | 原生部署（PM2 + Nginx） | Docker 镜像部署 |
|---|---|---|
| 首次搭建复杂度 | 较低：直接装软件包，命令简单直观 | 较高：需要额外编写/维护 4 个 Dockerfile + compose 文件 |
| 环境一致性 | 依赖服务器手动安装的系统库版本，"本机能跑"但换机器可能因版本差异出问题 | 镜像里固定了系统库版本，"一次构建，到处运行"，一致性更好 |
| 部署/回滚速度 | `git pull` + 重新 build + `pm2 restart`，增量快 | 需要重新 `docker build`（尤其 Python 镜像层较大），首次慢；回滚只需切换镜像 tag，更干净 |
| 资源占用 | 更省内存/磁盘（没有容器层开销） | 每个服务独立容器，有一定额外开销（尤其多个 Python 镜像体积较大） |
| 排查问题 | 直接 `pm2 logs`、SSH 进服务器改代码调试，上手快 | 需要 `docker compose logs`、`docker exec` 进容器调试，多一层抽象 |
| 扩展到多机/集群 | 需要手动搭负载均衡、多机同步部署脚本，扩展性较弱 | 天然适合后续迁移到 Kubernetes/TKE，水平扩展更平滑 |
| 依赖隔离 | Python venv + Node 全局环境共存于同一台机器，需要小心管理版本冲突 | 每个服务独立容器环境，互不干扰，无冲突风险 |
| 适合阶段 | 团队小、迭代快、想尽快上线验证的早期阶段 | 团队/业务增长后，需要多环境（测试/预发/生产）一致性、后续上容器编排平台时 |

**建议**：现阶段（单机、团队小、快速迭代）优先用原生 PM2 部署方案，先跑起来验证业务；
后续如果需要多环境部署、CI/CD 自动化构建镜像、或迁移到腾讯云 TKE（容器服务）时，
再按本文档补齐 Dockerfile 迁移到容器化方案，两者可以平滑过渡（业务代码不需要改动，只是打包/运行方式变化）。
