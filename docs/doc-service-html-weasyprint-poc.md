# doc-service 证书生成方案 PoC：HTML/CSS + WeasyPrint（方案 B）

## 背景

`doc-service` 现有方案（方案 A）用 `docxtpl` 渲染 `.docx` 占位符，再用 `soffice`
（LibreOffice headless）转 PDF，转换过程加了全局锁保证稳定，但批量生成约 200 份
证书时速度慢、串行、依赖外部进程。为此评估了纯 Python 方案（方案 B）：
Jinja2 直接渲染 HTML/CSS 模板，再用 WeasyPrint 转 PDF，摆脱 `soffice` 依赖。

## 结论（当前状态）

**PoC 已验证可以打通全链路（Jinja2 → HTML → WeasyPrint → PDF），内容可以做到
完整不丢失，但排版还原度不理想，与原始 `.docx` 模板存在较多格式差异**（用户
截图确认，视觉观感与原模板差别较大）。是否继续投入打磨这条路径，还是转回
优化方案 A（LibreOffice worker pool / 常驻监听），待用户后续决策。

## 已验证内容

- 5 个证书模板（`EU_CONSULTEN_SRLS` / `OVERSEA_WALKERS_EU/GB/TR/US`）结构高度
  一致，排版元素评估为"低复杂度"：A4 单栏页面、两张表格（甲乙方信息表 + 店铺
  信息表，含 `gridSpan`/循环行）、3 种常见字体（Arial/Times New Roman/宋体）、
  1 张 logo 图片、单元格底纹/高亮、单线边框，无分栏/SmartArt/复杂域代码/嵌套
  表格/自动编号/水印等 Word 高级特性，理论上适合 HTML/CSS + WeasyPrint。
- 用 `EU_CONSULTEN_SRLS` 做了完整 PoC：
  - 页面尺寸、页边距从原始 `.docx` XML（`w:pgSz`/`w:pgMar`，单位 twips）精确
    换算为 mm。
  - 两张表格列宽比例从 `w:gridCol` 精确数值换算为百分比（甲乙方表 29.14%/
    70.86%；店铺表 7 列按原始 twips 比例）。
  - 正文长条款（甲方职责/乙方职责/最终条款等）全文照抄补全，非占位文字。
  - 用 `pdfminer.six` 程序化校验：PDF 4 页、约 1.4 万字符，占位符全部被替换
    为实际数据，未发现内容缺失。
- 尽管内容完整且关键尺寸是从原文档精确换算的，**用户截图对比后确认排版
  问题较多**（本机无法安装 `soffice` 生成参照 PDF，也无法在当前工具环境里
  直接查看图片，视觉核对全部由用户人工完成）。具体问题点尚未逐条记录，
  后续如继续该方向需要用户提供具体截图标注。

## 涉及文件（保留，供后续继续打磨）

- `services/doc-service/poc/template.html`：HTML/CSS 模板（对应 `EU_CONSULTEN_SRLS`）
- `services/doc-service/poc/render.py`：Jinja2 渲染 + WeasyPrint 出 PDF 的脚本
- `services/doc-service/poc/logo.png`：从原 `.docx` 提取的 logo 图片
- `services/doc-service/poc/output_v2.pdf`：最新一版 PoC 输出（供对比用）
- `services/doc-service/.venv_poc/`：PoC 专用虚拟环境（未合入正式 `requirements.txt`）

以上均为 PoC 产物，未接入 `services/doc-service/app.py` 正式逻辑，不影响现有
线上方案（方案 A）运行。

## 本机环境变更记录（重要：需要用户知悉/后续可清理）

在这台 macOS 开发机上，为了跑通本次 PoC，执行了以下会改动本机环境的操作：

### 1. Homebrew 本身

- 本机 Homebrew 因 "unknown macOS version 26.5.2" 报错无法直接 `brew install`。
- 尝试过 `git fetch/reset` 更新 `/opt/homebrew` 到最新 `origin/master`（其中一次
  因原 `origin` remote 指向异常，执行了
  `git remote set-url origin https://github.com/Homebrew/brew.git` 修正远程地址）。
- 最终绕过方式：设置环境变量 `HOMEBREW_FAKE_MACOS=15.5`（仅作用于当次终端
  session，未写入 shell 配置文件持久化），让 Homebrew 认为系统版本是 15.5
  从而允许继续安装。**这个环境变量不会自动持久生效，重开终端即失效。**

