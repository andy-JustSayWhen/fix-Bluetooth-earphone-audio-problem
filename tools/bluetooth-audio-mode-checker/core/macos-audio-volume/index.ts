import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { consumeUtf8Lines } from "../macos-unified-log/index.ts";
import { ensureNativeHelperBuilt } from "../native-helper/index.ts";

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
const executablePath = join(toolRoot, ".build", "audio-volume", "device-output-volume");
const monitorSourcePath = join(moduleDirectory, "watch-output-volume.c");
const monitorExecutablePath = join(toolRoot, ".build", "audio-volume", "watch-output-volume");

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

function ensureHelperBuilt(): void {
  ensureNativeHelperBuilt({
    sourcePath,
    executablePath,
    frameworks: ["CoreAudio", "CoreFoundation"],
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function ensureMonitorBuilt(): void {
  ensureNativeHelperBuilt({
    sourcePath: monitorSourcePath,
    executablePath: monitorExecutablePath,
    frameworks: ["CoreAudio", "CoreFoundation"],
    stdio: ["ignore", "inherit", "inherit"],
  });
}

export function startOutputVolumeMonitor(
  onEvent: (event: OutputVolumeEvent) => void,
): () => void {
  if (process.platform !== "darwin") return () => {};
  ensureMonitorBuilt();
  const child = spawn(monitorExecutablePath, [], { stdio: ["ignore", "pipe", "pipe"] });
  consumeUtf8Lines(child.stdout, (line) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as OutputVolumeEvent);
    } catch {
      // Drop a malformed native event; the monitor remains read-only and waits for the next event.
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
