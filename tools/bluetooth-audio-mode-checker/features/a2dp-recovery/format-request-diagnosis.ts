import { execFileSync } from "node:child_process";
import {
  readRunningProcess,
  type RunningProcess,
} from "../../core/macos-running-apps/index.ts";
import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";

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

export type MultiEndpointCause = {
  confidence: "已确认" | "高度疑似" | "无法确认";
  requester: RunningProcess | null;
  requesterPid: number | null;
  bindings: Array<{ address: string; direction: "input" | "output" }>;
  rejection: string | null;
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

function readSystemAudioEvidence(argumentsList: string[], windowMinutes: number): FormatRequestEvidence {
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
    "OR",
    'eventMessage CONTAINS[c] "deviceUIDs"',
    "OR",
    'eventMessage CONTAINS[c] "more than one BT device connected"',
    ")",
  ].join(" ");
  try {
    const output = execFileSync("/usr/bin/log", [
      "show",
      "--style", "syslog",
      ...argumentsList,
      "--predicate", predicate,
    ], { encoding: "utf8", timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
    const rawLines = output.split("\n").filter((line) =>
      line.trim().length > 0 && !line.startsWith("Timestamp")
    );
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

export function readRecentSystemAudioEvidence(windowMinutes = 10): FormatRequestEvidence {
  return readSystemAudioEvidence(["--last", `${windowMinutes}m`], windowMinutes);
}

export function readSystemAudioEvidenceSince(startedAtMs: number): FormatRequestEvidence {
  const boundedStart = Math.max(startedAtMs, Date.now() - 10 * 60_000);
  const windowMinutes = Math.max(1, Math.ceil((Date.now() - boundedStart) / 60_000));
  return readSystemAudioEvidence(["--start", new Date(boundedStart).toISOString()], windowMinutes);
}

function normalizedBluetoothIdentity(value: string): string {
  return value.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

export function diagnoseMultiEndpointCause(
  evidence: FormatRequestEvidence,
  target: RawAudioDevice,
  processReader: (pid: number) => RunningProcess | null = readRunningProcess,
): MultiEndpointCause {
  const raw = evidence.rawLines.join("\n");
  const sessionRegex = new RegExp(`${timestampPattern}[^\\n]*session:\\s*([^\\n(]+)\\((\\d+)\\)`, "gi");
  const sessionMatches = [...raw.matchAll(sessionRegex)];
  const sessionPids = [...new Set(sessionMatches.map((match) => Number(match[3])))];
  const requesterPid = sessionPids.length === 1 ? sessionPids[0] : null;
  const requester = requesterPid === null ? null : processReader(requesterPid);
  const bindings = [...raw.matchAll(/([0-9a-f]{2}(?:[-:][0-9a-f]{2}){5}):(input|output)\b/gi)]
    .map((match) => ({
      address: normalizedBluetoothIdentity(match[1]),
      direction: match[2].toLowerCase() as "input" | "output",
    }));
  const uniqueBindings = [...new Map(bindings.map((binding) =>
    [`${binding.address}:${binding.direction}`, binding] as const
  )).values()];
  const rejectionMatch = raw.match(/There was an error setting the deviceUUIDs[^\n]*more than one BT device connected[^\n]*/i);
  const rejection = rejectionMatch?.[0] ?? null;
  const targetIdentities = [target.uid, target.bluetoothAddress ?? ""]
    .map(normalizedBluetoothIdentity)
    .filter(Boolean);
  const addresses = new Set(uniqueBindings.map((binding) => binding.address));
  const gaps: string[] = [];
  if (sessionPids.length !== 1) gaps.push("同一日志窗口内无法锁定唯一声音会话进程");
  if (!requester) gaps.push("声音会话进程已经退出或无法复核身份");
  const latestSessionTimestampMs = Math.max(0, ...sessionMatches.map((match) => timestampToMilliseconds(match[1])));
  if (requester && Date.parse(requester.startedAt) > latestSessionTimestampMs + 1_000) {
    gaps.push("当前同进程号程序的启动时间晚于声音会话，可能发生了进程号复用");
  }
  if (!uniqueBindings.some((binding) => binding.direction === "input")) gaps.push("会话没有完整记录蓝牙输入端点");
  if (!uniqueBindings.some((binding) => binding.direction === "output")) gaps.push("会话没有完整记录蓝牙输出端点");
  if (addresses.size < 2) gaps.push("没有证明输入输出来自两台不同蓝牙设备");
  if (!rejection) gaps.push("系统没有记录拒绝多个蓝牙设备绑定");
  if (!uniqueBindings.some((binding) =>
    binding.direction === "output" && targetIdentities.includes(binding.address)
  )) gaps.push("日志中的蓝牙输出端点无法与目标设备对应");
  if (!target.isDefaultOutput || target.sampleRateOutput === null || target.sampleRateOutput > 16_000) {
    gaps.push("目标当前不是低采样率默认输出");
  }

  const hasCandidate = sessionMatches.length > 0 || uniqueBindings.length > 0 || rejection !== null;
  return {
    confidence: gaps.length === 0 ? "已确认" : hasCandidate ? "高度疑似" : "无法确认",
    requester,
    requesterPid,
    bindings: uniqueBindings,
    rejection,
    gaps,
  };
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
  if (requester && Date.parse(requester.startedAt) > request.timestampMs + 1_000) {
    gaps.push("当前同进程号程序的启动时间晚于格式请求，可能发生了进程号复用");
  }
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
