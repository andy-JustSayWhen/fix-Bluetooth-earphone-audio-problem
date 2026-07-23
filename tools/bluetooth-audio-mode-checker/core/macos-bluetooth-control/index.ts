import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNativeHelperBuilt } from "../native-helper/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "bluetooth-control.m");
const executablePath = join(toolRoot, ".build", "bluetooth-control", "bluetooth-control");

function ensureHelperBuilt(): void {
  ensureNativeHelperBuilt({
    sourcePath,
    executablePath,
    compilerFlags: ["-fobjc-arc"],
    frameworks: ["Foundation", "IOBluetooth"],
  });
}

export function readBluetoothPower(): boolean {
  ensureHelperBuilt();
  return execFileSync(executablePath, ["status"], { encoding: "utf8", timeout: 2_000 }).trim() === "1";
}

export function setBluetoothPower(enabled: boolean): void {
  ensureHelperBuilt();
  execFileSync(executablePath, ["power", enabled ? "1" : "0"], {
    encoding: "utf8",
    timeout: 6_000,
  });
}
