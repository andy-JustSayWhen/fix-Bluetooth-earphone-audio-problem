import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNativeHelperBuilt } from "../native-helper/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "set-default-device.c");
const executablePath = join(toolRoot, ".build", "audio-route", "set-default-device");

function ensureHelperBuilt(): void {
  ensureNativeHelperBuilt({
    sourcePath,
    executablePath,
    frameworks: ["CoreAudio", "CoreFoundation"],
    stdio: ["ignore", "inherit", "inherit"],
  });
}

export function setDefaultAudioDevice(direction: "input" | "output", name: string): void {
  if (process.platform !== "darwin") {
    throw new Error("本工具当前只支持 macOS。");
  }
  ensureHelperBuilt();
  execFileSync(executablePath, [direction, name], { encoding: "utf8" });
}
