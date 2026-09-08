#!/usr/bin/env bash
# 一键启动本地全部依赖服务：Gotenberg（Docker）+ ocr-service + doc-service + apps/api & apps/web（turbo dev）。
# 用法：pnpm dev:all 或 npm run dev:all

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"

PIDS=()

cleanup() {
  echo ""
  echo "[dev-all] 正在停止所有子进程..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

prefix() {
  local label="$1"
  while IFS= read -r line; do
    printf '[%s] %s\n' "$label" "$line"
  done
}

ensure_venv() {
  local dir="$1"
  if [ ! -d "$dir/.venv" ]; then
    echo "[dev-all] 首次运行，正在为 ${dir#"$ROOT_DIR/"} 创建虚拟环境并安装依赖（可能较慢）..."
    python3 -m venv "$dir/.venv"
    "$dir/.venv/bin/pip" install -q -r "$dir/requirements.txt"
  fi
}

# 1. Gotenberg（doc-service 依赖的文档转换服务，容器化运行）
if ! command -v docker >/dev/null 2>&1; then
  echo "[dev-all] 警告：未检测到 docker，跳过 Gotenberg 启动，doc-service 的转 PDF 功能将不可用。"
else
  GOTENBERG_PORT=3010
  DOC_ENV_FILE="$ROOT_DIR/services/doc-service/.env"
  if [ -f "$DOC_ENV_FILE" ]; then
    ENV_URL=$(grep -E '^GOTENBERG_URL=' "$DOC_ENV_FILE" | tail -1 | cut -d= -f2)
    ENV_PORT=$(echo "$ENV_URL" | sed -E 's#.*:([0-9]+)/?$#\1#')
    [ -n "$ENV_PORT" ] && GOTENBERG_PORT="$ENV_PORT"
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx gotenberg; then
    echo "[dev-all] gotenberg 容器已在运行"
  elif docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx gotenberg; then
    echo "[dev-all] 启动已存在的 gotenberg 容器..."
    docker start gotenberg >/dev/null
  else
    echo "[dev-all] 创建并启动 gotenberg 容器（端口 ${GOTENBERG_PORT}）..."
    docker run -d --name gotenberg --restart unless-stopped \
      -p "${GOTENBERG_PORT}:3000" gotenberg/gotenberg:8 >/dev/null
  fi
fi

# 2. ocr-service（services/ocr-service，port 8000）
ensure_venv "$ROOT_DIR/services/ocr-service"
(
  cd "$ROOT_DIR/services/ocr-service"
  ./.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000 2>&1 | prefix ocr
) &
PIDS+=($!)

# 3. doc-service（services/doc-service，port 8001）
ensure_venv "$ROOT_DIR/services/doc-service"
if [ ! -f "$ROOT_DIR/services/doc-service/.env" ]; then
  cp "$ROOT_DIR/services/doc-service/.env.example" "$ROOT_DIR/services/doc-service/.env"
  echo "[dev-all] 已生成 services/doc-service/.env（默认 GOTENBERG_URL=http://localhost:3010），如端口不同请自行修改。"
fi
(
  cd "$ROOT_DIR/services/doc-service"
  ./.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8001 --env-file .env 2>&1 | prefix doc
) &
PIDS+=($!)

# 4. 业务后台 apps/api + apps/web（turbo dev，沿用现有 pnpm dev 逻辑）
(
  cd "$ROOT_DIR"
  pnpm turbo dev 2>&1 | prefix app
) &
PIDS+=($!)

echo "[dev-all] 全部服务已启动：ocr(8000) / doc(8001) / gotenberg / api+web(turbo dev)。Ctrl+C 可全部停止。"
wait