### 2. 系统库（通过 `brew install`，全局安装，非项目内隔离）

- `pango`（及其依赖链，如 `harfbuzz`、`cairo`、`fontconfig` 等 — WeasyPrint
  文本渲染必需）
- `poppler`（及其依赖 `nspr`、`nss`、`openjpeg` — 供 `pdf2image` 把 PDF 转
  图片用，仅本次调试临时需要，非 WeasyPrint 运行时依赖）

以上库安装在 `/opt/homebrew/Cellar` 下，是全局系统级安装，如果后续放弃方案 B，
且没有其他项目依赖它们，可以用 `brew uninstall pango poppler` 连带清理（注意
`brew autoremove` 前确认没有其他软件依赖）。

### 3. Python 虚拟环境（项目内隔离，风险低）

新建了 `services/doc-service/.venv_poc/`（独立于正式 `.venv`，未提交到
`requirements.txt`），在其中 `pip install` 了：

- `weasyprint`
- `jinja2`
- `pdfminer.six`（仅用于程序化校验 PDF 文本内容是否完整，非渲染依赖）
- `pdf2image`（仅用于把 PDF 转成图片方便截图对比，非渲染依赖）

这个 venv 是纯目录级隔离，删除 `services/doc-service/.venv_poc/` 目录即可完全
清理，不影响其他 Python 环境。

### 4. 运行时环境变量

每次运行 PoC 脚本时都需要显式设置：

```bash
export DYLD_LIBRARY_PATH="/opt/homebrew/lib:$DYLD_LIBRARY_PATH"
```

原因：WeasyPrint 底层通过 CFFI 加载 `libgobject-2.0-0` 等动态库，本机 Python
默认找不到 Homebrew 装的库路径，需要手动指定。这个变量只在设置它的那个终端
session 内生效，不是持久化的系统配置。

## 后续如需清理本机环境

```bash
# 删除 PoC 专用虚拟环境（项目内，安全）
rm -rf services/doc-service/.venv_poc

# 如确认不再需要，卸载全局系统库（谨慎执行，确认无其他依赖后再操作）
brew uninstall pango poppler
```

## 决策结果：转回方案 A

方案 B 排版还原度不达标，已放弃。`services/doc-service/.venv_poc/` 已删除。
后续按下面的方案 A 实现方式推进。

## 方案 A 实现方式：LibreOffice 常驻进程池

### 现状问题（`app.py` 当前实现）

每次请求都是：`docxtpl` 渲染 → **临时启动一个全新 `soffice --headless` 进程**
（带全新 `-env:UserInstallation` profile 目录）→ 转 PDF → 销毁进程。加上
`asyncio.Lock()` 把所有请求串行化成"一次只能转一份"。

问题：
1. **启动开销大**：LibreOffice 每次冷启动（加载字体、初始化 UNO 环境）通常
   要 1~3 秒，而实际转换本身可能只要几百毫秒，冷启动占比很高。
2. **完全串行**：`_soffice_lock` 保证同一时刻只有一个 `soffice` 进程在跑，
   200 份证书 = 200 次冷启动 + 严格排队，批量生成的墙钟时间约等于
   `200 × (启动开销 + 转换耗时)`。
3. **无并发度**：即使机器有多核，也发挥不出来。

### 优化目标

- **常驻**：LibreOffice 只在服务启动时初始化一次（或若干个实例常驻），
  避免每次请求都冷启动。
- **并发**：允许多个转换任务并行，充分利用多核。
- **稳定**：单个 LibreOffice 实例长时间运行容易积累内存泄漏/僵死状态，
  需要健康检查 + 自动重启机制，避免"用着用着就挂了"影响服务可用性。
- **用户体验**：批量生成 200 份时，前端应能看到进度反馈，而不是一个长达
  几分钟的请求挂起等待；单份生成保持现有同步接口不变，不引入额外复杂度。

### 具体实现方案

#### 1. LibreOffice 以监听模式（listener）常驻运行

不再每次请求都拉起新进程，而是让 `soffice` 常驻并监听 UNO socket：

```bash
soffice --headless --invisible --nocrashreport --nodefault --norestore \
  --nofirststartwizard --nologo \
  --accept="socket,host=127.0.0.1,port=2002;urp;" \
  -env:UserInstallation=file:///tmp/lo_worker_0
```

