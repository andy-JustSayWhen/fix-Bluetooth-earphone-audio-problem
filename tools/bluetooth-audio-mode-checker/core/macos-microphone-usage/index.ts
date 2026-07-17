import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { MicrophoneUser } from "../../shared/audio-device-types/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "read-input-users.c");
const buildDirectory = join(toolRoot, ".build", "microphone-usage");
const executablePath = join(buildDirectory, "read-input-users");

function modificationTime(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function ensureHelperBuilt(): void {
  if (modificationTime(executablePath) >= modificationTime(sourcePath)) return;
  mkdirSync(buildDirectory, { recursive: true });
  execFileSync("/usr/bin/clang", [
    sourcePath,
    "-framework", "CoreAudio",
    "-framework", "CoreFoundation",
    "-o", executablePath,
  ], { stdio: ["ignore", "inherit", "inherit"] });
}

export function readMicrophoneUsers(): MicrophoneUser[] {
  ensureHelperBuilt();
  const output = execFileSync(executablePath, [], { encoding: "utf8" });
  return JSON.parse(output) as MicrophoneUser[];
}

export function readMicrophoneUsersAsync(): Promise<MicrophoneUser[]> {
  ensureHelperBuilt();
  return new Promise((resolve, reject) => {
    execFile(executablePath, [], { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as MicrophoneUser[]);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

export function releaseMicrophoneUser(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) throw new Error("占用程序无效");
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw new Error("无法结束该程序；它可能是受系统保护的进程");
  }
}
