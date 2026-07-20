import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BluetoothLinkSnapshot, BluetoothLinkType } from "../../shared/audio-device-types/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "reconnect-device.m");
const disconnectScoSourcePath = join(moduleDirectory, "disconnect-sco.m");
const disconnectSourcePath = join(moduleDirectory, "disconnect-device.m");
const buildDirectory = join(toolRoot, ".build", "bluetooth-link");
const executablePath = join(buildDirectory, "reconnect-device");
const disconnectScoExecutablePath = join(buildDirectory, "disconnect-sco");
const disconnectExecutablePath = join(buildDirectory, "disconnect-device");
const linkLogPredicate = [
  'process == "coreaudiod"',
  'AND',
  '(',
  'eventMessage CONTAINS[c] "Current profile tacl"',
  'OR eventMessage CONTAINS[c] "Current profile tsco"',
  'OR eventMessage CONTAINS[c] "Starting IO on profile tacl"',
  'OR eventMessage CONTAINS[c] "Starting IO on profile tsco"',
  ')',
].join(" ");

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
  execFileSync(executablePath, [name], { encoding: "utf8", timeout: 18_000 });
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

function normalizedAddress(address: string): string {
  return address.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

export function parseBluetoothLinkLine(line: string): BluetoothLinkSnapshot | null {
  const profileMatch = line.match(/(?:Current profile|Starting IO on profile)\s+(tacl|tsco)/i);
  const addressMatch = line.match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/i);
  if (!profileMatch || !addressMatch) return null;
  const localTimestamp = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/)?.[1];
  const parsedTimestamp = localTimestamp ? new Date(localTimestamp.replace(" ", "T")) : new Date();
  return {
    address: normalizedAddress(addressMatch[1]),
    profile: profileMatch[1].toLowerCase() as BluetoothLinkType,
    timestamp: Number.isNaN(parsedTimestamp.getTime()) ? new Date().toISOString() : parsedTimestamp.toISOString(),
  };
}

function consumeLogOutput(
  child: ReturnType<typeof spawn>,
  onSnapshot: (snapshot: BluetoothLinkSnapshot) => void,
): void {
  let pending = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const snapshot = parseBluetoothLinkLine(line);
      if (snapshot) onSnapshot(snapshot);
    }
  });
}

export function startBluetoothLinkMonitor(
  onSnapshot: (snapshot: BluetoothLinkSnapshot) => void,
): () => void {
  if (process.platform !== "darwin") return () => {};
  const historical = spawn("/usr/bin/log", [
    "show",
    "--style", "compact",
    "--last", "10m",
    "--predicate", linkLogPredicate,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  const stream = spawn("/usr/bin/log", [
    "stream",
    "--style", "compact",
    "--debug",
    "--predicate", linkLogPredicate,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  consumeLogOutput(historical, onSnapshot);
  consumeLogOutput(stream, onSnapshot);
  return () => {
    if (!historical.killed) historical.kill("SIGTERM");
    if (!stream.killed) stream.kill("SIGTERM");
  };
}
