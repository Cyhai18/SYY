# Docker 部署踩坑记录

本文记录本项目从 `docker compose up` 到线上可正常访问、注册接口跑通的过程中，实际遇到的所有报错、根因和修复方式，按遇到的先后顺序排列。配合 `docs/docker-deploy.md` 一起看。

## 1. `Cannot find module '.prisma/client/default'`（api 容器崩溃重启）

**现象**：`docker compose logs api` 里报找不到 `.prisma/client/default`，容器不断重启。

**根因**：`pnpm --filter @funtax/api deploy --prod --legacy` 生成自包含产物目录时，不会把 builder 阶段 `prisma generate` 生成的 `.prisma/client` 产物带过去（pnpm + Prisma 已知交互问题）。

**修复**：在 `apps/api/Dockerfile` 的 `pnpm deploy` 之后，针对产物目录重新执行一次 `prisma generate`：

```dockerfile
RUN pnpm --filter @funtax/api deploy --prod --legacy /out/api
RUN cd /out/api && pnpm dlx prisma@7.9.1 generate
```

## 2. `Cannot find module 'dotenv/config'`

**根因**：`dotenv` 只在 `devDependencies` 里，`pnpm deploy --prod` 会把 devDependencies 全部裁掉，但 `main.ts` 运行时需要 `import 'dotenv/config'`。

**修复**：把 `dotenv` 从 `devDependencies` 移到 `dependencies`（`apps/api/package.json`）。

## 3. `Cannot find module 'prisma/config'`

**根因**：和上面同理，`prisma.config.ts` 运行时依赖 `prisma/config`，但 `prisma` 包只在 `devDependencies` 里。

**修复**：把 `prisma` 也从 `devDependencies` 移到 `dependencies`，并锁定 `^7.9.1`（用 `pnpm add prisma` 时要注意别手滑装成预发布版 `8.0.0-rc.15`）。

## 4. MySQL 拒绝容器连接：`Host '172.18.0.5' is not allowed to connect`

**根因**：`docker-compose.yml` 没有手动指定网络 `subnet`，Docker 会从默认地址池（`172.17.0.0/16`、`172.18.0.0/16`……）顺序分配。宿主机上如果已有其他 Docker 网络占用了 `172.17.0.0/16`，这个项目就会落到下一个网段（如 `172.18.x`），**不一定是 172.17.x**。而 MySQL 用户授权当时只放行了 `172.17.0.0/16`。

**验证方法**：
```bash
docker compose exec api hostname -i                      # 看容器实际 IP
docker network inspect bridge | grep -A3 Subnet           # 看默认 docker0 网段
mysql -u root -p -e "SELECT user, host FROM mysql.user WHERE user='funtax';"  # 看当前授权网段
```

**修复**：把 MySQL 用户授权网段放宽到 `172.16.0.0/12`（覆盖 Docker 默认地址池可能用到的全部网段）：

```sql
DROP USER 'funtax'@'172.17.0.0/255.255.0.0';
CREATE USER 'funtax'@'172.16.0.0/255.240.0.0' IDENTIFIED BY '<密码>';
GRANT ALL PRIVILEGES ON funtax.* TO 'funtax'@'172.16.0.0/255.240.0.0';
FLUSH PRIVILEGES;
```

防火墙同步放宽到 `172.16.0.0/12` 而不是写死 `/16`。

## 5. 外部无法访问 `http://<公网IP>/`（本机 curl 正常，外部一直超时）

**排查顺序**：
1. `docker compose ps` + `ss -tlnp | grep :80` → 确认端口绑定在 `0.0.0.0:80` 而非 `127.0.0.1:80`（本例正常）。
2. `ufw status` → 确认服务器自身防火墙没拦截（本例是 `inactive`，排除）。
3. 外部机器 `nc -zv <公网IP> 80` → `Operation timed out`（不是 `Connection refused`）说明包根本没到服务器，指向云平台防火墙/安全组拦截。
4. **根因**：这台是**轻量应用服务器（Lighthouse）**，它的"防火墙"模块和"安全组"是两个独立配置，安全组放行了 80 端口不代表 Lighthouse 防火墙也放行了。

