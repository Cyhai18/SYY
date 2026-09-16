# 「五、部署步骤（在 CVM 上）」命令行逐条解析

对应 `docs/docker-deploy.md` 里的「五、部署步骤」，每一步命令做什么、为什么这样写、
装完怎么验证是否成功。按文档里的 6 个步骤顺序展开。

## 步骤 1：装 MySQL/Redis（原生）+ Docker

```bash
apt install -y mysql-server redis-server
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin
```

- `apt install -y mysql-server redis-server`：装数据库和缓存/队列，`-y` 免交互确认。
  这两个**不进容器**，原因见 `docker-deploy.md` 第七节。
- `curl -fsSL https://get.docker.com | sh`：Docker 官方提供的一键安装脚本，`-f` 请求失败时不输出错误页面内容、`-s` 静默、`-L` 跟随重定向；脚本会自动识别系统发行版并装好 `docker-ce`/`docker-ce-cli`/`containerd`。
- `apt install -y docker-compose-plugin`：装 `docker compose`（v2，子命令形式），不是老版本独立的 `docker-compose` 二进制。

**验证是否安装成功**：

```bash
mysql --version          # 显示版本号即安装成功
redis-cli ping           # 返回 PONG 说明 redis-server 已在运行
systemctl status mysql redis-server   # 都应显示 active (running)
docker --version         # 显示 Docker 版本
docker compose version   # 显示 Compose 版本（注意是 docker 空格 compose，没有中划线）
docker run hello-world   # 能拉取并跑成功，说明 Docker daemon 正常、且有公网访问 Docker Hub 的能力
```

> 如果最后一条 `docker run hello-world` 卡住或超时，说明服务器访问 Docker Hub 有问题，
> 需要按下面「配置国内镜像加速器」的方案处理，否则后面 `docker compose up -d --build`
> 会因为拉不到基础镜像而失败。

### 补充：配置国内镜像加速器（`docker run hello-world` 卡住/超时时用）

`/etc/docker/daemon.json` 这个文件**默认是不存在的**（全新装的 Docker 不会自带这个文件），
需要自己创建；如果之前手动改过 Docker 配置（比如设过日志大小限制），文件可能已经存在，
这种情况要**在已有内容基础上合并**，不能直接覆盖，否则会把之前的配置冲掉。

```bash
# 1. 先看文件在不在、里面有没有内容
cat /etc/docker/daemon.json 2>/dev/null || echo "文件不存在"

# 2a. 如果文件不存在（最常见情况），直接新建：
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com"
  ]
}
EOF

# 2b. 如果文件已存在且有别的配置，改用编辑器手动合并 registry-mirrors 这个字段，
#     不要用 tee/覆盖写，避免丢掉已有配置，例如：
sudo vim /etc/docker/daemon.json
# 在最外层 { } 里加一行 "registry-mirrors": [...]，注意 JSON 格式，字段之间用逗号分隔

# 3. 校验 JSON 格式是否正确（避免手滑漏逗号/括号导致 Docker 起不来）
python3 -m json.tool /etc/docker/daemon.json

# 4. 让配置生效
sudo systemctl daemon-reload
sudo systemctl restart docker
```

**验证加速器是否生效**：

```bash
docker info | grep -A 5 "Registry Mirrors"   # 应该能看到刚才配的镜像地址列表
docker run hello-world                        # 重新跑一次，应该能正常拉取并打印欢迎信息，不再超时
```

> 腾讯云自己也提供加速器地址：登录腾讯云控制台 → 容器镜像服务 TCR → 个人版 → 「镜像加速器」，
> 里面会给一个专属的加速域名（形如 `https://xxxxxx.mirror.tencentcs.com`），把它加进
> `registry-mirrors` 数组里效果通常比第三方公共加速器更稳定，因为是同云内网线路。
>
> 如果配完加速器 `docker run hello-world` 依然超时，大概率不是 Docker 配置问题，而是
> CVM 安全组/`iptables` 挡住了出站的 443 端口，需要先检查网络层面而不是继续折腾
> `daemon.json`。

## 步骤 2：建库建用户 + 放开网络

```bash
mysql -u root -p <<'SQL'
CREATE DATABASE funtax CHARACTER SET utf8mb4;
CREATE USER 'funtax'@'172.17.0.0/255.255.0.0' IDENTIFIED BY '<你的密码>';
GRANT ALL PRIVILEGES ON funtax.* TO 'funtax'@'172.17.0.0/255.255.0.0';
FLUSH PRIVILEGES;
SQL
systemctl restart mysql redis-server
```

