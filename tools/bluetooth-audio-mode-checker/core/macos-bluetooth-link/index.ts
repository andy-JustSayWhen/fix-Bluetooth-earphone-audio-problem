import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "reconnect-device.m");
const disconnectScoSourcePath = join(moduleDirectory, "disconnect-sco.m");
const disconnectSourcePath = join(moduleDirectory, "disconnect-device.m");
const buildDirectory = join(toolRoot, ".build", "bluetooth-link");
const executablePath = join(buildDirectory, "reconnect-device");
const disconnectScoExecutablePath = join(buildDirectory, "disconnect-sco");
const disconnectExecutablePath = join(buildDirectory, "disconnect-device");

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

export function disconnectBluetoothDevice(name: string): void {
  if (modificationTime(disconnectExecutablePath) < modificationTime(disconnectSourcePath)) {
    mkdirSync(buildDirectory, { recursive: true });
    execFileSync("/usr/bin/clang", [
      "-fobjc-arc",
      disconnectSourcePath,
      "-framework", "Foundation",
      "-framework", "IOBluetooth",
      "-o", disconnectExecutablePath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
  }
  execFileSync(disconnectExecutablePath, [name], { encoding: "utf8", timeout: 10_000 });
}

export function disconnectBluetoothSco(name: string): { scoWasConnected: boolean; scoConnected: boolean } {
  if (modificationTime(disconnectScoExecutablePath) < modificationTime(disconnectScoSourcePath)) {
    mkdirSync(buildDirectory, { recursive: true });
    execFileSync("/usr/bin/clang", [
      "-fobjc-arc",
      disconnectScoSourcePath,
      "-framework", "Foundation",
      "-framework", "IOBluetooth",
      "-o", disconnectScoExecutablePath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
  }
  const output = execFileSync(disconnectScoExecutablePath, [name], { encoding: "utf8", timeout: 10_000 });
  return JSON.parse(output) as { scoWasConnected: boolean; scoConnected: boolean };
}
