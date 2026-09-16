# 构建期预下载模型并烘焙进镜像层，避免重建容器重新下载，见 docs/docker-deploy.md 二.3
FROM python:3.11-slim
WORKDIR /app
# opencv-python 依赖系统的 libgl1/libglib2.0-0，slim 基础镜像默认没有，必须手动装，
# 否则容器启动会直接报 ImportError: libGL.so.1
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
# 用国内镜像源 + BuildKit 缓存挂载加速依赖安装：
# - -i 换成清华 PyPI 镜像，opencv-python/onnxruntime 这类大 wheel 包下载速度明显更快；
#   如果构建机在境外/镜像访问不到，去掉 -i 这行退回官方源即可。
# - --mount=type=cache 让 pip 的下载缓存跨多次 `docker build` 复用，而不是每次都重新联网下载
#   （缓存本身不会进最终镜像层，不影响镜像体积），需要 DOCKER_BUILDKIT=1（新版 Docker 默认开启）。
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY . .
# 关键一步：构建期主动触发一次模型加载/下载，让模型文件被烘焙进这一层镜像；
# 之后 `docker compose up --build` 只要 requirements.txt 和这行代码不变，
# Docker 层缓存会直接复用，不会重新联网下载。
RUN python -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR()"
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
