import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type OutputVolumeSnapshot = {
  volume: number;
  muted: boolean;
};

export type OutputDeviceVolumeSnapshot = OutputVolumeSnapshot & {
  source: "master" | "channels";
  channels?: number;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "device-output-volume.c");
const buildDirectory = join(toolRoot, ".build", "audio-volume");
const executablePath = join(buildDirectory, "device-output-volume");

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

function runAppleScript(source: string): string {
  return execFileSync("/usr/bin/osascript", ["-e", source], { encoding: "utf8" }).trim();
}

export function readOutputVolume(): OutputVolumeSnapshot {
  const output = runAppleScript(
    'set settings to get volume settings\nreturn (output volume of settings as text) & "," & (output muted of settings as text)',
  );
  const [volumeText, mutedText] = output.split(",");
  const volume = Number(volumeText);
  if (!Number.isFinite(volume)) throw new Error("无法读取当前输出音量");
  return { volume, muted: mutedText === "true" };
}

export function synchronizeOutputVolume(snapshot: OutputVolumeSnapshot): void {
  const volume = Math.max(0, Math.min(100, Math.round(snapshot.volume)));
  const nudge = volume < 100 ? volume + 1 : volume - 1;
  runAppleScript([
    `set volume output volume ${nudge}`,
    "delay 0.1",
    `set volume output volume ${volume}`,
    `set volume output muted ${snapshot.muted ? "true" : "false"}`,
  ].join("\n"));
}

export function readOutputDeviceVolume(name: string): OutputDeviceVolumeSnapshot | null {
  if (process.platform !== "darwin") {
    throw new Error("本工具当前只支持 macOS。");
  }
  try {
    ensureHelperBuilt();
    const output = execFileSync(executablePath, ["read", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parsed = JSON.parse(output) as Partial<OutputDeviceVolumeSnapshot>;
    if (!Number.isFinite(parsed.volume)) return null;
    return {
      volume: Math.max(0, Math.min(100, Number(parsed.volume))),
      muted: parsed.muted === true,
      source: parsed.source === "channels" ? "channels" : "master",
      channels: Number.isFinite(parsed.channels) ? Number(parsed.channels) : undefined,
    };
  } catch {
    return null;
  }
}

export function writeOutputDeviceVolume(name: string, snapshot: OutputVolumeSnapshot): void {
  if (process.platform !== "darwin") {
    throw new Error("本工具当前只支持 macOS。");
  }
  ensureHelperBuilt();
  const volume = String(Math.max(0, Math.min(100, Math.round(snapshot.volume))));
  execFileSync(executablePath, ["write", name, volume, snapshot.muted ? "true" : "false"], { encoding: "utf8" });
}

export async function synchronizeOutputDeviceVolume(
  name: string,
  snapshot: OutputVolumeSnapshot,
  wait: (milliseconds: number) => Promise<void>,
): Promise<OutputDeviceVolumeSnapshot | null> {
  writeOutputDeviceVolume(name, snapshot);
  await wait(400);
  return readOutputDeviceVolume(name);
}
