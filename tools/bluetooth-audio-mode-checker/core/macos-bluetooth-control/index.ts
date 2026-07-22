import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "bluetooth-control.m");
const buildDirectory = join(toolRoot, ".build", "bluetooth-control");
const executablePath = join(buildDirectory, "bluetooth-control");

function modificationTime(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function ensureHelperBuilt(): void {
  if (modificationTime(executablePath) >= modificationTime(sourcePath)) return;
  mkdirSync(buildDirectory, { recursive: true });
  execFileSync("/usr/bin/clang", [
    "-fobjc-arc",
    sourcePath,
    "-framework", "Foundation",
    "-framework", "IOBluetooth",
    "-o", executablePath,
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

export function readBluetoothPower(): boolean {
  ensureHelperBuilt();
  return execFileSync(executablePath, ["status"], { encoding: "utf8", timeout: 2_000 }).trim() === "1";
}

export function setBluetoothPower(enabled: boolean): void {
  ensureHelperBuilt();
  execFileSync(executablePath, ["power", enabled ? "1" : "0"], {
    encoding: "utf8",
    timeout: 2_000,
  });
}