**修复**：额外去 Lighthouse 控制台的「防火墙」标签页单独加一条放行 `TCP:80`（`443` 建议一并加上）。

## 6. `ERROR 1045: Access denied for user 'funtax'@'localhost'`

**根因**：容器网段授权（`172.16.0.0/12`）只覆盖 Docker 容器发起的连接，宿主机本机通过 `127.0.0.1`/`localhost` 连接不落在这个网段内，MySQL 按 host 精确/网段匹配，自然被拒绝——这其实说明网段授权本身是对的。

**修复（可选，方便本机调试）**：额外加一条 `localhost` 授权：

```sql
CREATE USER 'funtax'@'localhost' IDENTIFIED BY '<密码>';
GRANT ALL PRIVILEGES ON funtax.* TO 'funtax'@'localhost';
FLUSH PRIVILEGES;
```

或直接进容器内查（天然落在已授权网段）：

```bash
docker compose exec api sh -c "mysql -u funtax -p -h host.docker.internal funtax -e 'SHOW TABLES;'"
```

## 7. 外部访问页面成功，但接口 `405 Method Not Allowed`

**现象**：`POST /api/auth/sms-code` 返回 405，`GET /` 首页正常。

**根因**：`apps/web/Caddyfile` 里同一 site block 混用了裸露的 `file_server`/`try_files`（针对所有请求）和 `handle /api/*` 块。Caddy 对同层级指令有**固定的默认执行顺序**（与文件里书写的先后顺序无关），`file_server` 会先于 `handle` 执行，拦截所有请求；而 `file_server` 只支持 `GET`/`HEAD`，遇到 `POST` 直接返回 405，请求根本没走到反代逻辑。

**修复**：把所有分支都包进互斥的 `handle` 块显式控制顺序：

```caddyfile
:80 {
    encode gzip

    handle /api/* {
        reverse_proxy api:3000
    }

    handle {
        root * /usr/share/caddy
        file_server
        try_files {path} /index.html
    }
}
```

## 8. 注册接口报 `pool timeout` + `RSA public key is not available client side`

**现象**：`prisma.user.findUnique()` 报连接池超时（`active=0 idle=0 limit=10`），日志最内层 `cause` 显示 RSA 公钥获取失败。

**根因**：MySQL 8 默认账户使用 `caching_sha2_password` 认证插件，非 SSL 连接下客户端首次认证需要向服务端请求 RSA 公钥，但 Prisma 用的 `@prisma/adapter-mariadb` 默认没开启"允许获取公钥"，导致所有连接都卡在认证阶段，最终整个连接池被耗尽超时。

**修复**：把账户认证插件改成 `mysql_native_password`（不需要 RSA 交换）：

```sql
ALTER USER 'funtax'@'172.16.0.0/255.240.0.0' IDENTIFIED WITH mysql_native_password BY '<密码>';
FLUSH PRIVILEGES;
```

（如果 MySQL 版本较新已移除该插件，改为在 `DATABASE_URL` 后加 `?allowPublicKeyRetrieval=true`。）

## 9. `Host '...' is blocked because of many connection errors`

**根因**：上面几轮连接失败/超时次数太多，触发了 MySQL 的 `max_connect_errors` 保护机制，把该来源 IP 暂时拉黑，和当前的配置修复无关，纯粹是历史失败次数累积的副作用。

**修复**：

```bash
mysqladmin -u root -p flush-hosts
```

调试阶段可选地调大阈值减少此类误伤：`/etc/mysql/mysql.conf.d/mysqld.cnf` 加 `max_connect_errors = 10000`，然后 `systemctl restart mysql`。

## 小结：几条通用排查经验

- 报错信息要看**最内层的 `cause`**，外层的 `pool timeout`/`Schema engine error` 往往只是表象。
- Docker 网段、云防火墙/安全组、MySQL host 授权，三者要对齐；任何一层配置用了"想当然"的默认值（比如以为一定是 `172.17.0.0/16`，以为安全组等于全部防火墙）都会导致连不通。
- Caddyfile／Nginx 这类反代配置，同层级指令的**生效顺序不等于书写顺序**，涉及路径分流时尽量用互斥的 `handle`/`location` 块显式控制，不要依赖裸露指令的隐式顺序。
