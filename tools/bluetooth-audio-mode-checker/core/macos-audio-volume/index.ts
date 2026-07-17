import { execFileSync } from "node:child_process";

export type OutputVolumeSnapshot = {
  volume: number;
  muted: boolean;
};

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