- `mysql -u root -p <<'SQL' ... SQL`：这是一个 **heredoc**，把 `<<'SQL'` 到下一个单独一行 `SQL`
  之间的内容整体当作标准输入喂给 `mysql` 命令执行，等价于把这几条 SQL 粘贴进 `mysql` 交互
  命令行里逐条跑；引号包住 `'SQL'` 是为了防止 shell 提前展开里面的变量（比如密码里如果有 `$`）。
- `CREATE DATABASE funtax CHARACTER SET utf8mb4`：建库，字符集选 `utf8mb4` 是为了完整支持中文和
  emoji 等 4 字节字符，避免用旧版 `utf8`（MySQL 里的 `utf8` 实际只支持 3 字节，会存不了某些字符）。
- `CREATE USER 'funtax'@'172.17.0.0/255.255.0.0' ...`：这里的 `@'172.17.0.0/255.255.0.0'`
  是**网段限定**，表示只允许从 `172.17.0.0/16`（Docker 默认网桥网段）这个 IP 段发起的连接用
  `funtax` 账号登录，而不是 `@'localhost'` 或 `@'%'`（后者对所有来源开放，不安全）。这样即使
  MySQL 之后要监听 `0.0.0.0`，也只有容器网络内的连接能用这个账号登进来。
- `GRANT ALL PRIVILEGES ON funtax.* TO ...`：把 `funtax` 库下所有表的全部权限授权给这个账号。
- `FLUSH PRIVILEGES`：让权限修改立即生效（大部分现代 MySQL 版本其实 `GRANT` 后已自动生效，
  这条是保留的保险写法，习惯性执行不会有副作用）。
- `systemctl restart mysql redis-server`：改完配置文件（`bind-address`/`bind`，见下方说明）后
  重启服务使其生效。

> 命令块里没写但文档正文提到的两处需要手动改的配置文件：
> - `/etc/mysql/mysql.conf.d/mysqld.cnf` 里的 `bind-address` 从 `127.0.0.1` 改成 `0.0.0.0`
>   （或更精确地绑定 Docker 网桥网关 `172.17.0.1`），否则宿主机上的 MySQL 只接受本机进程连接，
>   容器连不进来。
> - `/etc/redis/redis.conf` 里的 `bind` 同理也要放开，Redis 默认同样只监听 `127.0.0.1`。

**验证是否成功**：

```bash
mysql -u root -p -e "SELECT user, host FROM mysql.user WHERE user='funtax';"  # 确认 host 是网段而非 localhost
ss -tlnp | grep -E '3306|6379'    # 确认监听地址已经是 0.0.0.0（或网桥网关地址）而不是 127.0.0.1

# 注意：不要在宿主机本机用 `mysql -h 127.0.0.1` 直接测试登录！
# 因为账号被限定成只能从 172.17.0.0/16（Docker 网桥网段）连接，
# 宿主机本机发起的连接来源是 127.0.0.1，不在这个网段内，会报
# `Access denied for user 'funtax'@'localhost'`（这其实是网段限制生效的正常表现，不是密码错）。
# 正确做法是模拟从容器网络内部连接：
docker run --rm mysql:8 mysql -h host.docker.internal -u funtax -p'<你的密码>' funtax -e "SELECT 1;"
```

## 步骤 3：拉代码、准备 `.env`

```bash
git clone <仓库地址> /data/funtax && cd /data/funtax
cp .env.example .env
cp apps/api/.env.example apps/api/.env.production
```

- `git clone <仓库地址> /data/funtax`：把代码克隆到 `/data` 下，`/data` 一般是 CVM 上单独挂载
  的数据盘（区别于系统盘），把代码和后续的上传文件都放在数据盘上，方便扩容/备份。
- `cp .env.example .env`：复制根目录的环境变量模板，之后要手动编辑 `.env` 把 `MYSQL_PASSWORD`
  换成步骤 2 里 `CREATE USER` 时设的真实密码（见 `docker-deploy.md` 第八节）。
- `cp apps/api/.env.example apps/api/.env.production`：同理复制 `api` 服务专用的环境变量模板，
  需要手动填 `DATABASE_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET` 等真实值
  （`JWT_*` 建议用 `openssl rand -hex 32` 生成随机值，不要用模板里的占位符）。

**验证是否成功**：

```bash
ls -la /data/funtax                 # 能看到代码文件说明 clone 成功
cat .env                            # 确认 MYSQL_PASSWORD 已经改成真实密码，不是 changeme
cat apps/api/.env.production        # 确认 DATABASE_URL/JWT_* 都已填真实值
```

## 步骤 4：构建并启动容器

```bash
docker compose up -d --build
```

