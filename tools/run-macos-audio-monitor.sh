#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD_DIR="$ROOT_DIR/.build/audio-monitor"
RUN_ID=$(date +%Y%m%d-%H%M%S)
RUN_DIR="$ROOT_DIR/artifacts/audio-monitor/run-$RUN_ID"
mkdir -p "$BUILD_DIR" "$RUN_DIR"

swiftc "$ROOT_DIR/tools/macos-audio-route-monitor.swift" -o "$BUILD_DIR/macos-audio-route-monitor"

system_profiler SPAudioDataType -json > "$RUN_DIR/system-profiler-start.json" 2>&1 || true
ps axo pid,ppid,comm,args > "$RUN_DIR/processes-start.txt" 2>&1 || true

LOG_PID=""
if command -v log >/dev/null 2>&1; then
  log stream --style compact --level info --predicate '(process == "coreaudiod") OR (process CONTAINS[c] "QQMusic")' > "$RUN_DIR/unified-audio-log.txt" 2>&1 &
  LOG_PID=$!
fi

cleanup() {
  if [ -n "$LOG_PID" ]; then
    kill "$LOG_PID" 2>/dev/null || true
  fi
  system_profiler SPAudioDataType -json > "$RUN_DIR/system-profiler-end.json" 2>&1 || true
  ps axo pid,ppid,comm,args > "$RUN_DIR/processes-end.txt" 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "本次详细记录目录：$RUN_DIR"
echo "按 Ctrl-C 可提前结束；默认监视 600 秒。"
"$BUILD_DIR/macos-audio-route-monitor" --duration "${MONITOR_DURATION:-600}" --interval "${MONITOR_INTERVAL:-0.25}" --heartbeat "${MONITOR_HEARTBEAT:-0}" --output-dir "$RUN_DIR"
