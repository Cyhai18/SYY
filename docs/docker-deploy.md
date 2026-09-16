# Docker 镜像部署方案

与 `docs/tencent-cloud-deploy.md`（CVM + PM2 + Nginx 原生部署）对应的容器化方案。

## 落地状态

以下文件已经实际创建在仓库里，并在本机用 `docker build` / `docker compose config` 验证过：

- ✅ `apps/api/Dockerfile`（已本地构建成功；注意实际用的是 `pnpm deploy --prod --legacy`，见二.1 说明）
- ✅ `apps/web/Dockerfile` + `apps/web/Caddyfile`（已本地构建成功）
- ✅ `services/ocr-service/Dockerfile`
- ✅ `services/doc-service/Dockerfile`
- ✅ 根目录 `.dockerignore`
- ✅ 根目录 `docker-compose.yml`（已用 `docker compose config` 校验语法）
- ✅ 根目录 `.env.example`，`.gitignore` 已补充 `.env.production` 忽略规则

未完成 / 待验证：

- ⏳ `services/ocr-service/Dockerfile` 已加上镜像源 + 缓存加速（见下方新增小节），但完整构建（含下载 RapidOCR 模型那一步）耗时仍然较长，本地未等待到最终跑完，需要后续找一段整块时间验证到底。
- ✅ `services/doc-service/Dockerfile` 已本地构建成功（约 3.5 分钟，主要卡在依赖下载，见下方加速方案）。
- ⏳ 没有跑过 `docker compose up -d --build` 完整拉起全部 5 个容器联调（尤其 `api` 连接宿主机 MySQL/Redis 的 `host.docker.internal` 网络配置，需要在真实 CVM 或本机装好原生 MySQL/Redis 后验证）。
- ⏳ 没有在真实域名 + 服务器环境验证 Caddy 自动签发 HTTPS 证书这一步（`apps/web/Caddyfile` 里的 `your-domain.com` 需要按实际域名替换）。
- ⏳ 宿主机 MySQL/Redis 网络放开到 Docker 网桥网段（`bind-address`、防火墙规则）的步骤仅是文档描述，未在真实服务器上执行验证。

## 一、整体架构

用 `docker-compose` 在同一台腾讯云 CVM 上编排 5 个容器，**MySQL / Redis 不进容器，按
`docs/tencent-cloud-deploy.md` 原生部署方案的方式直接装在宿主机上**（原因见「七、数据库/Redis：
数据库/Redis 用宿主机原生部署」）：

| 服务 | 说明 | 监听端口 | 是否对公网暴露 |
|---|---|---|---|
| `web`（容器） | 前端构建产物 + Caddy，同时反向代理 `/api` 到 `api` 容器、自动签发 HTTPS 证书 | 80/443 | 是 |
| `api`（容器） | NestJS 后端 | 3000 | 否，仅容器内网 |
| `ocr-service`（容器） | FastAPI + RapidOCR | 8000 | 否，仅容器内网 |
| `doc-service`（容器） | FastAPI + docxtpl | 8001 | 否，仅容器内网 |
| `gotenberg`（容器） | 官方镜像，docx→PDF 转换 | 3000 | 否，仅容器内网 |
| `mysql` / `redis`（宿主机原生进程，非容器） | 数据库与队列，`apt install` 直接装在 CVM 上 | 127.0.0.1:3306/6379 | 否，只监听 `127.0.0.1`，只允许本机进程访问 |

`web`/`api`/`ocr-service`/`doc-service`/`gotenberg` 放进同一个 `docker-compose.yml` 定义的自定义
网络，容器间用服务名互相访问；`api` 容器访问宿主机上的 MySQL/Redis 则要跨出容器网络访问宿主机
（见「四、docker-compose.yml」里的 `extra_hosts` 配置），只有 `web` 容器对公网暴露端口。

### 关于「`api` 和 `gotenberg` 端口重复」

