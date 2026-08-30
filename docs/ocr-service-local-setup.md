# OCR 微服务本地启动命令详解（Python 新手向）

针对 `services/ocr-service/README.md` 里的这组命令，逐行解释每一步在做什么、为什么要这么做。

```bash
cd services/ocr-service
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

## 1. `cd services/ocr-service`

切换到 OCR 微服务的代码目录。这是一个独立的 Python 项目（不属于 pnpm workspace），后面所有命令都要在这个目录下执行。

## 2. `python3 -m venv .venv`

**创建一个"虚拟环境"（virtual environment）。**

- Python 的包（library）是全局安装的，如果不同项目需要同一个包的不同版本，会互相冲突。虚拟环境相当于给这个项目单独开一个"隔离的 Python 安装"，装的包只在这个项目里生效，不会影响你电脑上其他 Python 项目或系统自带的 Python。
- `python3 -m venv .venv` 的意思是：调用 Python 自带的 `venv` 模块，在当前目录下创建一个名为 `.venv` 的文件夹，这个文件夹里就是一份独立的 Python 环境（解释器 + 包安装目录）。
- 这一步只需要做一次。执行完之后，`services/ocr-service/.venv/` 目录会出现，里面包含 `bin/`（可执行文件）、`lib/`（安装的包）等。
- 类比：如果你用过 Node.js，`.venv` 大致相当于项目的 `node_modules` + 局部 Node 版本管理的结合体。

## 3. `source .venv/bin/activate`

**激活刚才创建的虚拟环境。**

- 执行后，当前这个终端窗口里，`python3`、`pip` 等命令会指向 `.venv` 里的版本，而不是系统全局的 Python。
- 激活成功后，终端提示符前面通常会多出一个 `(.venv)` 前缀，提示你现在处于虚拟环境中。
- **这一步每次开一个新终端窗口/新会话都要重新执行一次**（不像创建虚拟环境只需一次）。如果忘记激活，直接装包会装到系统全局环境里，容易造成混乱。
- 退出虚拟环境用 `deactivate` 命令（不影响本次任务，了解即可）。

## 4. `pip install --upgrade pip`

**升级 `pip`（Python 的包管理工具，类似 npm/pnpm）到最新版本。**

- `pip` 负责从 PyPI（Python 官方包仓库，类似 npm 的 registry）下载并安装第三方包。
- 系统自带的 `pip` 版本可能比较老（比如本机是 `pip 21.2.4`），老版本在解析复杂依赖关系时可能出错或效率低。升级一下更保险，避免踩坑。
- 这一步是在**已激活的虚拟环境内**执行的，所以只会升级 `.venv` 里的 `pip`，不影响系统全局。

## 5. `pip install -r requirements.txt`

**按照 `requirements.txt` 文件里列出的清单，安装所有依赖包。**

`requirements.txt` 类似 Node.js 项目里的 `package.json`（但更简单，只列包名和版本号，没有 devDependencies 之分）。本项目里的内容是：

```
fastapi==0.115.0        # Web 框架，用来写 HTTP 接口（类似 Node 里的 Express/NestJS）
uvicorn[standard]==0.30.6  # ASGI 服务器，负责真正监听端口、处理网络请求，FastAPI 应用要靠它跑起来
python-multipart==0.0.9    # 解析 multipart/form-data 请求（也就是文件上传），FastAPI 处理上传文件要用到
rapidocr-onnxruntime==1.4.4  # OCR（文字识别）算法库，本服务的核心功能，底层用 ONNXRuntime 做模型推理
numpy==1.26.4            # 数值计算库，图片转数组格式给 OCR 引擎用
opencv-python==4.11.0.86 # 图像处理库，用于识别前的对比度增强/倾斜纠正预处理
```

- `==` 表示锁定精确版本号，保证每个人装出来的环境一致，不会因为版本漂移导致行为不一致（这点和 `package-lock.json`/`pnpm-lock.yaml` 锁版本的思路一样）。
- 这一步会比较慢，因为 `rapidocr-onnxruntime` 依赖的 `onnxruntime` 推理引擎体积较大，网络较差时可能需要几分钟。

## 6. `uvicorn app:app --host 0.0.0.0 --port 8000`

**启动 Web 服务，真正把 OCR 接口跑起来。**

- `uvicorn` 是上一步装的 ASGI 服务器（类似 Node.js 里跑一个 `node server.js`，但这里是通用服务器去加载你的应用代码）。
- `app:app` 的含义：冒号前的 `app` 指的是当前目录下的 `app.py` 文件，冒号后的 `app` 指的是 `app.py` 文件里定义的 FastAPI 实例变量名（在 `app.py` 里就是 `app = FastAPI(...)` 那一行）。
- `--host 0.0.0.0`：监听所有网络接口，意味着局域网内其他设备也能访问（本地自测其实用默认的 `127.0.0.1` 也够用，`0.0.0.0` 更宽松一些）。
- `--port 8000`：监听 8000 端口，这样服务地址就是 `http://127.0.0.1:8000`，与 `apps/api/.env` 里配置的 `OCR_SERVICE_URL=http://127.0.0.1:8000` 对应上。
- 启动成功后终端会常驻运行（不会自动退出），日志会实时打印在这个终端窗口里，`Ctrl+C` 可以停止服务。
- 首次调用识别接口时，`app.py` 里的 `get_engine()` 会触发 RapidOCR 自动下载中文识别模型到本地缓存目录，这个过程需要联网，也是为什么第一次请求会明显更慢。

## 后续日常开发怎么启动

上面 2、4、5 步只需要做一次（除非依赖有更新）。之后每次开发只需要：

```bash
cd services/ocr-service
source .venv/bin/activate      # 激活虚拟环境
uvicorn app:app --reload --port 8000   # --reload 会在代码改动后自动重启，方便调试
```

## 小结类比表（对照 Node.js 生态方便理解）

| Python 概念 | Node.js 对应 |
|---|---|
| `pip` | `npm` / `pnpm` |
| `requirements.txt` | `package.json`（依赖清单） |
| `.venv`（虚拟环境） | `node_modules` + 局部 Node 版本隔离 |
| `source .venv/bin/activate` | 大致相当于用 `nvm use` 切到项目指定的运行环境 |
| `uvicorn`（ASGI 服务器） | `node` 运行时本身 |
| `FastAPI` | `Express`/`NestJS`（Web 框架） |