服务进程（Python）通过 `pyuno`（LibreOffice 自带的 UNO Python 绑定）连上这
个常驻实例的 socket，发送"打开这个 docx → 导出为 pdf"的指令，而不是每次
`subprocess.run(["soffice", ...])`。转换本身走进程内 RPC 调用，没有冷启动
成本。

> 技术选型说明：`unoconv` 本质上也是"每次命令行调用启动一次 soffice 子进程"
> 的封装，并不天然支持长连接常驻+多路复用，且项目多年未积极维护，对新版
> LibreOffice 的兼容性存在风险，不适合作为常驻 worker pool 的连接层，这里
> **直接采用 `pyuno`**，不再作为待选项保留。

#### 2. 多实例 worker pool，而不是单实例

单个 LibreOffice UNO 实例本身也不是线程安全的、同一时刻建议只处理一个文档，
所以要做并发就要开多个监听实例（比如 3~4 个，对应端口 2002/2003/2004/2005），
组成一个进程池：

- 服务启动时（FastAPI `lifespan`）拉起 N 个 `soffice --accept=socket,port=200X`
  子进程，各自独立 `UserInstallation` profile 目录（避免 profile 锁冲突）。
- 用一个 `asyncio.Queue` 做任务队列 + N 个 worker 协程，每个 worker 独占一个
  端口对应的 UNO 连接，从队列里取任务、转换、回填结果（`asyncio.Future`）。
- 单份证书生成请求：提交任务到队列，await 对应 future，行为上和现在的同步
  接口完全一样，前端无感知。
- 批量生成 200 份：一次性把 200 个任务扔进队列，N 个 worker 并行消费，
  墙钟时间约等于 `200/N × 单次转换耗时`，而不是 `200 × (冷启动+转换)`。
- 每个 worker 内部对自己独占的 UNO 连接**同一时刻只能处理一个转换任务**
  （单实例连接不支持并发调用），因此每个 worker 协程本身就是"串行消费自己
  的那部分队列"，并发度由 worker 数量 N 决定，而不是靠对同一个连接发起
  并发请求，实现时要注意不要在同一个 worker 上并发派发任务。

#### 3. 健康检查与自动重启

- 每个 worker 维护一个"最近使用时间"和"已处理任务计数"。
- **主要检测手段是单次转换任务的超时**（比如 30 秒）：UNO 服务卡死的典型
  表现是连接仍然存在、但转换任务挂起不返回，超时判定比心跳更能反映真实
  健康状态，超时则判定该 worker 异常，触发下面的重启流程，任务失败返回给
  调用方（而不是无限挂起）。
- 心跳 ping（定期，比如每 30 秒，查询版本信息之类的轻量调用）作为辅助手段，
  主要用于探测"连接已经彻底断开/进程已经消失"这类明显故障，无法探测"任务
  挂起但连接看起来正常"的半死状态，不能替代任务超时机制。
- 也可以叠加"处理满 N 次任务后主动重启"策略，预防内存缓慢泄漏累积。
- 探测失败、任务超时或任务执行抛出 UNO 层异常时：kill 掉对应子进程、清理它
  的 profile 目录、重新拉起一个新实例顶替，期间该 worker 暂时从池里摘除，
  不影响其他 worker 正常工作（避免"一个实例挂了，整个服务不可用"）。

#### 4. 生成接口的用户体验：单个/批量统一为一个接口

不再区分"单份同步接口"和"批量异步接口"两套 API，`apps/api` 侧调用方只需
认识一个接口，用统一的异步任务模型处理，1 份和 200 份走同一条路径：

- `POST /certificate/generate`：请求体统一为一个证书数据数组（哪怕只有
  1 份也放进数组里）。接口把每一份任务扔进队列后**立即返回**一个
  `batch_id`（不再阻塞等待转换完成），不管数组长度是 1 还是 200，行为一致。
- `GET /certificate/batch/{batch_id}`：返回整体状态（`pending` /
  `processing` / `done` / `partial_failed`）、已完成数/总数，以及每一份的
  单独状态和下载地址（成功可下载，失败带错误信息）。
- `GET /certificate/batch/{batch_id}/download`：全部完成后按需下载
  （单份直接返回该 PDF；多份可选择返回 zip 打包，或者前端遍历每份的
  下载地址逐个拉取）。
