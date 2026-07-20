import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { reconnectBluetoothDeviceAsync } from "../../core/macos-bluetooth-link/index.ts";
import { readRunningProcess } from "../../core/macos-running-apps/index.ts";

import type {
  AudioModeAssessment,
  SpeakerOutputUser,
} from "../../shared/audio-device-types/index.ts";

export type SpeakerSessionEvent = {
  sessionId: string;
  pid: number;
  name: string;
  outputRunning: boolean;
  outputDeviceUids: string[];
  observedAt: string;
};

export type SessionState = {
  observedAtMs: number;
  users: SpeakerOutputUser[];
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const speakerOccupancyWebAssetsDirectory = join(moduleDirectory, "web");

const sessionLogPredicate = [
  'process == "audiomxd"',
  'AND eventMessage CONTAINS[c] "update_running_state"',
].join(" ");

export function normalizeBluetoothAddress(value: string): string {
  return value.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function parseObservedAt(line: string): string {
  const localTimestamp = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/)?.[1];
  const parsed = localTimestamp ? new Date(localTimestamp.replace(" ", "T")) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function parseSpeakerSessionLine(line: string): SpeakerSessionEvent | null {
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const payload = JSON.parse(line.slice(jsonStart)) as {
      action?: unknown;
      session?: { ID?: unknown; name?: unknown };
      details?: { deviceUIDs?: unknown; output_running?: unknown };
    };
    if (payload.action !== "update_running_state" ||
        typeof payload.session?.ID !== "string" ||
        typeof payload.session.name !== "string" ||
        typeof payload.details?.output_running !== "boolean" ||
        !Array.isArray(payload.details.deviceUIDs)) return null;
    const identity = payload.session.name.match(/^(.*)\((\d+)\)$/);
    if (!identity || !identity[1].trim()) return null;
    const deviceUids = payload.details.deviceUIDs.filter((value): value is string => typeof value === "string");
    return {
      sessionId: payload.session.ID,
      pid: Number(identity[2]),
      name: identity[1].trim(),
      outputRunning: payload.details.output_running,
      outputDeviceUids: deviceUids.filter((value) => /:output$/i.test(value)),
      observedAt: parseObservedAt(line),
    };
  } catch {
    return null;
  }
}

export function usersFromSpeakerSessionEvent(event: SpeakerSessionEvent): SpeakerOutputUser[] {
  if (!event.outputRunning || event.outputDeviceUids.length === 0) return [];
  return [...new Set(event.outputDeviceUids)].map((deviceUid) => ({
    sessionId: event.sessionId,
    pid: event.pid,
    name: event.name,
    deviceUid,
    bluetoothAddress: normalizeBluetoothAddress(deviceUid.replace(/:output$/i, "")),
    observedAt: event.observedAt,
  })).filter((user) => user.bluetoothAddress.length === 12);
}

export function reduceSpeakerSessions(
  sessions: Map<string, SessionState>,
  event: SpeakerSessionEvent,
  processIsCurrent = true,
): boolean {
  const observedAtMs = Date.parse(event.observedAt);
  const current = sessions.get(event.sessionId);
  if (current && current.observedAtMs > observedAtMs) return false;
  const users = processIsCurrent ? usersFromSpeakerSessionEvent(event) : [];
  if (users.length === 0) sessions.delete(event.sessionId);
  else sessions.set(event.sessionId, { observedAtMs, users });
  return true;
}

export function flattenSpeakerSessions(sessions: Map<string, SessionState>): SpeakerOutputUser[] {
  return [...sessions.values()]
    .flatMap((session) => session.users)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN") || left.pid - right.pid);
}

export function attachSpeakerOccupancy(
  devices: AudioModeAssessment[],
  users: SpeakerOutputUser[],
): AudioModeAssessment[] {
  return devices.map((device) => {
    const address = normalizeBluetoothAddress(device.bluetoothAddress ?? "");
    const assigned = address ? users.filter((user) => user.bluetoothAddress === address) : [];
    return {
      ...device,
      speakerOccupancy: {
        isInUse: assigned.length > 0,
        users: assigned,
        observedAt: assigned.reduce<string | null>((latest, user) =>
          latest === null || Date.parse(user.observedAt) > Date.parse(latest) ? user.observedAt : latest, null),
      },
    };
  });
}

function processMatchesEvent(event: SpeakerSessionEvent): boolean {
  const running = readRunningProcess(event.pid);
  if (!running) return false;
  return running.name.toLocaleLowerCase() === event.name.toLocaleLowerCase();
}

export function filterCurrentSpeakerUsers(users: SpeakerOutputUser[]): SpeakerOutputUser[] {
  return users.filter((user) => {
    const running = readRunningProcess(user.pid);
    return running?.name.toLocaleLowerCase() === user.name.toLocaleLowerCase();
  });
}

function consumeLogOutput(
  child: ReturnType<typeof spawn>,
  onEvent: (event: SpeakerSessionEvent) => void,
): void {
  let pending = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseSpeakerSessionLine(line);
      if (event) onEvent(event);
    }
  });
}

