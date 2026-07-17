import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "reconnect-device.m");
const buildDirectory = join(toolRoot, ".build", "bluetooth-link");
const executablePath = join(buildDirectory, "reconnect-device");

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

export function reconnectBluetoothDevice(name: string): void {
  ensureHelperBuilt();
  execFileSync(executablePath, [name], { encoding: "utf8", timeout: 20_000 });
}