- 好处：调用方心智负担低（不用区分调什么接口），单份场景下如果前端体验上
  希望"看起来像同步"，可以在前端简单包一层"提交后轮询直到 done"，或者用
  短轮询间隔（比如 300ms）近似同步体验；服务端只维护一套任务处理逻辑，
  不用同时维护同步路径和异步路径两套代码，减少故障点。

#### 5. 部署形态

- Worker 数量建议按 CPU 核数留一定余量配置（比如 4 核机器配 2~3 个
  worker），可通过环境变量 `LIBREOFFICE_WORKER_COUNT` 配置，避免写死。
- **内存预算同样是硬约束，甚至比 CPU 更容易先触顶**：每个常驻 `soffice`
  实例都会独立加载完整字体表和 UI 资源，单实例常驻内存通常在 300~500MB
  量级，开 N 个实例约等于 N 倍占用（比如 4 个 worker 可能吃到 1.5~2GB）。
  配置 worker 数量时要同时按"CPU 核数"和"可用内存 ÷ 单 worker 内存预留
  (建议按 500MB 估算)"两个维度取较小值，避免在小规格机器上把内存打满。
- 每个 worker 独立 `UserInstallation` 目录（如 `/tmp/lo_worker_{i}`），
  服务启动时清理残留目录，避免上次异常退出留下的锁文件导致新实例起不来。
- 服务优雅关闭（`lifespan` 的 shutdown 钩子）时对所有 worker 子进程发送
  `SIGTERM`，超时未退出再 `SIGKILL`，避免留下僵尸进程。

#### 6. 引入 Redis 后的变更

上面第 4 点的任务状态、进度、结果目前默认用**进程内内存结构**保存（比如一个
`dict[batch_id -> BatchState]`），有一个明显缺陷：**服务重启/多实例部署时
状态会丢失或不共享**。如果引入 Redis，主要变更点：

- **任务队列**：`asyncio.Queue`（进程内、单实例）→ Redis List/Stream 或
  轻量任务队列库（如 `arq`，专为 asyncio + Redis 设计，比 Celery 更轻）。
  好处：doc-service 可以水平扩容多个实例，所有实例的 worker 共同消费同一个
  Redis 队列，不再受限于单进程内的 worker pool 上限；某个实例重启，队列里
  还没消费的任务不会丢，会被其他实例接手。
- **任务/批次状态存储**：`dict` 内存态 → Redis Hash（每个 `batch_id` 一个
  hash，字段包括 `total`/`done`/`failed`/每份子任务状态）。好处：服务重启
  后 `batch_id` 状态还能查到；多实例部署时，无论请求打到哪个实例，查询到
  的状态都一致（不会出现"生成用实例 A 处理，查询状态打到实例 B 查不到"的
  问题）。
- **生成结果（PDF 二进制）存放**：进程内临时目录 → 可以继续用临时目录/本地
  磁盘（如果 doc-service 只有一个副本、有共享存储），或者上传到对象存储
  （更彻底的方案，多实例场景下必须这么做，不能依赖本地磁盘）。Redis 本身
  不适合存大文件（PDF 通常几十 KB～几百 KB，硬塞进 Redis 也不是不行，但更
  合适的做法是 Redis 只存"结果在哪"的指针/元数据，PDF 实体放文件系统或对象
  存储）。
- **worker 健康检查/心跳**：可以用 Redis 做 worker 心跳注册（`SETEX
  worker:{id} 30 alive`），配合上面的自动重启逻辑，多实例部署时也能统一
  观测所有 worker 的存活状态（现在方案是单实例内部 dict 记录，多实例下彼此
  看不到）。
- **不需要变更的部分**：LibreOffice 常驻 worker pool 本身的实现（UNO
  socket 连接、每个 worker 独立 profile 目录、超时/自动重启机制）跟是否用
  Redis 无关，这套仍然运行在每个 doc-service 实例内部，Redis 只是解决"状态
  和队列要不要跨实例共享"的问题。
- **什么时候值得引入**：如果 doc-service 未来只部署单实例、批量任务量不大
  （几百份量级），进程内内存队列 + 状态字典已经够用，引入 Redis 是增加一个
  外部依赖换取"多实例水平扩容"和"重启不丢状态"的能力，需要按实际部署规模
  决定是否值得；如果已经有 Redis 基础设施（比如 `apps/api` 已经在用），
  接入成本会比从零引入低很多。

