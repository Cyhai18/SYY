# 部署到腾讯云服务器（CVM）指南

本项目组成：`apps/api`（NestJS，端口 3000）、`apps/web`（Vite 静态站点）、`services/ocr-service`
（Python FastAPI，端口 8000）、`services/doc-service`（Python FastAPI，端口 8001，依赖 Gotenberg 容器），
数据库 MySQL，队列依赖 Redis。以下方案用「云服务器（CVM）+ PM2 + Nginx」的原生部署方式，
不依赖自建 Docker 镜像仓库，最贴近当前仓库已有的本地启动脚本（`scripts/dev-all.sh`），上手成本低、便于排错。

## 方案选择建议

| 方案 | 说明 | 建议 |
|---|---|---|
| CVM + PM2 + Nginx（本文采用） | 单台服务器装好 Node/Python/MySQL/Redis/Nginx，用 PM2 管理进程 | 中小项目、团队规模小、想快速上线，**推荐** |
| CVM + Docker Compose | 每个服务写 Dockerfile，用 compose 编排 | 后续人员变多、需要多环境/多实例时再迁移 |
| Serverless（云函数/TKE 等） | 拆分粒度更细，运维更省心 | 现阶段没必要，业务量小、且有本地文件存储/Python 依赖，改造成本高 |

数据库/Redis 建议：初期可直接装在同一台 CVM 上（成本低）；后续业务增长后，
可换成腾讯云「云数据库 MySQL」+「云数据库 Redis」托管版，只需改 `.env` 里的连接串，代码不用动。

## 一、购买与准备腾讯云资源

1. **CVM 实例**：地域选靠近用户的（如上海/广州），配置建议 2 核 4G 起步（跑 Node + 2 个 Python 服务 + MySQL + Redis），系统选 **Ubuntu 22.04 LTS**。
2. **安全组**：放行以下端口
   - `22`（SSH，建议只放行你的固定 IP）
   - `80` / `443`（Nginx 对外提供 Web/API 访问）
   - 其余端口（3000/5173/8000/8001/3306/6379）**不要**对公网开放，只在服务器内部 127.0.0.1 互相访问
3. **域名**（可选但推荐）：在腾讯云「域名注册」或已有域名解析一个 A 记录指向 CVM 公网 IP，方便后续申请 HTTPS 证书。
4. 记录好：CVM 公网 IP、SSH 密码/密钥。

## 二、首次登录服务器，安装基础软件

```bash
ssh root@<你的服务器IP>

apt update && apt upgrade -y

# 1. Node.js 20（用 nvm 管理，避免和系统 apt 版本冲突）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20.19.0
nvm use 20.19.0
node -v   # 确认 >= 20.19.0

# 2. pnpm（版本需与根 package.json 的 packageManager 一致）
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm -v

# 3. PM2（Node 进程守护/开机自启）
npm install -g pm2

# 4. Python 3（跑两个微服务）与虚拟环境工具
apt install -y python3 python3-venv python3-pip

# 5. MySQL 8
apt install -y mysql-server
systemctl enable --now mysql

# 6. Redis
apt install -y redis-server
systemctl enable --now redis-server

# 7. Nginx（反向代理 + 托管前端静态文件）
apt install -y nginx
systemctl enable --now nginx

# 8. Docker（仅用于跑 doc-service 依赖的 Gotenberg 文档转换服务）
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 9. Git（拉代码用）
apt install -y git
```

## 三、初始化 MySQL 数据库

```bash
mysql_secure_installation   # 按提示设置 root 密码、关闭匿名登录等

mysql -u root -p
```

```sql
CREATE DATABASE funtax CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'funtax'@'localhost' IDENTIFIED BY '<设置一个强密码>';
GRANT ALL PRIVILEGES ON funtax.* TO 'funtax'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 四、拉取代码并配置环境变量

```bash
mkdir -p /data && cd /data
git clone <你的仓库地址> funtax
cd funtax
pnpm install
```

配置 `apps/api/.env`（复制 `.env.example` 后修改）：

```bash
cp apps/api/.env.example apps/api/.env
vim apps/api/.env
```

关键项：

```
PORT=3000
NODE_ENV=production
DATABASE_URL="mysql://funtax:<你的密码>@127.0.0.1:3306/funtax"
REDIS_URL=redis://127.0.0.1:6379
OCR_SERVICE_URL=http://127.0.0.1:8000
DOC_SERVICE_URL=http://127.0.0.1:8001
UPLOAD_DIR=/data/funtax-uploads
# 生产环境必须配置，否则启动直接报错，用 `openssl rand -hex 32` 各生成一个
JWT_ACCESS_SECRET=<随机字符串>
JWT_REFRESH_SECRET=<随机字符串>
```

```bash
mkdir -p /data/funtax-uploads
```

配置 `services/doc-service/.env`：

```bash
cp services/doc-service/.env.example services/doc-service/.env
# GOTENBERG_URL=http://localhost:3010 保持默认即可
```

## 五、启动 Gotenberg（doc-service 依赖，容器化运行）

```bash
docker run -d --name gotenberg --restart unless-stopped -p 127.0.0.1:3010:3000 gotenberg/gotenberg:8
```

## 六、构建并启动各服务

### 1. 后端 API

```bash
cd /data/funtax
pnpm --filter @funtax/api exec prisma migrate deploy   # 应用数据库迁移（只建表，库需已存在）
pnpm --filter @funtax/api build