`api`（NestJS）和 `gotenberg` 官方镜像**容器内部**确实都监听 `3000`，但这并不构成冲突：
Docker 里每个容器有独立的网络命名空间，`docker-compose.yml` 里也没有把这两个服务的端口
同时映射到宿主机（`ports:` 只在 `web` 上配置了 `80:80`），所以两者可以并存，
`doc-service` 访问 `http://gotenberg:3000` 与浏览器访问 `api` 没有任何关系。

真正需要注意的是：**只有写在 `ports:` 里、要映射到宿主机的端口才必须互不相同**。
如果后续调试时想临时把 `api` 的 3000 端口也开放到宿主机方便用 Postman 直连，
不要也写 `3000:3000`（会与本机其他可能占用 3000 的进程冲突），改用不同的宿主机端口号，例如：

```yaml
api:
  ports:
    - '3001:3000'   # 宿主机 3001 → 容器内 3000，仅调试用，生产环境建议去掉这条
```

## 二、需要新增的 Dockerfile

### 1. `apps/api/Dockerfile`（多阶段构建，用 `pnpm deploy` 生成自包含产物）

pnpm monorepo 的依赖默认提升（hoist）到根 `node_modules`，如果手动 `COPY` 根目录 `node_modules`
+ `apps/api/node_modules` 两份目录，容易漏掉间接依赖或复制到用不上的其他 app/service 依赖，
镜像也会偏大。更可靠、也更省体积的做法是用 `pnpm deploy` 命令生成一个**自包含**的产物目录
（只包含 `@funtax/api` 实际用到的生产依赖），构建阶段做完后只把这一个目录拷到运行阶段：

