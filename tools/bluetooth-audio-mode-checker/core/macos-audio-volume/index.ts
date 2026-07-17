import { execFileSync, spawn } from "node:child_process";
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
const monitorSourcePath = join(moduleDirectory, "watch-output-volume.c");
const monitorExecutablePath = join(buildDirectory, "watch-output-volume");

export type OutputVolumeEvent = {
  timestamp: string;
  event: "initial" | "propertyChanged" | "defaultOutputChanged";
  selector: string;
  scope: number;
  element: number;
  deviceId: number;
  name: string | null;
  masterVolume: number | null;
  virtualMainVolume: number | null;
  muted: boolean | null;
  channelCount: number;
  channelVolumes: Array<number | null>;
  averageChannelVolume: number | null;
  nominalSampleRate: number | null;
  actualSampleRate: number | null;
  isRunning: boolean | null;
};

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

function ensureMonitorBuilt(): void {
  if (modificationTime(monitorExecutablePath) >= modificationTime(monitorSourcePath)) return;
  mkdirSync(buildDirectory, { recursive: true });
  execFileSync("/usr/bin/clang", [
    monitorSourcePath,
    "-framework", "CoreAudio",
    "-framework", "CoreFoundation",
    "-o", monitorExecutablePath,
  ], { stdio: ["ignore", "inherit", "inherit"] });
}

export function startOutputVolumeMonitor(
  onEvent: (event: OutputVolumeEvent) => void,
): () => void {
  if (process.platform !== "darwin") return () => {};
  ensureMonitorBuilt();
  const child = spawn(monitorExecutablePath, [], { stdio: ["ignore", "pipe", "pipe"] });
  let pending = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as OutputVolumeEvent);
      } catch {
        // Drop a malformed native event; the monitor remains read-only and waits for the next event.
      }
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => console.error(`音量事件监听启动失败：${error.message}`));
  return () => {
    if (!child.killed) child.kill("SIGTERM");
  };
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
