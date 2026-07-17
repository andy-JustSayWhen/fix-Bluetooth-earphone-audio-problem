#!/bin/sh
set -eu

TOOL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_URL="http://127.0.0.1:4173"

if curl -fsS --max-time 1 "$APP_URL/" 2>/dev/null | grep -q '蓝牙音频模式检查器'; then
  /usr/bin/open "$APP_URL"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "无法启动：本机没有找到 Node.js（运行这个工具所需的基础环境）。"
  exit 1
fi

cd "$TOOL_DIR"
exec node app/index.ts "$@"
