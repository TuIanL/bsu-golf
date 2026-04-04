#!/usr/bin/env bash
# 一键启动本地测试：静态页面 + FastAPI 后端，并打开浏览器
# 用法: ./start-test.sh   或   bash start-test.sh
# 停止: 在本终端按 Ctrl+C

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-8765}"
API_PORT="${API_PORT:-8000}"

echo "==> 正在清理旧进程以免发生端口占用错误..."
# 强杀 8000 和 8765 端口的进程，防止 Address already in use
lsof -i :${API_PORT} -t | xargs kill -9 2>/dev/null || true
lsof -i :${FRONTEND_PORT} -t | xargs kill -9 2>/dev/null || true
sleep 0.5

BACKEND_PID=""
HTTP_PID=""

cleanup() {
  echo ""
  echo "==> 正在关闭所有服务..."
  [[ -n "${HTTP_PID}" ]] && kill "${HTTP_PID}" 2>/dev/null || true
  [[ -n "${BACKEND_PID}" ]] && kill "${BACKEND_PID}" 2>/dev/null || true
  echo "==> 服务已退出。"
}
trap cleanup EXIT INT TERM

if ! command -v python3 >/dev/null 2>&1; then
  echo "错误: 未找到 python3，请先安装 Python 3。"
  exit 1
fi

echo "==> 启动后端 FastAPI (http://127.0.0.1:${API_PORT}) ..."
cd "${ROOT}/backend"
BACKEND_PYTHON="python3"
if [[ -x "${ROOT}/backend/.venv/bin/python" ]]; then
  BACKEND_PYTHON="${ROOT}/backend/.venv/bin/python"
fi
"${BACKEND_PYTHON}" -m uvicorn app:app --host 127.0.0.1 --port "${API_PORT}" &
BACKEND_PID=$!

echo "==> 启动静态站点 (http://127.0.0.1:${FRONTEND_PORT}) ..."
cd "${ROOT}"
python3 -m http.server "${FRONTEND_PORT}" --bind 127.0.0.1 &
HTTP_PID=$!

# 等待服务就绪
sleep 1
if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
  echo "警告: 后端进程可能已退出。"
  echo "请在 backend 目录先执行:"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  python -m pip install -U pip"
  echo "  python -m pip install -r requirements.txt"
fi
if ! kill -0 "${HTTP_PID}" 2>/dev/null; then
  echo "错误: 静态服务未能启动，请检查端口 ${FRONTEND_PORT} 是否被占用。"
  exit 1
fi

URL="http://127.0.0.1:${FRONTEND_PORT}/index.html"
echo "==> 打开浏览器: ${URL}"
echo "    实时摄像头与上传分析需使用上述地址（勿用 file://）。"
echo "    按 Ctrl+C 停止所有服务。"
echo ""

if command -v open >/dev/null 2>&1; then
  open "${URL}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${URL}"
else
  echo "请手动在浏览器中打开: ${URL}"
fi

wait "${BACKEND_PID}" "${HTTP_PID}"