### 预期收益

- 单份证书生成延迟：从"包含冷启动"降到"仅转换耗时"，通常可以从秒级降到
  百毫秒~1秒级。
- 200 份批量生成：从严格串行的 `200×(启动+转换)` 降到 `~200/N×转换`，
  N=3~4 时理论上有 3~4 倍提速，且不需要更换技术栈（仍然是 `docxtpl` +
  LibreOffice，格式还原度维持现状，不存在方案 B 的排版风险）。
- 通过多 worker + 健康检查/自动重启，避免"单点故障拖垮整个服务"，比现在
  的单一全局锁更健壮。

### 待确认的技术选型细节（实现前需要拍板）

1. `pyuno` 环境配置方式：需要 `soffice` 自带的 Python，或正确设置
   `PYTHONPATH`/`URE_BOOTSTRAP` 指向 LibreOffice 安装目录，具体路径因平台
   （macOS/Linux 容器）而异，实现时需要针对目标部署环境验证一遍。
2. Worker 数量的默认值和是否要做成可动态伸缩（低峰期减少常驻进程节省内存），
   需要同时结合 CPU 核数和内存预算两个维度定默认值。
3. 批量接口的任务持久化方式：内存队列（服务重启则批次丢失，需要调用方重
   新提交）够不够用，还是要落一个轻量的状态存储（比如 SQLite/Redis）保证
   服务重启后批次状态不丢。
4. 是否采用下面的 Gotenberg 替代自建 worker pool（详见下一节对比）。

## 自建 worker pool vs 接入 Gotenberg

Gotenberg 是一个开源的、基于 LibreOffice 的文档转换 HTTP 微服务（容器化
部署），本质上是"已经帮你实现了一遍上面第 1~3 点"：内部自带 LibreOffice
常驻监听、请求排队/并发处理、超时与实例健康管理，对外暴露一个简单的
HTTP 接口（上传 docx，返回 pdf）。

| 维度 | 自建 worker pool | 接入 Gotenberg |
| --- | --- | --- |
| 开发工作量 | 需要自己实现 UNO 连接管理、并发调度、健康检查/自动重启、部署形态 | 只需把 `_convert_to_pdf` 换成一次 HTTP 调用，`docxtpl` 渲染逻辑不变 |
| 运维负担 | 需要自己维护 worker 进程的启动/监控/日志 | 多一个独立容器/服务需要部署和监控，但内部复杂度不用自己管 |
| 可控性 | 完全自控，出问题能直接改代码定位 | 黑盒，出问题依赖 Gotenberg 自身的日志和社区支持 |
| 部署依赖 | 不引入新组件，还是当前的 Python 服务 + 系统 `soffice` | 需要额外部署一个 Docker 容器（或在现有容器编排里加一个服务） |
| 成熟度/稳定性 | 需要自己把健康检查、重启、并发边界情况都踩一遍 | 已被广泛使用（PDF 生成场景的社区标准方案之一），踩坑成本更低 |
| 与现有格式还原度关系 | 无差异，内部同样是调用 LibreOffice 做转换 | 无差异，同样是调用 LibreOffice 做转换，不影响排版还原度 |

**建议**：
- 如果部署环境已经用容器编排（Docker Compose/K8s 等），接入 Gotenberg 是
  更省事的路径——用别人已经趟过坑的方案换取自己少写一大块基础设施代码，
  尤其是健康检查/自动重启这部分本身就是本方案里最容易出 bug 的环节。
- 如果部署环境比较简单（比如直接跑在一台机器上、不想引入容器依赖，或者
  对外部黑盒组件有顾虑，希望完全自控），继续按文档里"自建 worker pool"
  的方案推进也是可行的，工程量可控。
- 两条路径对最终的格式还原度、性能收益结论都没有影响，纯粹是"自己实现
  基础设施" vs "复用现成基础设施"的工程取舍，可以按团队现有技术栈和部署
  习惯决定。

## 决策结果：接入 Gotenberg

当前部署形态是**普通云主机/单机部署**，不引入自建 worker pool 的健康检查/
自动重启复杂度，改为接入 Gotenberg，用 Docker 跑一个独立的转换服务。

