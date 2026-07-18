import { execFileSync } from "node:child_process";
import {
  readRunningProcess,
  type RunningProcess,
} from "../../core/macos-running-apps/index.ts";

export type FormatRequestEvent = {
  kind: "format-request";
  timestamp: string;
  timestampMs: number;
  requesterPid: number;
  from: number;
  to: number;
  raw: string;
};

export type StartIoEvent = {
  kind: "start-io";
  timestamp: string;
  timestampMs: number;
  requesterPid: number;
  raw: string;
};

export type ProfileEvent = {
  kind: "profile";
  timestamp: string;
  timestampMs: number;
  profile: "tacl" | "tsco";
  raw: string;
};

export type SystemAudioEvent = FormatRequestEvent | StartIoEvent | ProfileEvent;

export type FormatRequestEvidence = {
  windowMinutes: number;
  events: SystemAudioEvent[];
  rawLines: string[];
  queryError: string | null;
};

export type FormatRequestCause = {
  confidence: "已确认" | "高度疑似" | "无法确认";
  request: FormatRequestEvent | null;
  requester: RunningProcess | null;
  sameProcessStartIo: StartIoEvent | null;
  matchingTsco: ProfileEvent | null;
  requestCount: number;
  gaps: string[];
};

const timestampPattern = "(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{6}[+-]\\d{4})";
const timestampRegex = new RegExp(`^${timestampPattern}`);

function timestampToMilliseconds(timestamp: string): number {
  const normalized = timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const value = Date.parse(normalized);
  return Number.isFinite(value) ? value : 0;
}

export function parseSystemAudioLog(output: string): SystemAudioEvent[] {
  const events: SystemAudioEvent[] = [];
  for (const raw of output.split("\n").map((line) => line.trim()).filter(Boolean)) {
    const timestamp = raw.match(timestampRegex)?.[1];
    if (!timestamp) continue;
    const timestampMs = timestampToMilliseconds(timestamp);

    const formatMatch = raw.match(
      /coreaudiod\[\d+\]:\s*\[\s*(\d+)\s*\].*kBluetoothAudioDevicePropertyFormat request\s+(\d+)\s*->\s*(\d+)/i,
    );
    if (formatMatch) {
      events.push({
        kind: "format-request",
        timestamp,
        timestampMs,
        requesterPid: Number(formatMatch[1]),
        from: Number(formatMatch[2]),
        to: Number(formatMatch[3]),
        raw,
      });
      continue;
    }

    if (/BluetoothHALPlugIn_StartIO/i.test(raw)) {
      const pidMatch = raw.match(/PID\s*=\s*(\d+)/i);
      if (pidMatch) {
        events.push({
          kind: "start-io",
          timestamp,
          timestampMs,
          requesterPid: Number(pidMatch[1]),
          raw,
        });
      }
      continue;
    }

    const profileMatch = raw.match(/Current profile\s+(tacl|tsco)/i);
    if (profileMatch) {
      events.push({
        kind: "profile",
        timestamp,
        timestampMs,
        profile: profileMatch[1].toLowerCase() as "tacl" | "tsco",
        raw,
      });
    }
  }
  return events.sort((left, right) => left.timestampMs - right.timestampMs);
}

export function readRecentSystemAudioEvidence(windowMinutes = 10): FormatRequestEvidence {
  const predicate = [
    'process IN {"coreaudiod", "bluetoothd", "audioaccessoryd", "audiomxd"}',
    "AND",
    "(",
    'eventMessage CONTAINS[c] "kBluetoothAudioDevicePropertyFormat request"',
    "OR",
    'eventMessage CONTAINS[c] "BluetoothHALPlugIn_StartIO"',
    "OR",
    'eventMessage CONTAINS[c] "Current profile tsco"',
    "OR",
    'eventMessage CONTAINS[c] "Current profile tacl"',
    ")",
  ].join(" ");
  try {
    const output = execFileSync("/usr/bin/log", [
      "show",
      "--style", "syslog",
      "--last", `${windowMinutes}m`,
      "--predicate", predicate,
    ], { encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    const rawLines = output.split("\n").filter((line) => /^\d{4}-\d{2}-\d{2}/.test(line));
    return {
      windowMinutes,
      events: parseSystemAudioLog(rawLines.join("\n")),
      rawLines,
      queryError: null,
    };
  } catch (error) {
    return {
      windowMinutes,
      events: [],
      rawLines: [],
      queryError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function diagnoseFormatRequestCause(
  evidence: FormatRequestEvidence,
  targetName: string,
  lowRateBluetoothOutputNames: string[],
  processReader: (pid: number) => RunningProcess | null = readRunningProcess,
): FormatRequestCause {
  const requests = evidence.events.filter((event): event is FormatRequestEvent => event.kind === "format-request");
  const latestByPid = new Map<number, FormatRequestEvent>();
  for (const request of requests) latestByPid.set(request.requesterPid, request);
  const request = [...latestByPid.values()]
    .filter((event) => event.from === 0 && event.to === 1)
    .sort((left, right) => right.timestampMs - left.timestampMs)[0] ?? null;

  if (!request) {
    return {
      confidence: "无法确认",
      request: null,
      requester: null,
      sameProcessStartIo: null,
      matchingTsco: null,
      requestCount: requests.length,
      gaps: [evidence.queryError ? `系统声音日志读取失败：${evidence.queryError}` : "最近日志中没有未反向恢复的 0 -> 1 格式请求"],
    };
  }

  const requester = processReader(request.requesterPid);
  const sameProcessStartIo = evidence.events.find((event): event is StartIoEvent =>
    event.kind === "start-io" &&
    event.requesterPid === request.requesterPid &&
    Math.abs(event.timestampMs - request.timestampMs) <= 2_000
  ) ?? null;
  const matchingTsco = evidence.events.find((event): event is ProfileEvent =>
    event.kind === "profile" &&
    event.profile === "tsco" &&
    event.timestampMs >= request.timestampMs &&
    event.timestampMs - request.timestampMs <= 2_000
  ) ?? null;
  const requestCount = requests.filter((event) => event.requesterPid === request.requesterPid).length;
  const gaps: string[] = [];
  if (!requester) gaps.push("请求进程已经退出或无法核对其路径和启动时间");
  if (sameProcessStartIo) gaps.push("同一进程在两秒时间窗内存在 StartIO，不能归入仅格式请求");
  if (!matchingTsco) gaps.push("格式请求后两秒内没有匹配的 tsco 日志");
  if (lowRateBluetoothOutputNames.length !== 1 || lowRateBluetoothOutputNames[0] !== targetName) {
    gaps.push("当前低采样率蓝牙输出不是唯一目标，不能把请求扩大归因到所选设备");
  }

  return {
    confidence: gaps.length === 0 ? "已确认" : "高度疑似",
    request,
    requester,
    sameProcessStartIo,
    matchingTsco,
    requestCount,
    gaps,
  };
}
