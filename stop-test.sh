#!/usr/bin/env bash
# 一键强制停止本地测试服务 (API 8000 & HTTP 8765)
# 用法: ./stop-test.sh

echo "==> 正在检测并强制关闭相关服务..."

FRONTEND_PORT="${FRONTEND_PORT:-8765}"
API_PORT="${API_PORT:-8000}"

# 强杀指定端口的进程
PIDS=$(lsof -i :${API_PORT} -t && lsof -i :${FRONTEND_PORT} -t)

if [[ -n "${PIDS}" ]]; then
  echo "检测到正在运行的进程 (PID: ${PIDS//\n/ })，正在强制退出..."
  echo "${PIDS}" | xargs kill -9 2>/dev/null || true
  echo "==> ✅ 服务已成功强杀。"
else
  echo "==> ⚠️ 未检测到运行中的服务。"
fi

# 清理僵尸进程（如果有的话）
pkill -f "uvicorn app:app" 2>/dev/null || true
pkill -f "python3 -m http.server" 2>/dev/null || true

echo "==> 清理完成。"