pm2 start /data/funtax/apps/api/dist/main.js --name funtax-api
```

### 2. 前端（构建为静态文件，交给 Nginx 托管，不需要 PM2）

```bash
cd /data/funtax
pnpm --filter @funtax/web build
# 产物在 apps/web/dist，Nginx 配置见下一节
```

### 3. OCR 微服务

```bash
cd /data/funtax/services/ocr-service
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

pm2 start .venv/bin/uvicorn --name funtax-ocr --interpreter none \
  -- app:app --host 127.0.0.1 --port 8000
```

### 4. doc-service 证书生成微服务

```bash
cd /data/funtax/services/doc-service
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

pm2 start .venv/bin/uvicorn --name funtax-doc --interpreter none \
  -- app:app --host 127.0.0.1 --port 8001 --env-file .env
```

### 5. 保存 PM2 进程列表并设置开机自启

```bash
pm2 save
pm2 startup   # 按提示执行输出的那条命令（会注册 systemd 服务）
```

常用 PM2 命令：`pm2 list` 查看状态、`pm2 logs funtax-api` 看日志、`pm2 restart funtax-api` 重启。

## 七、配置 Nginx（前端静态资源 + API 反向代理）

新建 `/etc/nginx/sites-available/funtax`：

```nginx
server {
    listen 80;
    server_name <你的域名或公网IP>;

    root /data/funtax/apps/web/dist;
    index index.html;

    # 前端 SPA：找不到文件时回退到 index.html，交给前端路由处理
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API：Nest 全局前缀是 /api
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/funtax /etc/nginx/sites-enabled/
nginx -t   # 测试配置无误
systemctl reload nginx
```

同时把 `apps/api/src/main.ts` 里的 CORS 白名单从 `http://localhost:5173` 改为你的正式域名
（因为现在前端和 API 同源走 Nginx 代理，实际上线后可以不依赖 CORS，但保留配置以防跨域调用）。

## 八、（推荐）申请免费 HTTPS 证书

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d <你的域名>
```

Certbot 会自动改写 Nginx 配置并配置证书自动续期（免费，Let's Encrypt 证书 90 天有效期，自动续签）。

## 九、验证部署

```bash
curl http://127.0.0.1:3000/api/health   # 后端健康检查
curl http://127.0.0.1:8000/health       # OCR 微服务
curl http://127.0.0.1:8001/health       # doc-service（如有 health 接口）
```

浏览器访问 `http://<域名或IP>` 应能看到登录页，注册/登录流程能跑通即代表部署成功。

## 十、日常发布更新流程

```bash
cd /data/funtax
git pull
pnpm install
pnpm --filter @funtax/api exec prisma migrate deploy   # 有新迁移时执行
pnpm --filter @funtax/api build
pnpm --filter @funtax/web build
pm2 restart funtax-api
# ocr-service / doc-service 代码有更新时才需要 pm2 restart funtax-ocr / funtax-doc
```

## 十一、注意事项

- `UPLOAD_DIR` 一定要指向持久化磁盘路径（如挂载的云硬盘 `/data/...`），避免服务器重装/迁移导致附件和证书丢失，建议定期备份该目录和 MySQL 数据库。
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 生产环境必须配置为随机强密钥，不要用仓库里的默认值。
- MySQL/Redis 只监听 `127.0.0.1`（默认即如此），不要在安全组或 `bind` 配置里对公网开放。
- 建议给 CVM 配置定时任务做数据库备份（`mysqldump` + 上传到腾讯云 COS 对象存储）。
- 首次调用 OCR 接口时会自动下载识别模型，服务器需要能访问外网（若走内网无公网 IP，需要配置 NAT 网关）。
