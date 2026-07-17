import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "set-output-rate.c");
const buildDirectory = join(toolRoot, ".build", "audio-format");
const executablePath = join(buildDirectory, "set-output-rate");

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
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

export function requestOutputSampleRate(name: string, rate: number): void {
  if (!Number.isFinite(rate) || rate <= 16_000) throw new Error("目标采样率无效");
  ensureHelperBuilt();
  execFileSync(executablePath, [name, String(rate)], { encoding: "utf8", timeout: 10_000 });
}