```dockerfile
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
# 生成自包含产物目录：只含 @funtax/api 运行时需要的代码 + 生产依赖（devDependencies 不会进来）
# 注意：pnpm v10 默认要求 workspace 开启 inject-workspace-packages=true 才能直接 deploy，
# 本仓库未开启该选项，实测需要加 --legacy 走旧版 deploy 行为，效果等价（已在本机验证构建成功）
RUN pnpm --filter @funtax/api deploy --prod --legacy /out/api

FROM node:20.19-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /out/api ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

> `pnpm deploy` 会把 `apps/api` 的 `dist/`、`package.json`、`prisma/` 以及解析好的生产依赖
> 一起放进 `/out/api`，运行阶段直接 `COPY` 这一个目录即可，不用再纠结「根 `node_modules` 要不要拷」
> 「`apps/api/node_modules` 里到底缺不缺东西」，从根源解决多阶段构建产物路径踩坑的问题（对应第六点）。
> 注意 `prisma generate` 产出的 client 在 `node_modules/.prisma` 下，需要在 `deploy` **之前**执行，
> 确保它被一并打进产物目录。

### 2. `apps/web/Dockerfile`（用 Caddy 而不是 Nginx，顺带解决 HTTPS）

前端产物是纯静态文件，不需要 `pnpm deploy`，但同样应该先拷依赖声明文件命中缓存。
运行阶段直接选 **Caddy** 而不是 Nginx，理由见「六、HTTPS」——Caddy 能自动申请/续期
Let's Encrypt 证书，不用额外起 Certbot 容器和写 cron 续期任务：

```dockerfile
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
```

`apps/web/Caddyfile` 取代原来的 `nginx.conf`，内容见下一节。

### 3. `services/ocr-service/Dockerfile`（构建期预下载模型，避免重建容器重新下载）

`rapidocr-onnxruntime` 默认在**第一次调用**时才联网下载识别模型到进程缓存目录，如果什么都不做，
每次 `docker compose up --build` 重建容器、模型缓存又没有落在 volume 里，就要重新下载一遍。
比起「挂 volume 持久化缓存目录」，更彻底的办法是**在构建镜像时就把模型下载好，直接烘焙进镜像层**：
这样镜像本身就是自包含的，运行时完全不需要联网，重建容器也不会触发下载。

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
# 国内镜像源 + pip 缓存挂载加速构建，详见 3.1 小节
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY . .
# 关键一步：构建期主动触发一次模型加载/下载，让模型文件被烘焙进这一层镜像；
# 之后 `docker compose up --build` 只要 requirements.txt 和这行代码不变，
# Docker 层缓存会直接复用，不会重新联网下载。
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

> `opencv-python` 依赖系统的 `libgl1`/`libglib2.0-0`，`python:3.11-slim` 默认没有，必须手动装，
> 否则容器启动会直接报 `ImportError: libGL.so.1`。
>
> 如果不想在构建期联网（比如构建机器在内网、没有公网出口），退而求其次的方案是给模型缓存目录
> 挂一个具名 volume（先在本机跑一次容器确认实际缓存路径，不同版本的 `rapidocr-onnxruntime`
> 路径可能不同，一般在 `~/.rapidocr` 或包安装目录下的 `models/`），效果是首次启动仍要下载一次，
> 但后续重建容器只要 volume 不删就不用再下载：
> ```yaml
> ocr-service:
>   build: ./services/ocr-service
>   volumes:
>     - ocr-model-cache:/root/.rapidocr   # 具体路径以实际探测为准
> ```

### 3.1 `ocr-service`/`doc-service` 依赖安装慢的解决方案

两个 Python 服务的 `pip install` 是构建耗时的大头（`opencv-python`/`onnxruntime` 的 wheel 包体积
大，`docxtpl` 的间接依赖也不少），实测已经采用并验证有效的两个手段（两个 Dockerfile 都已应用）：

- **换用国内 PyPI 镜像**：`pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt`，
  如果构建机在腾讯云 CVM（国内），下载速度比官方源 `pypi.org` 快很多；如果构建机在境外或访问不到该镜像，
  去掉 `-i` 参数退回官方源即可，不影响功能。
- **BuildKit 缓存挂载**（`--mount=type=cache,target=/root/.cache/pip`）：把 pip 的下载缓存放在
  BuildKit 的持久化缓存里，跨多次 `docker build`（即使 `requirements.txt` 内容变化、Docker 层缓存失效）
  复用已下载的包，不用每次都重新联网拉取；缓存本身不会进最终镜像层，不增加镜像体积。需要
  `DOCKER_BUILDKIT=1`（Docker 20.10+ 默认已开启，`docker buildx` 同样支持）。

如果以后构建频率变高（比如接入 CI），还可以进一步考虑：

- **私有基础镜像**：把 `opencv-python`/`onnxruntime` 这类几乎不变的重依赖单独打进一个基础镜像
  推到腾讯云 TCR，`ocr-service` 的 Dockerfile 直接 `FROM` 这个基础镜像，日常构建只需要重装自己的
  业务代码依赖（`requirements.txt` 里变动频繁的那几行）。
- **CI 缓存**：GitHub Actions/腾讯云 CODING 等 CI 平台的 `docker buildx build --cache-from/--cache-to`
  可以把 BuildKit 缓存持久化到远端（如 registry cache），避免每次 CI 跑全新 runner 时缓存清零。

### 4. `services/doc-service/Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
# 说明见 3.1：国内镜像源 + pip 缓存挂载加速构建
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
```

### 5. 减小镜像体积的具体做法（汇总）

- **多阶段构建**：上面 4 个 Dockerfile 都已采用，构建工具链（`pnpm`/编译产物中间文件）不会进最终镜像。
- **基础镜像选 `slim`/`alpine`**：`node:20.19-slim`、`python:3.11-slim`、`caddy:2-alpine` 都比 `-bullseye`/默认标签小很多；Python 镜像因为要装 `libgl1` 等系统库，不能选 `alpine`（`musl` 下 `opencv-python`/`onnxruntime` 容易装不上或要自己编译，得不偿失）。
- **`pip install --no-cache-dir` / `pnpm install --frozen-lockfile`**：不缓存下载包，减少一层体积；`pnpm deploy --prod` 天然不含 `devDependencies`（如 `typescript`、`eslint`、测试库），比直接拷全量 `node_modules` 小很多。
- **合并 `RUN` 指令 + 及时清理**：`apt-get update && apt-get install ... && rm -rf /var/lib/apt/lists/*` 写在同一个 `RUN` 里，避免 apt 缓存被单独打进一层、后面清理也没用（Docker 层是增量的，删除操作如果在下一层做，上一层的体积依然占用）。
- **`.dockerignore`**（见下一节）：避免 `node_modules`、`.git`、各 app 的本地 `dist`/`uploads` 被发进构建上下文，间接减小镜像和构建时间。
- **认清体积瓶颈**：`ocr-service` 镜像大主要是 `opencv-python` + `onnxruntime` + 烘焙进去的模型文件（合计可能到几百 MB～1G+），这是功能必需的，多阶段构建/`slim` 基础镜像已经是这类依赖能做到的极限；如果想进一步压缩，可以评估换用体积更小的 OCR 引擎，但那是功能选型层面的取舍，不是 Dockerfile 写法能解决的。
- **私有镜像仓库 + 分层缓存**：用腾讯云 TCR（容器镜像服务）而不是每次都从 Docker Hub 拉基础镜像，CVM 与 TCR 同地域内网访问速度更快；CI 构建时打开 BuildKit 缓存（`docker buildx build --cache-from`）复用未变化的层。

### 6. `.dockerignore`（仓库根目录新增，配合 `context: .`）

`api`/`web` 的 Dockerfile 构建上下文是仓库根目录（下面 compose 里的 `context: .`），因为要拿到
根 `pnpm-lock.yaml` 和 `packages/shared` 源码；如果不排除无关目录，构建时会把整个仓库
（含 `node_modules`、`.git`、本地 `uploads`）都发给 Docker daemon，导致构建缓慢、镜像臃肿：

```gitignore
node_modules
**/node_modules
**/dist
.git
.env
.env.*
apps/api/uploads
**/*.log
```

## 三、文件上传持久化

后端两处会往磁盘写文件：客户附件（`apps/api/src/storage/providers/local-disk.provider.ts`，
落在 `UPLOAD_DIR/attachments`）和生成的证书 PDF（`apps/api/src/certificate/certificate.service.ts`，
落在 `UPLOAD_DIR/certificates`），两者共用同一个 `UPLOAD_DIR` 根目录。Dockerfile 里 `WORKDIR /app`，
容器内代码默认会落到 `/app/uploads`（`UPLOAD_DIR` 未配置时的兜底值），所以只要把这个路径挂成
具名 volume（或宿主机目录 bind mount），`docker compose up --build` 重建 `api` 容器时数据就不会丢：

```yaml
api:
  environment:
    UPLOAD_DIR: /app/uploads
  volumes:
    - uploads-data:/app/uploads   # 具名 volume，也可以换成宿主机路径如 /data/funtax/uploads:/app/uploads
```

两种挂法的取舍：
- **具名 volume**（如上）：由 Docker 管理实际存储位置（一般在 `/var/lib/docker/volumes/...`），不用关心宿主机路径，`docker compose down -v` 才会删；缺点是不方便直接用宿主机工具查看/备份文件。
- **宿主机目录 bind mount**（`/data/funtax/uploads:/app/uploads`）：路径可控，方便用 `rsync`/`crontab` 做定期备份到腾讯云 COS，推荐生产环境用这种，和原生部署方案（`docs/tencent-cloud-deploy.md`）的 `UPLOAD_DIR=/data/funtax-uploads` 思路一致，出问题也方便直接进宿主机排查文件。

不管选哪种，都建议配一个定时任务把该目录同步备份到对象存储（COS），避免磁盘故障导致数据丢失。

## 四、`docker-compose.yml`（仓库根目录新增）

`mysql`/`redis` 不再是 compose 里的服务，`api` 容器通过 `extra_hosts` 把
`host.docker.internal` 指向宿主机网关（Linux 上 Docker 20.10+ 支持 `host-gateway` 这个特殊值），
`DATABASE_URL`/`REDIS_URL` 直接连宿主机上原生安装的 MySQL/Redis：

```yaml
services:
  gotenberg:
    image: gotenberg/gotenberg:8
    restart: unless-stopped

  ocr-service:
    build: ./services/ocr-service
    restart: unless-stopped
    # 模型已在构建期烘焙进镜像（见二.3），此处不需要再挂模型缓存 volume

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
    depends_on: [ocr-service, doc-service]
    env_file: apps/api/.env.production
    extra_hosts:
      - 'host.docker.internal:host-gateway'   # 让容器能访问宿主机上原生安装的 MySQL/Redis
    environment:
      DATABASE_URL: mysql://funtax:${MYSQL_PASSWORD}@host.docker.internal:3306/funtax
      REDIS_URL: redis://host.docker.internal:6379
      OCR_SERVICE_URL: http://ocr-service:8000
      DOC_SERVICE_URL: http://doc-service:8001
      UPLOAD_DIR: /app/uploads
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
      - '443:443'
    volumes:
      - caddy-data:/data       # Caddy 自动签发/续期的证书存这里，容器重建不丢
      - caddy-config:/config

volumes:
  uploads-data:
  caddy-data:
  caddy-config:
```

对应地，宿主机的 MySQL/Redis 必须监听 `0.0.0.0`（或至少监听 Docker 网桥 `docker0` 的网关地址，
默认 `172.17.0.1`），而不是只监听 `127.0.0.1`——原生部署方案里为了安全把 MySQL/Redis 绑定在
`127.0.0.1`，这里为了让容器能访问，需要放开到 Docker 网桥网段，但**不能**直接对公网 0.0.0.0
不做任何限制，做法是用 CVM 防火墙/`iptables` 只放行 Docker 网桥网段（`172.17.0.0/16`）访问
3306/6379，公网安全组仍然完全不开放这两个端口。

## 五、部署步骤（在 CVM 上）

```bash
# 1. 装 MySQL/Redis（原生安装，步骤与 docs/tencent-cloud-deploy.md 一致），
#    再装 Docker + docker compose 插件（其余服务用容器跑，不需要装 Node/Python）
apt install -y mysql-server redis-server
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# 2. 建库建用户（原生部署方案同款步骤），并放开 Docker 网桥网段访问权限
mysql -u root -p <<'SQL'
CREATE DATABASE funtax CHARACTER SET utf8mb4;
CREATE USER 'funtax'@'172.17.0.0/255.255.0.0' IDENTIFIED BY '<你的密码>';
GRANT ALL PRIVILEGES ON funtax.* TO 'funtax'@'172.17.0.0/255.255.0.0';
FLUSH PRIVILEGES;
SQL
# 修改 /etc/mysql/mysql.conf.d/mysqld.cnf 的 bind-address 为 0.0.0.0（或 172.17.0.1），
# 修改 /etc/redis/redis.conf 的 bind 同理，然后用防火墙只放行 172.17.0.0/16 访问 3306/6379
# （具体见「七、数据库/Redis：数据库/Redis 用宿主机原生部署」）
systemctl restart mysql redis-server

# 3. 拉代码，准备 .env（见「八、用 .env 管理环境变量」）
git clone <仓库地址> /data/funtax && cd /data/funtax
cp .env.example .env                                 # 根目录：MYSQL_PASSWORD 等
cp apps/api/.env.example apps/api/.env.production     # api 专用：JWT_* / DATABASE_URL 等

# 4. 构建并启动（容器化的几个服务）
docker compose up -d --build

# 5. 数据库迁移（容器内执行，连的是宿主机原生 MySQL）
docker compose exec api npx prisma migrate deploy

# 6. 查看日志/状态
docker compose ps
docker compose logs -f api
```

## 六、HTTPS（选定方案：Caddy）

`web` 容器改用 **Caddy** 替代 Nginx（见二.2），生产环境上 HTTPS 只需要一份 `Caddyfile`，
不需要额外起 Certbot 容器、不需要写 cron 续期任务——Caddy 内置 ACME 客户端，
启动时自动向 Let's Encrypt 申请证书，到期前自动续期，证书文件持久化在 `/data` 目录
（对应 compose 里挂的 `caddy-data` volume，容器重建也不会丢证书、不会触发重新申请）。

`apps/web/Caddyfile`：

```
your-domain.com {
    encode gzip
    root * /usr/share/caddy
    file_server

    # SPA fallback：非静态资源的路径都回退到 index.html，交给前端路由处理
    try_files {path} /index.html

    # /api 反代到 api 容器（容器间用 compose 服务名 api 互相访问）
    handle /api/* {
        reverse_proxy api:3000
    }
}
```

把 `your-domain.com` 换成实际域名（域名要先在 DNS 解析到 CVM 公网 IP），Caddy 会自动用
HTTP-01/TLS-ALPN-01 挑战申请证书；本地测试没有真实域名时可以先用 `http://` 前缀跳过证书申请，
只测反代和 SPA fallback 逻辑，例如把第一行换成 `:80 { ... }`。

**几个需要注意的点**：
- 安全组/防火墙要放行 80（ACME HTTP-01 挑战 + 后续自动跳转 HTTPS）和 443 两个端口，Caddy 申请证书失败大多是因为 80 端口没放行。
- `caddy-data`/`caddy-config` 两个 volume 一定要挂（compose 里已加），否则每次 `docker compose up --build` 重建容器都会触发重新申请证书，Let's Encrypt 对同一域名申请证书有频率限制（一周内失败/成功次数上限），容器频繁重建可能触发限流导致证书签发不下来。
- 如果后续想切回腾讯云 CLB 统一做 TLS termination（比如已经在用负载均衡分发多台 CVM 流量），把 Caddy 换回明文 80 端口反代、证书挂在 CLB 上即可，业务配置不需要改动，只是这条路线目前不采用。

## 七、数据库 / Redis：用宿主机原生部署，不进容器、不接入云托管

三个选项对比一下：

| 方案 | 费用 | 数据持久化 | 复杂度 |
|---|---|---|---|
| 云托管（TencentDB） | 按规格持续计费，无长期免费版 | 云厂商自动备份/高可用 | 最低（不用自己管） |
| MySQL/Redis 也进容器 | 免费（自建） | 靠 Docker volume，容器/宿主机误操作有丢失风险，且多一层抽象 | 中 |
| **宿主机原生安装（本方案）** | 免费（自建） | 直接是宿主机文件系统，`apt`/`systemctl` 管理，最直观 | 中 |

已明确不用云托管（收费）；在剩下两个自建选项里，选择**宿主机原生安装**而不是"MySQL/Redis 也放进容器"，原因：

- **和现有原生部署方案保持一致**：`docs/tencent-cloud-deploy.md` 已经有一套跑通的 MySQL/Redis 安装、建库建用户、备份步骤，直接复用，不用再单独调试 Docker volume 权限、容器内 MySQL 配置文件覆盖等问题。
- **数据持久化更直观**：数据就在宿主机 `/var/lib/mysql`，用 `mysqldump`/`rsync`/`crontab` 备份和原生部署完全一样，不需要先搞清楚"Docker volume 到底存在磁盘哪个路径"、`docker compose down -v` 会不会把数据删了这类容器特有的心智负担。
- **减少一层抽象，排查问题更快**：数据库出问题时直接 `systemctl status mysql`、看 `/var/log/mysql/error.log`，不需要 `docker exec` 进容器再排查，SSH 上服务器就能直接操作，符合"单机、团队小、快速迭代"的现阶段定位。
- **代价是要多做一步网络打通**：容器（`api`）和宿主机进程（MySQL/Redis）分属不同网络命名空间，需要用 `extra_hosts: host.docker.internal:host-gateway`（见「四、docker-compose.yml」）让容器能访问宿主机端口，且 MySQL/Redis 要从只监听 `127.0.0.1` 放宽到能被 Docker 网桥网段访问，这一步原生部署方案里不需要，是容器化后新增的配置成本。

**落地要点**：

- **网络配置**：MySQL 的 `bind-address`、Redis 的 `bind` 从 `127.0.0.1` 改为 `0.0.0.0`（或更精确地绑定 Docker 网桥地址 `172.17.0.1`），MySQL 用户授权改成 `'funtax'@'172.17.0.0/255.255.0.0'` 而不是 `'funtax'@'localhost'`；同时用 `ufw`/`iptables`/腾讯云安全组确保 3306/6379 只对 `172.17.0.0/16`（Docker 默认网桥网段）开放，公网安全组完全不放行这两个端口，避免放宽监听地址之后意外对公网暴露。
- **`host.docker.internal` 在 Linux 上需要显式声明**：不像 Docker Desktop（Mac/Windows）默认自带这个域名解析，Linux 上的 `docker compose` 要在服务里加 `extra_hosts: - "host.docker.internal:host-gateway"`（Docker Compose 1.29+/Docker Engine 20.10+ 支持 `host-gateway` 特殊值，会自动解析成宿主机在该容器网络里的网关 IP），已经写进上面的 compose 示例。
- **备份方式与原生部署一致**：继续用 `docs/tencent-cloud-deploy.md` 里的 `mysqldump` + 定时任务同步到腾讯云 COS 的方案，不需要额外为容器化场景重新设计备份逻辑。
- **升级路径**：如果以后业务量增长到需要高可用/自动主备切换，再迁移到云托管版，只需要改 `apps/api/.env.production` 里的 `DATABASE_URL`/`REDIS_URL` 指向云数据库内网地址，去掉 `extra_hosts` 配置，`api` 应用代码不需要改动。

## 八、用 `.env` 管理环境变量

不要把真实密钥（数据库密码、JWT secret）写进 `docker-compose.yml` 提交到仓库。约定两层 `.env`：

- **根目录 `.env`**：只放 `docker-compose.yml` 里用 `${VAR}` 插值的变量——现在 MySQL/Redis 是宿主机原生进程，`docker-compose.yml` 里唯一还需要插值的是 `api` 服务连接宿主机 MySQL 用的 `MYSQL_PASSWORD`（对应「五、部署步骤」建库建用户时设置的 `funtax` 用户密码），`docker compose` 命令会自动读取同目录下的 `.env` 文件，不需要显式 `env_file` 声明。
- **`apps/api/.env.production`**：放 `api` 容器运行时需要的全部环境变量（`DATABASE_URL`、`REDIS_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`UPLOAD_DIR` 等），通过 compose 里 `api` 服务的 `env_file: apps/api/.env.production` 加载到容器内，内容基本沿用 `apps/api/.env.example` 的字段，生产环境记得把 `JWT_*` 换成 `openssl rand -hex 32` 生成的随机值。

仓库根目录新增 `.env.example`（可提交，仅列变量名不含真实值）：

```bash
# 根目录 .env.example，复制为 .env 后按需修改
# 对应宿主机原生 MySQL 里 funtax 用户的密码（见「五、部署步骤」建库建用户）
MYSQL_PASSWORD=changeme
```

两个要点：
1. 真实的 `.env`、`apps/api/.env.production` 都要加进 `.gitignore`（`.dockerignore` 里也排除了，见二.6），避免密钥进版本库或被打进构建上下文。
2. `docker compose config` 可以在不真正启动的情况下打印出变量替换后的最终配置，方便部署前检查密钥是否正确加载。

## 九、与原生部署方案（PM2 + Nginx）对比

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