- `-d`：后台运行（detached），不占用当前终端。
- `--build`：启动前先按各服务的 `Dockerfile` 重新构建镜像（第一次部署必须加，后续如果代码没变
  只是重启容器可以省略这个参数，加了也没坏处只是会多花时间检查是否需要重建）。
- 这一条命令会依次构建 `gotenberg`（直接用官方镜像不用构建）、`ocr-service`、`doc-service`、
  `api`、`web` 五个服务并启动，`api`/`web` 的构建过程见 `docker-deploy.md` 二.1/二.2。

**验证是否成功**：

```bash
docker compose ps            # 5 个服务的 STATUS 都应是 running/healthy，没有 Restarting 或 Exited
docker compose logs api --tail=50    # 看 api 启动日志有没有报错（比如连不上数据库）
curl -I http://127.0.0.1        # web 容器应该有 HTTP 响应（本地测试时用 :80，不涉及 HTTPS）
```

## 步骤 5：数据库迁移

```bash
docker compose exec api npx prisma migrate deploy
```

- `docker compose exec api ...`：进入正在运行的 `api` 容器执行命令（区别于 `docker compose run`
  会另起一个新容器）。
- `npx prisma migrate deploy`：生产环境专用的 Prisma 迁移命令，只应用已经生成好的迁移文件到
  数据库（不会像 `prisma migrate dev` 那样交互式生成新迁移或做开发环境的 shadow database 校验），
  是 CI/CD 和生产部署的标准做法。

**验证是否成功**：

```bash
docker compose exec api npx prisma migrate status   # 显示所有迁移都已应用，无 pending
mysql -u funtax -p -h 127.0.0.1 funtax -e "SHOW TABLES;"   # 能看到业务表说明迁移已落地
```

## 步骤 6：查看日志/状态

```bash
docker compose ps
docker compose logs -f api
```

- `docker compose ps`：列出所有服务容器的当前状态（运行中/已退出/重启次数等）。
- `docker compose logs -f api`：`-f`（follow）持续输出 `api` 容器的日志，类似 `tail -f`，
  用于实时观察请求日志或排查报错；不加 `-f` 则只打印一次当前已有日志然后退出。

**日常运维常用的补充命令**（文档没写但排查时会用到）：

```bash
docker compose logs -f              # 不加服务名，同时看全部服务的日志
docker compose restart api          # 只重启某一个服务，不用整体 down/up
docker compose down                 # 停止并删除容器（不带 -v 不会删 volume，数据不丢）
```

## 附录：实际部署时踩过的坑（MySQL/Redis 网络打通全过程）

按真实排查顺序记录，遇到同样问题时可以照着这个顺序对照排查。

### 坑 1：在宿主机本机用 `mysql -h 127.0.0.1` 测试登录，报 `Access denied for user 'funtax'@'localhost'`

- **现象**：`mysql -u funtax -p -h 127.0.0.1 funtax -e "SELECT 1;"` 报错，账号 host 明明是
  `172.17.0.0/255.255.0.0`，报错却显示 `'funtax'@'localhost'`。
- **原因**：账号被网段限定为只能从 `172.17.0.0/16`（Docker 网桥网段）连接，宿主机本机发起的连接
  来源是 `127.0.0.1`，不在这个网段内，MySQL 匹配不到对应账号，会退回按 `localhost` 走匹配逻辑，
  自然拒绝。**这是网段限制生效的正常表现，不是密码错、也不是配置错**。
- **教训**：验证"容器能不能连宿主机 MySQL"这件事，必须**从容器网络内部发起连接**去测试，
  不能直接在宿主机本机用 `mysql -h 127.0.0.1` 测——这两者是完全不同的网络路径。

### 坑 2：用 `docker run mysql:8 mysql -h ... -p'<你的密码>' ...` 测试，结果打印出一大段 `mysql --help` 用法说明

- **现象**：命令跑完不是查询结果，而是 `mysql`  客户端的帮助/用法文本。
- **原因**：把命令里 `<你的密码>` 这个占位符原样复制执行了，没有替换成真实密码；`<` 在 bash 里
  是输入重定向符号，即使被单引号转成字面量，`mysql` 客户端收到的也是一串不合法的密码参数，
  导致参数解析出错，走到打印用法说明的分支。
- **教训**：文档/聊天记录里所有 `<xxx>` 形式的占位符，执行前一定要先替换成真实值，不能整段复制粘贴。

### 坑 3：加了 `-it` 交互式密码输入后，报 `Unknown MySQL server host 'host.docker.internal' (-2)`

- **原因**：`docker compose` 里能用 `host.docker.internal` 是因为 `docker-compose.yml` 手动加了
  `extra_hosts: - 'host.docker.internal:host-gateway'`；单独用 `docker run` 起临时容器**不会**
  自动带上这条映射，容器里没有这个域名的解析记录。
