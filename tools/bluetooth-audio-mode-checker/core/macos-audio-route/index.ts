import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "set-default-device.c");
const buildDirectory = join(toolRoot, ".build", "audio-route");
const executablePath = join(buildDirectory, "set-default-device");

function modificationTime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
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

export function setDefaultAudioDevice(direction: "input" | "output", name: string): void {
  if (process.platform !== "darwin") {
    throw new Error("本工具当前只支持 macOS。");
  }
  ensureHelperBuilt();
  execFileSync(executablePath, [direction, name], { encoding: "utf8" });
}
