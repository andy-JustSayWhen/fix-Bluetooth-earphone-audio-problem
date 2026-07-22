import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ActiveOutputSnapshot } from "../../shared/audio-device-types/index.ts";
import { detailedLog } from "../detailed-logging/index.ts";
import { consumeUtf8Lines } from "../macos-unified-log/index.ts";
import { ensureNativeHelperBuilt } from "../native-helper/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "watch-active-output.c");
const executablePath = join(toolRoot, ".build", "audio-events", "watch-active-output");

function ensureBuilt(): void {
  ensureNativeHelperBuilt({
    sourcePath,
    executablePath,
    frameworks: ["CoreAudio", "CoreFoundation"],
    stdio: ["ignore", "inherit", "inherit"],
  });
}

export function startActiveOutputMonitor(
  onSnapshot: (snapshot: ActiveOutputSnapshot) => void,
): () => void {
  if (process.platform !== "darwin") return () => {};
  ensureBuilt();
  const child = spawn(executablePath, [], { stdio: ["ignore", "pipe", "pipe"] });
  detailedLog("info", "active-output-monitor.started", { pid: child.pid, executablePath });
  consumeUtf8Lines(child.stdout, (line) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as Omit<ActiveOutputSnapshot, "timestamp">;
      onSnapshot({ ...parsed, timestamp: new Date().toISOString() });
    } catch (error) {
      detailedLog("warn", "active-output-monitor.invalid-event", { line, error });
      // Ignore a partial or malformed native event and wait for the next system update.
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    detailedLog("warn", "active-output-monitor.stderr", { message: String(chunk) });
  });
  child.on("error", (error) => {
    detailedLog("error", "active-output-monitor.failed", { error });
    console.error(`声音事件监听启动失败：${error.message}`);
  });
  child.on("close", (code, signal) => detailedLog("info", "active-output-monitor.stopped", { code, signal }));
  return () => {
    if (!child.killed) child.kill("SIGTERM");
  };
}
