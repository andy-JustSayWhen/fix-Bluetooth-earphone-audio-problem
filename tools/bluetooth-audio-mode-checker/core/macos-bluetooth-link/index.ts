import { execFile, execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BluetoothLinkSnapshot, BluetoothLinkType } from "../../shared/audio-device-types/index.ts";
import { normalizeBluetoothAddress } from "../../shared/bluetooth-device-identity/index.ts";
import {
  consumeUtf8Lines,
  formatUnifiedLogStart,
  parseUnifiedLogTimestamp,
  systemBootTimeMs,
} from "../macos-unified-log/index.ts";
import { ensureNativeHelperBuilt } from "../native-helper/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "reconnect-device.m");
const connectSourcePath = join(moduleDirectory, "connect-device.m");
const buildDirectory = join(toolRoot, ".build", "bluetooth-link");
const executablePath = join(buildDirectory, "reconnect-device");
const connectExecutablePath = join(buildDirectory, "connect-device");
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

function ensureBluetoothHelperBuilt(source: string, executable: string): void {
  ensureNativeHelperBuilt({
    sourcePath: source,
    executablePath: executable,
    compilerFlags: ["-fobjc-arc"],
    frameworks: ["Foundation", "IOBluetooth"],
  });
}

export function reconnectBluetoothDeviceAsync(name: string): Promise<void> {
  ensureBluetoothHelperBuilt(sourcePath, executablePath);
  return new Promise((resolve, reject) => {
    execFile(executablePath, [name], { encoding: "utf8", timeout: 18_000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function connectBluetoothDevice(name: string): void {
  ensureBluetoothHelperBuilt(connectSourcePath, connectExecutablePath);
  execFileSync(connectExecutablePath, [name], { encoding: "utf8", timeout: 18_000 });
}

export function parseBluetoothLinkLine(line: string): BluetoothLinkSnapshot | null {
  const profileMatch = line.match(/(?:Current profile|Starting IO on profile)\s+(tacl|tsco)/i);
  const addressMatch = line.match(/\b([0-9A-F]{2}(?::[0-9A-F]{2}){5})\b/i);
  if (!profileMatch || !addressMatch) return null;
  return {
    address: normalizeBluetoothAddress(addressMatch[1]),
    profile: profileMatch[1].toLowerCase() as BluetoothLinkType,
    timestamp: parseUnifiedLogTimestamp(line),
  };
}

export function startBluetoothLinkMonitor(
  onSnapshot: (snapshot: BluetoothLinkSnapshot) => void,
): () => void {
  if (process.platform !== "darwin") return () => {};
  const historical = spawn("/usr/bin/log", [
    "show",
    "--style", "compact",
    "--start", formatUnifiedLogStart(systemBootTimeMs()),
    "--predicate", linkLogPredicate,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  const stream = spawn("/usr/bin/log", [
    "stream",
    "--style", "compact",
    "--debug",
    "--predicate", linkLogPredicate,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  consumeUtf8Lines(historical.stdout, (line) => {
    const snapshot = parseBluetoothLinkLine(line);
    if (snapshot) onSnapshot(snapshot);
  });
  consumeUtf8Lines(stream.stdout, (line) => {
    const snapshot = parseBluetoothLinkLine(line);
    if (snapshot) onSnapshot(snapshot);
  });
  return () => {
    if (!historical.killed) historical.kill("SIGTERM");
    if (!stream.killed) stream.kill("SIGTERM");
  };
}
