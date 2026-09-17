#!/bin/sh
set -eu

TOOL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

pause_before_exit() {
  printf '\n按回车键关闭这个窗口。'
  read -r _unused
}

case "$(uname -m)" in
  arm64)
    APP_NODE="$TOOL_DIR/runtime/arm64/node"
    ;;
  x86_64)
    APP_NODE="$TOOL_DIR/runtime/x64/node"
    ;;
  *)
    echo "无法启动：这台 Mac 的处理器类型不受当前版本支持。"
    pause_before_exit
    exit 1
    ;;
esac

if [ ! -x "$APP_NODE" ]; then
  echo "无法启动：压缩包内的运行环境不完整。请重新下载并完整解压后再试。"
  pause_before_exit
  exit 1
fi

cd "$TOOL_DIR"
exec "$APP_NODE" app/index.ts "$@"

