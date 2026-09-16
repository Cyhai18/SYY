FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
# 说明见 services/ocr-service/Dockerfile 同一位置的注释：国内镜像源 + pip 缓存挂载加速构建
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