export function startSpeakerOccupancyMonitor(
  onUsers: (users: SpeakerOutputUser[], event: SpeakerSessionEvent | null) => void,
): () => void {
  if (process.platform !== "darwin") return () => {};
  const sessions = new Map<string, SessionState>();
  let fingerprint = "";
  const publish = (event: SpeakerSessionEvent | null) => {
    const users = flattenSpeakerSessions(sessions);
    const nextFingerprint = JSON.stringify(users.map((user) => [
      user.sessionId, user.pid, user.deviceUid, user.observedAt,
    ]));
    if (nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;
    onUsers(users, event);
  };
  const accept = (event: SpeakerSessionEvent) => {
    const processIsCurrent = !event.outputRunning || processMatchesEvent(event);
    if (reduceSpeakerSessions(sessions, event, processIsCurrent)) publish(event);
  };
  const acceptHistorical = (event: SpeakerSessionEvent) => {
    reduceSpeakerSessions(sessions, event, true);
  };
  const historical = spawn("/usr/bin/log", [
    "show", "--style", "compact", "--last", "1h", "--predicate", sessionLogPredicate,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  const stream = spawn("/usr/bin/log", [
    "stream", "--style", "compact", "--debug", "--predicate", sessionLogPredicate,
  ], { stdio: ["ignore", "pipe", "ignore"] });
  consumeLogOutput(historical, acceptHistorical);
  consumeLogOutput(stream, accept);
  historical.once("close", () => {
    for (const [sessionId, session] of sessions) {
      if (filterCurrentSpeakerUsers(session.users).length !== session.users.length) {
        sessions.delete(sessionId);
      }
    }
    publish(null);
  });
  const pruneTimer = setInterval(() => {
    let changed = false;
    for (const [sessionId, session] of sessions) {
      if (filterCurrentSpeakerUsers(session.users).length !== session.users.length) {
        sessions.delete(sessionId);
        changed = true;
      }
    }
    if (changed) publish(null);
  }, 2_000);
  pruneTimer.unref();
  return () => {
    clearInterval(pruneTimer);
    if (!historical.killed) historical.kill("SIGTERM");
    if (!stream.killed) stream.kill("SIGTERM");
  };
}

export async function reconnectOccupiedSpeaker(name: string): Promise<{ durationMs: number }> {
  const startedAt = performance.now();
  try {
    await reconnectBluetoothDeviceAsync(name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException & { code?: string | number }).code;
    if (code === 3) throw new Error("没有找到目标蓝牙设备，未执行断开重连");
    if (code === 4) throw new Error("目标设备未能在 4 秒内完成断开，未发起重连");
    if (code === 6) throw new Error("目标设备已经断开，但未能在 12 秒内重新连接");
    throw new Error("系统未能完成目标设备的断开重连");
  }
  return { durationMs: Number((performance.now() - startedAt).toFixed(3)) };
}
