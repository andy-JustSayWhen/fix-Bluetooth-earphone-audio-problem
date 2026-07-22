import { execFileSync } from "node:child_process";
import { getuid } from "node:process";

export type AudioChainService =
  | "bluetoothd"
  | "bluetoothuserd"
  | "coreaudiod"
  | "audioaccessoryd"
  | "audiomxd";

function serviceTarget(service: AudioChainService): string {
  const uid = getuid?.();
  if (uid === undefined) throw new Error("无法确认当前用户身份");
  const targets: Record<AudioChainService, string> = {
    bluetoothd: "system/com.apple.bluetoothd",
    bluetoothuserd: `gui/${uid}/com.apple.bluetoothuserd`,
    coreaudiod: "system/com.apple.audio.coreaudiod",
    audioaccessoryd: `gui/${uid}/com.apple.BTServer.cloudpairing`,
    audiomxd: "system/com.apple.audiomxd",
  };
  return targets[service];
}

function isSystemTarget(target: string): boolean {
  return target.startsWith("system/");
}

function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function readServicePid(service: AudioChainService): number | null {
  try {
    const output = execFileSync("/bin/launchctl", ["print", serviceTarget(service)], {
      encoding: "utf8",
      timeout: 2_000,
    });
    const pid = Number(output.match(/^\s*pid\s*=\s*(\d+)\s*$/m)?.[1]);
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

export function restartService(service: AudioChainService): void {
  const target = serviceTarget(service);
  try {
    execFileSync("/bin/launchctl", ["kickstart", "-kp", target], {
      encoding: "utf8",
      timeout: 8_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return;
  } catch (error) {
    if (!isSystemTarget(target)) throw error;
  }

  const command = `/bin/launchctl kickstart -kp ${shellQuoted(target)}`;
  execFileSync("/usr/bin/osascript", [
    "-e",
    `do shell script ${JSON.stringify(command)} with administrator privileges`,
  ], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
}