- **解决**：`docker run` 也要手动加等价参数：
  ```bash
  docker run --rm -it --add-host=host.docker.internal:host-gateway mysql:8 ...
  ```
- **教训**：用 `docker run` 起临时容器做联调测试时，网络配置（`extra_hosts`/自定义网络等）不会
  从 `docker-compose.yml` 里继承，需要在命令行手动补全。

### 坑 4：DNS 解析通了，但报 `Can't connect to MySQL server on 'host.docker.internal:3306' (111)`

- **原因**：`(111)` = Connection refused，说明 MySQL 进程压根没有监听 Docker 网桥能访问到的地址，
  `bind-address` 还是默认的 `127.0.0.1`。
- **排查命令**：
  ```bash
  grep -i bind-address /etc/mysql/mysql.conf.d/mysqld.cnf   # 看配置文件写的什么
  ss -tlnp | grep 3306                                       # 看实际监听地址是什么
  ```
  两者都要核对，只改文件没重启 MySQL 服务也不会生效。
- **解决**：把 `bind-address`（以及 `mysqlx-bind-address`）改成 `0.0.0.0`（或更收敛的
  Docker 网桥网关地址，如 `172.17.0.1`），`systemctl restart mysql` 使其生效。
- **Redis 同款问题，但多一个坑**：Redis 除了 `bind` 要放开，还有一个**保护模式
  （`protected-mode yes`）** 是 MySQL 没有的机制——即使 `bind` 改了，只要没设 `requirepass`，
  保护模式下依然只接受本机连接，必须同时把 `protected-mode` 改成 `no`（或者设一个 `requirepass`），
  这一步很容易漏改，导致改完 `bind` 还是 `Connection refused`。

### 坑 5：MySQL 密码验证 `Access denied for user 'funtax'@'172.17.0.2' (using password: YES)`

- **现象**：这时候 DNS、网络连通、`bind-address`、防火墙全部正常了（能看到来源 IP
  `172.17.0.2` 已经被 MySQL 正确识别，说明网段权限也没问题），但密码校验失败。
- **原因**：单纯的密码记错/打错（交互式输入时手滑，或者密码含特殊字符被终端/输入法误处理）。
- **解决**：不用纠结"当初设的密码到底是什么"，直接用 `root` 重设一个自己现在确定记得住的新密码
  （建议先用纯字母数字排除特殊字符干扰），改完两处要跟着同步（见下面「注意事项」）。
- **验证密码时的技巧**：用非交互方式 + 临时关闭 shell 历史，避免密码明文残留在 `~/.bash_history`：
  ```bash
  set +o history
  docker run --rm --add-host=host.docker.internal:host-gateway mysql:8 \
    mysql -h host.docker.internal -u funtax -p'真实密码' funtax -e "SELECT 1;"
  set -o history
  ```

## 注意事项（避免以后重复踩坑）

1. **改宿主机 MySQL/Redis 密码后，一定要同步两个地方**，否则容器连接会突然失败且报错信息看起来像别的问题：
   - 根目录 `.env` 的 `MYSQL_PASSWORD`
   - `apps/api/.env.production` 里 `DATABASE_URL`/`REDIS_URL` 中的密码部分
2. **不要把真实密码明文写进会被保留的命令行/日志里**：交互式排查时优先用 `-p`（不带值，弹出提示符输入）；
   非交互场景要带密码时，先 `set +o history` 再执行，用完 `set -o history` 恢复。
3. **`docker run` 临时容器 ≠ `docker compose` 里的服务**：`extra_hosts`、自定义网络、`env_file`
   等 compose 里配置的内容，`docker run` 单独起容器时不会自动带上，需要手动通过 `--add-host`
   等参数补齐，仅用于临时联调测试，不代表 compose 跑起来的行为会不一致。
4. **Redis 比 MySQL 多一个「保护模式」要关**：光改 `bind` 不够，`protected-mode` 也要改成 `no`
   （或者配 `requirepass`），两个要一起检查。
5. **`bind-address`/`bind` 放开到 `0.0.0.0` 之后，必须同步收紧防火墙**，只放行 Docker 网桥网段
   （`172.17.0.0/16`）访问 3306/6379，公网安全组完全不开放这两个端口，避免"为了让容器连上"
   反而把数据库端口暴露到公网。
6. **排查网络类报错要分层验证，不要跳步骤**：`Unknown host`（DNS 没解析到）→
   `Connection refused`（进程没监听/防火墙拦截）→ `Access denied`（认证失败）——这三种报错
   分别对应完全不同层面的问题，本次实际排查也正好按这个顺序依次遇到、依次解决，
   按这个顺序定位能少走弯路。