### 本地开发环境接入

1. **启动 Gotenberg 容器**（本机已装 Docker）：

   ```bash
   docker run -d --name gotenberg --restart unless-stopped \
     -p 3010:3000 gotenberg/gotenberg:8
   ```

   启动后 `http://localhost:3010` 即为转换服务，内部已包含 LibreOffice、
   常驻监听、并发处理，本机不再需要单独安装/配置 `soffice`。

2. **`doc-service` 环境变量**：新增 `GOTENBERG_URL`（默认
   `http://localhost:3010`），本地开发时指向上面起的容器。

3. **联调验证**：`curl` 测试转换接口是否可用：

   ```bash
   curl -sf -o /tmp/test.pdf \
     -F "files=@services/doc-service/templates/EU_CONSULTEN_SRLS.docx" \
     http://localhost:3010/forms/libreoffice/convert
   ```

### 云主机部署接入

单机部署场景，用 **Docker Compose** 把 `doc-service` 和 `gotenberg` 编排
在同一个 compose 网络里，内网互访，不对外暴露 Gotenberg 端口：

```yaml
services:
  gotenberg:
    image: gotenberg/gotenberg:8
    restart: unless-stopped
    # 不需要 ports 映射到宿主机，仅供 doc-service 内网访问
    expose:
      - "3000"

  doc-service:
    build: ./services/doc-service
    restart: unless-stopped
    environment:
      - GOTENBERG_URL=http://gotenberg:3000
    depends_on:
      - gotenberg
    ports:
      - "8000:8000"   # 按现有对外端口配置调整
```

- `doc-service` 通过 compose 内部 DNS（服务名 `gotenberg`）访问，无需关心
  容器 IP。
- 云主机上只需要保证 Docker/Docker Compose 已安装，`docker compose up -d`
  即可同时拉起两个服务；升级/回滚只需要重新 `docker compose up -d` 对应
  服务，不涉及宿主机上的 `soffice`/LibreOffice 环境维护。
- 若云主机上还留有旧的 `soffice` 安装（现有 `app.py` 依赖），接入 Gotenberg
  后可以移除该依赖，不再需要维护宿主机上的 LibreOffice 环境。

### `app.py` 代码改动方向

- 新增依赖 `httpx`（需先确认后再执行 `pip install`/加入
  `requirements.txt`）。
- 用一次 HTTP multipart 请求替换现有的 `_convert_to_pdf`
  （`subprocess.run(["soffice", ...])`），`docxtpl` 渲染 docx 的逻辑不变：

  ```python
  import httpx

  GOTENBERG_URL = os.environ.get("GOTENBERG_URL", "http://localhost:3010")

  async def _convert_to_pdf(docx_path: Path) -> bytes:
      async with httpx.AsyncClient(timeout=30) as client:
          with open(docx_path, "rb") as f:
              resp = await client.post(
                  f"{GOTENBERG_URL}/forms/libreoffice/convert",
                  files={
                      "files": (
                          docx_path.name,
                          f,
                          "application/vnd.openxmlformats-officedocument"
                          ".wordprocessingml.document",
                      )
                  },
              )
          resp.raise_for_status()
          return resp.content
  ```

- 可以删除的旧逻辑：`_soffice_lock`（全局锁）、`profile_dir` 临时目录管理、
  `SOFFICE_BIN` 环境变量、`subprocess` 超时/异常处理——Gotenberg 内部自己
  管理并发与实例健康，`app.py` 变成无状态的薄封装，不再需要自建并发控制。
- 批量场景：可以直接对多份数据并发发起 HTTP 请求（比如
  `asyncio.gather` 配合一个并发信号量限流，避免瞬时打满 Gotenberg），
  不需要再自己实现队列/worker pool。
- Gotenberg 健康检查：`GET {GOTENBERG_URL}/health`，可用于 `doc-service`
  启动时探测依赖是否就绪。

### 待确认事项

1. 是否同意新增 `httpx` 依赖（用于替换现有转 PDF 的 HTTP 调用方式）。
2. 云主机上是否已安装 Docker/Docker Compose，若未安装需要先具备该前提。
3. 现有 `soffice` 相关代码/环境变量（`SOFFICE_BIN`、锁、临时 profile 目录
   清理）是否直接删除，还是保留作为过渡期 fallback。
