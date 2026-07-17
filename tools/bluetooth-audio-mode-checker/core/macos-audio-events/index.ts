import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ActiveOutputSnapshot } from "../../shared/audio-device-types/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "watch-active-output.c");
const buildDirectory = join(toolRoot, ".build", "audio-events");
const executablePath = join(buildDirectory, "watch-active-output");

function modificationTime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function ensureBuilt(): void {
  if (modificationTime(executablePath) >= modificationTime(sourcePath)) return;
  mkdirSync(buildDirectory, { recursive: true });
  execFileSync("/usr/bin/clang", [
    sourcePath,
    "-framework", "CoreAudio",
    "-framework", "CoreFoundation",
    "-o", executablePath,
  ], { stdio: ["ignore", "inherit", "inherit"] });
}

export function startActiveOutputMonitor(
  onSnapshot: (snapshot: ActiveOutputSnapshot) => void,
): () => void {
  if (process.platform !== "darwin") return () => {};
  ensureBuilt();
  const child = spawn(executablePath, [], { stdio: ["ignore", "pipe", "pipe"] });
  let pending = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Omit<ActiveOutputSnapshot, "timestamp">;
        onSnapshot({ ...parsed, timestamp: new Date().toISOString() });
      } catch {
        // Ignore a partial or malformed native event and wait for the next system update.
      }
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => console.error(`声音事件监听启动失败：${error.message}`));
  return () => {
    if (!child.killed) child.kill("SIGTERM");
  };
}
