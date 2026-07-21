import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { setDefaultAudioDevice } from "../../core/macos-audio-route/index.ts";
import { reconnectBluetoothDevice } from "../../core/macos-bluetooth-link/index.ts";
import { readMicrophoneUsersAsync } from "../../core/macos-microphone-usage/index.ts";
import {
  readRunningProcess,
  terminateRunningProcess,
  type RunningProcess,
} from "../../core/macos-running-apps/index.ts";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import type {
  AudioModeAssessment,
  MicrophoneUser,
  RawAudioDevice,
} from "../../shared/audio-device-types/index.ts";
import {
  diagnoseFormatRequestCause,
  readRecentSystemAudioEvidence,
  readSystemAudioEvidenceSince,
  type FormatRequestCause,
  type FormatRequestEvidence,
} from "./format-request-diagnosis.ts";
import { createMultiEndpointRouteChoices, selectCauseRoute } from "./recovery-policy.ts";
import type {
  A2dpRecoveryResult,
  RecoveryDiagnosis,
  RecoveryProgress,
  RecoveryRequest,
  RecoveryRoundState,
  RecoveryRouteChoice,
  RecoveryStep,
  RelaunchGuardRequest,
} from "./types.ts";

const protectedProcessNames = new Set([
  "audioaccessoryd",
  "audiomxd",
  "bluetoothd",
  "coreaudiod",
  "kernel_task",
  "launchd",
]);
const intermediateLinkReleaseTimeoutMs = 500;
const intermediateLinkPollMs = 50;
const intermediateLinkRecoveryHoldMs = 1_000;

export type RecoveryRuntime = {
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
  readDevices: () => RawAudioDevice[];
  readMicrophoneUsers: () => Promise<MicrophoneUser[]>;
  readProcess: (pid: number) => RunningProcess | null;
  terminateProcess: (processInfo: RunningProcess) => void;
  readEvidence: () => FormatRequestEvidence;
  readEvidenceSince: (startedAtMs: number) => FormatRequestEvidence;
  readModeAssessment: (name: string) => AudioModeAssessment | null;
  readModeAssessments?: () => AudioModeAssessment[];
  setDefaultDevice: (direction: "input" | "output", name: string) => void;
  reconnectDevice: (name: string) => void;
};

export const systemRuntime: RecoveryRuntime = {
  now: Date.now,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  readDevices: () => readAudioDevices().devices,
  readMicrophoneUsers: () => readMicrophoneUsersAsync(2_000),
  readProcess: readRunningProcess,
  terminateProcess: terminateRunningProcess,
  readEvidence: () => readRecentSystemAudioEvidence(10),
  readEvidenceSince: readSystemAudioEvidenceSince,
  readModeAssessment: () => null,
  readModeAssessments: () => [],
  setDefaultDevice: setDefaultAudioDevice,
  reconnectDevice: reconnectBluetoothDevice,
};

type CauseMatch = {
  diagnosis: RecoveryDiagnosis;
  processes: RunningProcess[];
  routeChoices: RecoveryRouteChoice[];
  occupancyUsers: MicrophoneUser[];
};

type ProcessActionResult = {
  stableRecovery: StableRecovery | null;
  released: RunningProcess[];
  remaining: RunningProcess[];
};

type StableRecovery = {
  rate: number | null;
  mode: AudioModeAssessment["mode"];
};

function isBluetooth(device: RawAudioDevice): boolean {
  return device.transport === "bluetooth" || device.transport === "bluetooth-le";
}

function targetOutput(devices: RawAudioDevice[], name: string): RawAudioDevice | undefined {
  return devices
    .filter((device) => device.name === name && device.outputChannels > 0)
    .sort((left, right) =>
      Number(right.isDefaultOutput) - Number(left.isDefaultOutput) ||
      Number(right.isDefaultSystemOutput) - Number(left.isDefaultSystemOutput) ||
      right.outputChannels - left.outputChannels ||
      (right.actualSampleRateOutput ?? 0) - (left.actualSampleRateOutput ?? 0)
    )[0];
}

function actualOutputRate(device: RawAudioDevice | undefined): number | null {
  const rate = device?.actualSampleRateOutput;
  return rate !== null && rate !== undefined && rate > 0 ? rate : null;
}

function maxAvailableOutputRate(device: RawAudioDevice | undefined): number {
  return Math.max(0, ...(device?.availableSampleRateRangesOutput ?? []).map((range) => range.maximum));
}

function currentOutputRate(runtime: RecoveryRuntime, name: string): number | null {
  const target = targetOutput(runtime.readDevices(), name);
  return actualOutputRate(target);
}

function assessmentOutputRate(assessment: AudioModeAssessment | null): number | null {
  const rate = assessment?.actualSampleRateOutput;
  return rate !== null && rate !== undefined && rate > 0 ? rate : null;
}

function currentRecoveryObservation(
  runtime: RecoveryRuntime,
  name: string,
): {
  rate: number | null;
  mode: AudioModeAssessment["mode"] | null;
  isDefaultOutput: boolean;
} {
  const assessment = runtime.readModeAssessment(name);
  const rateFromAssessment = assessmentOutputRate(assessment);
  const hasDefaultOutputFact = typeof assessment?.isDefaultOutput === "boolean";
  const needsDeviceFallback = assessment === null || !hasDefaultOutputFact ||
    (assessment.isDefaultOutput && rateFromAssessment === null);
  const target = needsDeviceFallback ? targetOutput(runtime.readDevices(), name) : undefined;
  return {
    rate: rateFromAssessment ?? actualOutputRate(target),
    mode: assessment?.mode ?? null,
    isDefaultOutput: assessment?.isDefaultOutput === true || target?.isDefaultOutput === true,
  };
}

function currentModeAssessment(
  runtime: RecoveryRuntime,
  request: RecoveryRequest,
): AudioModeAssessment | null {
  return currentModeAssessments(runtime, request).find((assessment) => assessment.name === request.name) ??
    runtime.readModeAssessment(request.name) ?? request.context?.targetAssessment ?? null;
}

function currentModeAssessments(
  runtime: RecoveryRuntime,
  request: RecoveryRequest,
): AudioModeAssessment[] {
  const live = runtime.readModeAssessments?.() ?? [];
  if (live.length > 0) return live;
  if ((request.context?.deviceAssessments?.length ?? 0) > 0) return request.context?.deviceAssessments ?? [];
  const target = runtime.readModeAssessment(request.name) ?? request.context?.targetAssessment ?? null;
  return target ? [target] : [];
}

function currentDefaultName(
  devices: RawAudioDevice[],
  direction: "input" | "output",
): string | null {
  return devices.find((device) =>
    direction === "input" ? device.isDefaultInput : device.isDefaultOutput
  )?.name ?? null;
}

function processDescription(processInfo: RunningProcess): string {
  return `${processInfo.name}（进程号 ${processInfo.pid}，启动时间 ${processInfo.startedAt}，路径 ${processInfo.command}）`;
}

function addStep(
  name: string,
  steps: RecoveryStep[],
  stage: string,
  status: RecoveryStep["status"],
  detail: string,
  sampleRate?: number | null,
): void {
  steps.push({ stage, status, detail, sampleRate });
  detailedLog(status === "失败" ? "warn" : "info", "a2dp-recovery.step", {
    deviceName: name,
    stage,
    status,
    detail,
    sampleRate,
  });
}

function makeResult(
  partial: Omit<A2dpRecoveryResult, "ok">,
): A2dpRecoveryResult {
  const result: A2dpRecoveryResult = {
    ...partial,
    ok: partial.outcome === "无需修复" || partial.outcome === "完全恢复" || partial.outcome === "绕过成功",
  };
  detailedLog(result.ok ? "info" : "warn", "a2dp-recovery.completed", { result });
  return result;
}

function formatCauseEvidence(cause: FormatRequestCause, windowMinutes: number): string[] {
  const evidence = [`只查询了一次该时间窗内的系统声音事件（${windowMinutes} 分钟）`];
  if (cause.request) {
    evidence.push(`格式请求原文：${cause.request.raw}`);
    evidence.push(`该进程在窗口内共有 ${cause.requestCount} 条格式请求`);
  }
  if (cause.requester) evidence.push(`请求进程：${processDescription(cause.requester)}`);
  evidence.push(cause.sameProcessStartIo ? "同进程两秒内存在输入启动" : "同进程两秒内未发现输入启动");
  evidence.push(cause.matchingTsco ? `匹配的通话链路原文：${cause.matchingTsco.raw}` : "请求后两秒内未发现匹配的通话链路");
  evidence.push(...cause.gaps.map((gap) => `证据缺口：${gap}`));
  return evidence;
}

function identifyProcesses(
  users: MicrophoneUser[],
  runtime: RecoveryRuntime,
): { processes: RunningProcess[]; missing: MicrophoneUser[] } {
  const processes = [...new Map(users
    .map((user) => runtime.readProcess(user.pid))
    .filter((processInfo): processInfo is RunningProcess => processInfo !== null)
    .map((processInfo) => [processInfo.pid, processInfo] as const)).values()];
  return {
    processes,
    missing: users.filter((user) => !processes.some((processInfo) => processInfo.pid === user.pid)),
  };
}

function isPhysicalInputDevice(device: RawAudioDevice): boolean {
  if (device.inputChannels <= 0 || !device.transport) return false;
  if (["virtual", "aggregate", "unknown"].includes(device.transport)) return false;
  return !/audiotap|audio tap|loopback|soundflower|blackhole/i.test(
    `${device.name} ${device.uid} ${device.manufacturer}`,
  );
}

function confirmedOccupancyUsers(
  users: MicrophoneUser[],
  devices: RawAudioDevice[],
  assessments: AudioModeAssessment[],
): MicrophoneUser[] {
  const physicalInputs = new Map(devices
    .filter(isPhysicalInputDevice)
    .map((device) => [device.name, device] as const));
  const assessmentByName = new Map(assessments.map((assessment) => [assessment.name, assessment] as const));
  return users.flatMap((user) => {
    const physicalDeviceNames = [...new Set(user.devices.filter((deviceName) => physicalInputs.has(deviceName)))];
    const confirmedDeviceNames = physicalDeviceNames.filter((deviceName) =>
      assessmentByName.get(deviceName)?.audioLinkType === "tsco"
    );
    return confirmedDeviceNames.length > 0 ? [{
      ...user,
      inputActivityKind: "已确认实体麦克风占用" as const,
      physicalDeviceNames,
      confirmedDeviceNames,
    }] : [];
  });
}

function multiEndpointCondition(
  name: string,
  devices: RawAudioDevice[],
  targetAssessment: AudioModeAssessment | null,
) {
  const input = devices.find((device) => device.isDefaultInput && device.inputChannels > 0);
  const output = devices.find((device) => device.isDefaultOutput && device.outputChannels > 0);
  const differentBluetoothEndpoints = Boolean(
    input && output && isBluetooth(input) && isBluetooth(output) && input.name !== output.name,
  );
  const targetHasTsco = targetAssessment?.name === name && targetAssessment.audioLinkType === "tsco";
  return { confirmed: differentBluetoothEndpoints && targetHasTsco, input, output, targetHasTsco };
}

function diagnoseCause(
  name: string,
  devices: RawAudioDevice[],
  users: MicrophoneUser[],
  evidence: FormatRequestEvidence | null,
  runtime: RecoveryRuntime,
  request: RecoveryRequest,
): CauseMatch {
  const assessments = currentModeAssessments(runtime, request);
  const targetAssessment = assessments.find((assessment) => assessment.name === name) ??
    runtime.readModeAssessment(name) ?? request.context?.targetAssessment ?? null;
  const multiEndpoint = multiEndpointCondition(name, devices, targetAssessment);
  if (multiEndpoint.confirmed) {
    return {
      diagnosis: {
        kind: selectCauseRoute(true, false, false, false),
        confidence: "已确认",
        summary: "当前输入和输出来自两台不同的蓝牙设备，且目标设备最新链路为 tsco",
        evidence: [
          `当前输入：${multiEndpoint.input?.name ?? "未知"}`,
          `当前输出：${multiEndpoint.output?.name ?? "未知"}`,
          "目标设备最新链路：tsco",
        ],
      },
      processes: [],
      routeChoices: createMultiEndpointRouteChoices(devices, name),
      occupancyUsers: [],
    };
  }

  const occupancyUsers = confirmedOccupancyUsers(users, devices, assessments);
  const identified = identifyProcesses(occupancyUsers, runtime);
  if (identified.processes.length > 0) {
    const currentUsers = occupancyUsers.filter((user) =>
      identified.processes.some((processInfo) => processInfo.pid === user.pid)
    );
    return {
      diagnosis: {
        kind: selectCauseRoute(false, true, false, false),
        confidence: "已确认",
        summary: "已确认本机进程关联实体麦克风端点，且该麦克风所属蓝牙设备最新链路为 tsco",
        evidence: currentUsers.flatMap((user) => (user.confirmedDeviceNames ?? []).map((deviceName) =>
          `${user.name}（进程号 ${user.pid}）正在读取实体麦克风 ${deviceName}；该设备最新链路为 tsco`
        )),
      },
      processes: identified.processes,
      routeChoices: [],
      occupancyUsers: currentUsers,
    };
  }

  const target = targetOutput(devices, name);
  if (targetAssessment?.audioLinkType === "tsco") {
    return {
      diagnosis: {
        kind: selectCauseRoute(false, false, true, false),
        confidence: "已确认",
        summary: "当前没有已确认实体麦克风占用，但目标设备最新链路仍为 tsco",
        evidence: [
          `目标设备：${name}`,
          "目标设备最新链路：tsco",
          users.length > 0
            ? "检测到声音输入活动，但没有形成进程、实体麦克风端点和 tsco 三段完整占用证据"
            : "当前没有声音输入活动形成实体麦克风占用证据",
        ],
      },
      processes: [],
      routeChoices: [],
      occupancyUsers: [],
    };
  }
  if (!target || !evidence) {
    return {
      diagnosis: {
        kind: "证据不足",
        confidence: "无法确认",
        summary: "没有可安全执行进程处理的完整证据",
        evidence: [target ? "当前没有实际麦克风占用，且声音事件不可用" : "目标输出端点不存在"],
      },
      processes: [],
      routeChoices: [],
      occupancyUsers: [],
    };
  }

  const lowRateBluetoothOutputNames = devices
    .filter((device) =>
      device.isDefaultOutput && device.outputChannels > 0 && isBluetooth(device) &&
      actualOutputRate(device) !== null && (actualOutputRate(device) ?? 0) <= 16_000
    )
    .map((device) => device.name);
  const format = diagnoseFormatRequestCause(evidence, name, lowRateBluetoothOutputNames, runtime.readProcess);
  const kind = selectCauseRoute(false, false, false, format.confidence === "已确认");
  if (kind === "格式请求类") {
    return {
      diagnosis: {
        kind,
        confidence: "已确认",
        summary: "普通进程提交格式请求并在两秒内触发通话链路，且同进程没有输入启动",
        evidence: formatCauseEvidence(format, evidence.windowMinutes),
      },
      processes: format.requester ? [format.requester] : [],
      routeChoices: [],
      occupancyUsers: [],
    };
  }

  return {
    diagnosis: {
      kind: "证据不足",
      confidence: format.confidence === "高度疑似" ? "高度疑似" : "无法确认",
      summary: "没有完整命中已确证原因特征，不结束任何候选进程",
      evidence: formatCauseEvidence(format, evidence.windowMinutes),
    },
    processes: [],
    routeChoices: [],
    occupancyUsers: [],
  };
}

async function verifyStableRecovery(
  name: string,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  attempts = 10,
): Promise<StableRecovery | null> {
  let consecutive = 0;
  let lastRate: number | null = null;
  let lastMode: AudioModeAssessment["mode"] | null = null;
  let progressReported = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const observation = currentRecoveryObservation(runtime, name);
    lastRate = observation.rate;
    lastMode = observation.mode;
    const isDefaultOutput = observation.isDefaultOutput;
    const recovered = isDefaultOutput
      ? lastRate !== null && lastRate > 16_000 && lastMode === "A2DP"
      : lastMode !== null && lastMode !== "HFP_HSP";
    if (recovered) {
      consecutive += 1;
      if (!progressReported) {
        progressReported = true;
        reportProgress({
          stage: "正在确认稳定",
          message: isDefaultOutput
            ? `已观察到 ${(lastRate ?? 0) / 1_000} kHz 且模式为高音质播放，正在连续确认不会再次进入通话模式。`
            : "已观察到设备退出 HFP/HSP，正在连续确认不会再次进入通话模式。",
        });
      }
      if (consecutive >= 3 && lastMode !== null) return { rate: lastRate, mode: lastMode };
    } else {
      consecutive = 0;
    }
    if (attempt < attempts - 1) await runtime.wait(500);
  }
  return null;
}

async function waitForProcessesToExit(
  processes: RunningProcess[],
  runtime: RecoveryRuntime,
): Promise<RunningProcess[]> {
  let remaining = processes;
  for (let attempt = 0; attempt < 20 && remaining.length > 0; attempt += 1) {
    remaining = processes
      .map((processInfo) => runtime.readProcess(processInfo.pid))
      .filter((processInfo): processInfo is RunningProcess => processInfo !== null)
      .filter((current) => processes.some((expected) =>
        expected.pid === current.pid && expected.startedAt === current.startedAt && expected.command === current.command
      ));
    if (remaining.length > 0) await runtime.wait(100);
  }
  return remaining;
}

async function executeProcessAction(
  name: string,
  processes: RunningProcess[],
  steps: RecoveryStep[],
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
): Promise<ProcessActionResult> {
  const unsafe = processes.filter((processInfo) => protectedProcessNames.has(processInfo.name));
  if (unsafe.length > 0) {
    addStep(name, steps, "解除已确证原因", "失败", `命中受保护系统进程：${unsafe.map(processDescription).join("、")}`);
    return { stableRecovery: null, released: [], remaining: unsafe };
  }
  if (runtime.readModeAssessment(name)?.mode !== "HFP_HSP") {
    addStep(name, steps, "解除已确证原因", "跳过", "动作前目标已经恢复");
    return { stableRecovery: await verifyStableRecovery(name, runtime, reportProgress), released: [], remaining: [] };
  }

  reportProgress({ stage: "正在执行处理", message: "正在请求已确证原因进程正常退出。" });
  for (const processInfo of processes) runtime.terminateProcess(processInfo);
  addStep(name, steps, "解除已确证原因", "成功", `只向已确证进程发送正常退出请求：${processes.map(processDescription).join("、")}`);
  const remaining = await waitForProcessesToExit(processes, runtime);
  const released = processes.filter((processInfo) => !remaining.some((item) => item.pid === processInfo.pid));
  addStep(
    name,
    steps,
    "复查原因进程",
    remaining.length === 0 ? "成功" : "失败",
    remaining.length === 0 ? "已确认原因进程退出" : `仍存在：${remaining.map(processDescription).join("、")}`,
  );
  const stableRecovery = remaining.length === 0
    ? await verifyStableRecovery(name, runtime, reportProgress)
    : null;
  return { stableRecovery, released, remaining };
}

async function waitForRoute(
  direction: "input" | "output",
  name: string,
  runtime: RecoveryRuntime,
): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (currentDefaultName(runtime.readDevices(), direction) === name) return true;
    await runtime.wait(100);
  }
  return false;
}

async function waitForIntermediateLinkRelease(
  name: string,
  runtime: RecoveryRuntime,
): Promise<boolean> {
  let elapsedMs = 0;
  while (true) {
    if (runtime.readModeAssessment(name)?.audioLinkType === "tacl") return true;
    if (elapsedMs >= intermediateLinkReleaseTimeoutMs) return false;
    const waitMs = Math.min(
      intermediateLinkPollMs,
      intermediateLinkReleaseTimeoutMs - elapsedMs,
    );
    await runtime.wait(waitMs);
    elapsedMs += waitMs;
  }
}

async function waitForDevice(
  name: string,
  direction: "input" | "output",
  runtime: RecoveryRuntime,
  attempts = 30,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const available = runtime.readDevices().some((device) =>
      device.name === name && (direction === "input" ? device.inputChannels > 0 : device.outputChannels > 0)
    );
    if (available) return true;
    if (attempt < attempts - 1) await runtime.wait(100);
  }
  return false;
}

async function restoreOriginalRoutes(
  name: string,
  originalInput: string | null,
  originalOutput: string | null,
  steps: RecoveryStep[],
  runtime: RecoveryRuntime,
): Promise<boolean> {
  let restored = true;
  for (const [direction, expected] of [["input", originalInput], ["output", originalOutput]] as const) {
    const devices = runtime.readDevices();
    if (!expected || currentDefaultName(devices, direction) === expected) continue;
    const available = devices.some((device) =>
      device.name === expected && (direction === "input" ? device.inputChannels > 0 : device.outputChannels > 0)
    );
    if (!available) {
      restored = false;
      addStep(name, steps, "恢复点击前声音设备", "失败", `点击前${direction === "input" ? "输入" : "输出"}“${expected}”当前不可用`);
      continue;
    }
    runtime.setDefaultDevice(direction, expected);
    const confirmed = await waitForRoute(direction, expected, runtime);
    restored = restored && confirmed;
    addStep(name, steps, "恢复点击前声音设备", confirmed ? "成功" : "失败", `${direction === "input" ? "输入" : "输出"}：${expected}`);
  }
  return restored;
}

function reconnectFailureDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ETIMEDOUT") || message.toLowerCase().includes("timed out")) {
    return "设备连接未在限定时间内完成，已继续按系统实时状态复核";
  }
  return "设备连接操作未正常完成，已继续按系统实时状态复核";
}

async function verifyStableRouteChoice(
  choice: RecoveryRouteChoice,
  runtime: RecoveryRuntime,
): Promise<boolean> {
  let consecutive = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = currentDefaultName(runtime.readDevices(), choice.direction);
    consecutive = current === choice.deviceName ? consecutive + 1 : 0;
    if (consecutive >= 3) return true;
    await runtime.wait(500);
  }
  return false;
}

async function currentMicrophoneUsers(
  request: RecoveryRequest,
  runtime: RecoveryRuntime,
): Promise<MicrophoneUser[]> {
  const cached = request.context?.occupancySnapshot;
  const clickedAt = Date.parse(request.context?.clickedAt ?? "");
  const capturedAt = Date.parse(cached?.capturedAt ?? "");
  if (cached && Number.isFinite(clickedAt) && Number.isFinite(capturedAt) &&
      capturedAt >= clickedAt - 2_000 && capturedAt <= runtime.now() + 1_000) {
    return cached.users;
  }
  return runtime.readMicrophoneUsers();
}

function baseMessage(outcome: A2dpRecoveryResult["outcome"], name: string, rate: number | null): string {
  if (outcome === "无需修复") return `${name} 在动作前已经恢复，无需继续处理。`;
  if (outcome === "完全恢复") {
    return rate !== null && rate > 16_000
      ? `${name} 已稳定恢复到 ${rate / 1_000} kHz。`
      : `${name} 已稳定退出 HFP/HSP。`;
  }
  if (outcome === "绕过成功") return "替代输入输出组合已经稳定；这是绕过成功，不代表原组合已完全修复。";
  if (outcome === "原组合复发") return "恢复点击前输入输出组合后再次进入通话模式，原组合仍会复发。";
  if (outcome === "等待选择") return "已确认多端点会话问题，请选择希望保留输入还是输出。";
  if (outcome === "等待授权") return "原因进程未退出或再次触发问题，需要你确认具体进程后再授权继续处理。";
  return `${name} 仍未稳定恢复到高于 16 kHz，本轮自动处理已停止。`;
}

export async function runRecovery(
  request: RecoveryRequest,
  runtime: RecoveryRuntime = systemRuntime,
  reportProgress: (progress: RecoveryProgress) => void = () => {},
): Promise<A2dpRecoveryResult> {
  const name = request.name;
  const suppliedContext = request._roundState?.context ?? request.context;
  const firstDevices = suppliedContext ? [] : runtime.readDevices();
  const firstTarget = targetOutput(firstDevices, name);
  const context = suppliedContext ?? {
    clickedAt: new Date(runtime.now()).toISOString(),
    defaultInput: currentDefaultName(firstDevices, "input"),
    defaultOutput: currentDefaultName(firstDevices, "output"),
    targetSampleRate: actualOutputRate(firstTarget),
    targetAssessment: runtime.readModeAssessment(name),
    deviceAssessments: runtime.readModeAssessments?.() ?? [],
  };
  const state: RecoveryRoundState = request._roundState ? {
    ...request._roundState,
    context,
    processAttempts: request._roundState.processAttempts.map((attempt) => ({ ...attempt })),
    releasedBluetoothInputPrograms: [...request._roundState.releasedBluetoothInputPrograms],
    releasedPrograms: [...request._roundState.releasedPrograms],
    remainingPrograms: [...request._roundState.remainingPrograms],
    guardedPrograms: [...request._roundState.guardedPrograms],
    steps: [...request._roundState.steps],
  } : {
    context,
    initialOccupancyChecked: false,
    causeReviewCount: 0,
    processAttempts: [],
    linkResidualAttempted: false,
    fallbackInputAttempted: false,
    reconnectAttempted: false,
    initialEvidenceRead: false,
    evidenceSinceMs: null,
    releasedBluetoothInputPrograms: [],
    releasedPrograms: [],
    remainingPrograms: [],
    guardedPrograms: [],
    steps: [],
  };
  const steps = state.steps;
  const originalInput = context.defaultInput;
  const originalOutput = context.defaultOutput;
  const initialRate = context.targetSampleRate ?? actualOutputRate(firstTarget);
  const targetAssessment = currentModeAssessment(runtime, { ...request, context });
  const unique = (items: string[]) => [...new Set(items)];
  const handledCause = () => state.processAttempts.length > 0 || state.linkResidualAttempted;

  const result = (
    outcome: A2dpRecoveryResult["outcome"],
    diagnosis: RecoveryDiagnosis,
    recoveryPath: A2dpRecoveryResult["recoveryPath"],
    options: {
      actionRequired?: A2dpRecoveryResult["actionRequired"];
      continuationGuards?: RelaunchGuardRequest[];
      message?: string;
      sampleRate?: number | null;
    } = {},
  ): A2dpRecoveryResult => {
    const resolvedSampleRate = options.sampleRate === undefined
      ? assessmentOutputRate(runtime.readModeAssessment(name)) ?? currentOutputRate(runtime, name)
      : options.sampleRate;
    return makeResult({
      outcome,
      recoveryPath,
      handledCause: handledCause(),
      sampleRate: resolvedSampleRate,
      releasedPrograms: unique(state.releasedPrograms),
      remainingPrograms: unique(state.remainingPrograms),
      guardedPrograms: unique(state.guardedPrograms),
      diagnosis,
      steps,
      usedReconnect: state.reconnectAttempted,
      actionRequired: options.actionRequired,
      message: options.message ?? baseMessage(outcome, name, resolvedSampleRate),
      _continuation: options.actionRequired ? {
        roundState: state,
        pendingGuards: options.continuationGuards ?? [],
      } : undefined,
    });
  };

  if (!request._roundState) {
    reportProgress({ stage: "正在保存现场", message: "正在保存点击时的输入、输出、模式、每设备链路和进程端点关联。" });
    addStep(name, steps, "保存现场", "成功", `点击时间：${context.clickedAt}；输入：${originalInput ?? "未知"}；输出：${originalOutput ?? "未知"}；目标采样率：${initialRate ?? "未知"}；目标链路：${targetAssessment?.audioLinkType ?? "无法确认"}`);
  } else {
    reportProgress({ stage: "正在定位原因", message: "正在沿用原点击现场和本轮处理记录继续修复。" });
  }

  if (targetAssessment?.a2dpSupport === "UNSUPPORTED") {
    const diagnosis: RecoveryDiagnosis = {
      kind: "证据不足",
      confidence: "已确认",
      summary: "目标设备的输出可用采样率最高值低于 44.1 kHz，不支持 A2DP，本身无需修复",
      evidence: targetAssessment.evidence,
    };
    addStep(name, steps, "复核 A2DP 支持能力", "跳过", diagnosis.summary);
    return result("无需修复", diagnosis, "现场复核", {
      sampleRate: assessmentOutputRate(targetAssessment) ?? context.targetSampleRate ?? currentOutputRate(runtime, name),
      message: `${name} 不支持 A2DP，该设备本身无需修复；它的端点和链路事实仍会用于判断其他受影响设备。`,
    });
  }

  if (targetAssessment?.mode !== "HFP_HSP") {
    const targetRate = assessmentOutputRate(targetAssessment) ?? currentOutputRate(runtime, name);
    const alreadyRecovered = targetAssessment !== null;
    const skippedRouteChoice = alreadyRecovered && request._confirmedRouteChoice !== undefined;
    const diagnosis: RecoveryDiagnosis = {
      kind: "证据不足",
      confidence: alreadyRecovered ? "已确认" : "无法确认",
      summary: skippedRouteChoice
        ? "目标已自行恢复，本次未执行输入输出切换"
        : alreadyRecovered ? "目标现场已经退出 HFP/HSP" : "没有可用的最新模式判定，无法确认目标仍处于 HFP/HSP",
      evidence: [
        `点击前默认输入：${originalInput ?? "未知"}`,
        `点击前默认输出：${originalOutput ?? "未知"}`,
        `最新模式判定：${targetAssessment?.mode ?? "UNKNOWN"}`,
      ],
    };
    addStep(name, steps, "复核目标", "成功", diagnosis.summary, targetRate);
    return result("无需修复", diagnosis, "现场复核", {
      sampleRate: targetRate,
      message: skippedRouteChoice
        ? `${name} 已在执行前自行恢复，本次没有修改系统默认输入输出。`
        : alreadyRecovered ? baseMessage("无需修复", name, targetRate) : `${name} 当前缺少可用的最新模式判定，本次未执行修复动作。`,
    });
  }

  if (request._confirmedRouteChoice) {
    const { choice, diagnosis } = request._confirmedRouteChoice;
    const latestTarget = currentModeAssessment(runtime, { ...request, context });
    const stillConfirmed = multiEndpointCondition(name, runtime.readDevices(), latestTarget).confirmed;
    if (stillConfirmed) {
      reportProgress({ stage: "正在执行处理", message: `正在应用已确认组合：${choice.label}` });
      runtime.setDefaultDevice(choice.direction, choice.deviceName);
      const changed = await waitForRoute(choice.direction, choice.deviceName, runtime);
      const routeStable = changed && await verifyStableRouteChoice(choice, runtime);
      const modeStable = routeStable ? await verifyStableRecovery(name, runtime, reportProgress, 3) : null;
      const stable = routeStable && modeStable !== null;
      addStep(name, steps, "应用多端点替代组合", stable ? "成功" : "失败", choice.label);
      return result(stable ? "绕过成功" : "未恢复", diagnosis, "多端点路由组合", {
        sampleRate: modeStable?.rate ?? currentOutputRate(runtime, name),
      });
    }
    addStep(name, steps, "复核多端点选择", "跳过", "双蓝牙组合与目标 tsco 不再同时成立，旧选择未执行，继续按最新现场匹配原因");
  }

  for (const guard of request._approvedRelaunchGuards ?? []) {
    const attempt = state.processAttempts.find((item) => item.command === guard.command);
    if (attempt) attempt.authorizedAttempted = true;
    state.guardedPrograms.push(guard.processName);
    addStep(name, steps, "启用本次开机阻止自动拉起", "成功", guard.processName);
  }
  if ((request._approvedRelaunchGuards?.length ?? 0) > 0) {
    state.evidenceSinceMs = runtime.now();
    await runtime.wait(100);
    const recoveredAfterAuthorization = await verifyStableRecovery(name, runtime, reportProgress, 3);
    if (recoveredAfterAuthorization !== null) {
      const diagnosis: RecoveryDiagnosis = {
        kind: state.processAttempts.find((item) => item.authorizedAttempted)?.cause ?? "麦克风占用类",
        confidence: "已确认",
        summary: "本次开机阻止自动拉起后目标已经稳定恢复",
        evidence: unique(state.guardedPrograms).map((program) => `已阻止自动拉起：${program}`),
      };
      return result("完全恢复", diagnosis, "原因对应处理", { sampleRate: recoveredAfterAuthorization.rate });
    }
  }

  const bluetoothInputNames = () => {
    const assessmentNames = currentModeAssessments(runtime, { ...request, context })
      .filter((assessment) =>
        assessment.inputChannels > 0 &&
        (assessment.inputTransport === "bluetooth" || assessment.inputTransport === "bluetooth-le")
      )
      .map((assessment) => assessment.name);
    if (assessmentNames.length > 0) return new Set(assessmentNames);
    return new Set(runtime.readDevices()
      .filter((device) => isBluetooth(device) && device.inputChannels > 0)
      .map((device) => device.name));
  };
  const usersIncludeBluetoothInput = (users: MicrophoneUser[]) => {
    const names = bluetoothInputNames();
    return users.some((user) => user.devices.some((deviceName) => names.has(deviceName)));
  };
  const readCurrentUsers = async (initial: boolean): Promise<MicrophoneUser[]> => {
    try {
      return initial ? await currentMicrophoneUsers({ ...request, context }, runtime) : await runtime.readMicrophoneUsers();
    } catch (error) {
      addStep(name, steps, initial ? "补充麦克风占用检查" : "重新匹配当前原因", "失败", error instanceof Error ? error.message : String(error));
      return [];
    }
  };
  let prefetchedUsersForReview: MicrophoneUser[] | null = null;
  const matchCurrentCause = async (): Promise<{ cause: CauseMatch; users: MicrophoneUser[] } | null> => {
    if (state.causeReviewCount >= 4) {
      addStep(name, steps, "原因复查上限", "跳过", "本轮已经完成四次原因复查，不再执行新的原因动作");
      return null;
    }
    state.causeReviewCount += 1;
    reportProgress({ stage: "正在定位原因", message: `正在进行本轮第 ${state.causeReviewCount} 次原因复查。` });
    const users = prefetchedUsersForReview ?? await readCurrentUsers(false);
    prefetchedUsersForReview = null;
    const devices = runtime.readDevices();
    let cause = diagnoseCause(name, devices, users, null, runtime, { ...request, context });
    if (cause.diagnosis.kind === "证据不足") {
      const evidence = state.evidenceSinceMs !== null
        ? runtime.readEvidenceSince(state.evidenceSinceMs)
        : !state.initialEvidenceRead ? runtime.readEvidence() : null;
      if (state.evidenceSinceMs !== null) state.evidenceSinceMs = null;
      else if (!state.initialEvidenceRead) state.initialEvidenceRead = true;
      cause = diagnoseCause(name, devices, users, evidence, runtime, { ...request, context });
    }
    const assessments = currentModeAssessments(runtime, { ...request, context });
    const latestTarget = assessments.find((assessment) => assessment.name === name) ?? null;
    const multiEndpoint = multiEndpointCondition(name, devices, latestTarget);
    const occupancyUsers = confirmedOccupancyUsers(users, devices, assessments);
    detailedLog("info", "a2dp-recovery.cause-gates", {
      deviceName: name,
      causeReviewCount: state.causeReviewCount,
      defaultInput: multiEndpoint.input?.name ?? null,
      defaultOutput: multiEndpoint.output?.name ?? null,
      differentBluetoothEndpoints: Boolean(
        multiEndpoint.input && multiEndpoint.output &&
        isBluetooth(multiEndpoint.input) && isBluetooth(multiEndpoint.output) &&
        multiEndpoint.input.name !== multiEndpoint.output.name,
      ),
      targetAudioLinkType: latestTarget?.audioLinkType ?? null,
      targetA2dpSupport: latestTarget?.a2dpSupport ?? "UNKNOWN",
      unsupportedA2dpDevices: assessments
        .filter((assessment) => assessment.a2dpSupport === "UNSUPPORTED")
        .map((assessment) => ({
          name: assessment.name,
          isDefaultInput: assessment.isDefaultInput,
          audioLinkType: assessment.audioLinkType,
        })),
      multiEndpointConfirmed: multiEndpoint.confirmed,
      inputActivities: users.map((user) => ({
        pid: user.pid,
        processName: user.name,
        reportedDevices: user.devices,
      })),
      confirmedOccupancy: occupancyUsers.map((user) => ({
        pid: user.pid,
        processName: user.name,
        microphoneDeviceNames: user.confirmedDeviceNames ?? [],
      })),
      selectedCause: cause.diagnosis.kind,
    });
    addStep(name, steps, "重新匹配当前原因", cause.diagnosis.confidence === "已确认" ? "成功" : "失败", `${cause.diagnosis.kind}：${cause.diagnosis.summary}`);
    return { cause, users: cause.occupancyUsers };
  };

  const performInputReset = async (stage: "链路残留处理" | "声音链路重建兜底"): Promise<StableRecovery | null> => {
    const fallbackInput = runtime.readDevices().find((device) =>
      device.inputChannels > 0 && !isBluetooth(device) && device.name !== originalInput
    );
    if (!fallbackInput || !originalInput) {
      addStep(name, steps, "临时切换到非蓝牙输入", "跳过", "没有可用的非蓝牙中转输入，或点击前输入未知");
      return null;
    }
    reportProgress({ stage: "正在执行处理", message: stage === "链路残留处理" ? "正在解除残留输入绑定并恢复原输入。" : "正在切换输入以重建声音链路。" });
    runtime.setDefaultDevice("input", fallbackInput.name);
    addStep(name, steps, "临时切换到非蓝牙输入", "成功", `已请求切换到：${fallbackInput.name}；最多等待 ${intermediateLinkReleaseTimeoutMs} 毫秒观察目标链路释放`);
    const linkReleased = await waitForIntermediateLinkRelease(name, runtime);
    addStep(
      name,
      steps,
      "等待中转期间链路释放",
      linkReleased ? "成功" : "失败",
      linkReleased
        ? `已观察到目标链路转为 tacl；从出现时刻起保持中转输入 ${intermediateLinkRecoveryHoldMs} 毫秒`
        : `${intermediateLinkReleaseTimeoutMs} 毫秒内未观察到目标链路转为 tacl；不再额外等待，立即恢复原输入`,
    );
    if (linkReleased) await runtime.wait(intermediateLinkRecoveryHoldMs);
    runtime.setDefaultDevice("input", originalInput);
    const restored = await waitForRoute("input", originalInput, runtime);
    addStep(name, steps, "恢复点击前输入", restored ? "成功" : "失败", restored ? `${originalInput}；只从此刻开始验证原输入输出组合` : originalInput);
    if (!restored) return null;
    const recovery = await verifyStableRecovery(name, runtime, reportProgress);
    const devices = runtime.readDevices();
    const originalRoutesStillCurrent = currentDefaultName(devices, "input") === originalInput &&
      currentDefaultName(devices, "output") === originalOutput;
    if (recovery !== null && !originalRoutesStillCurrent) {
      addStep(name, steps, "验收点击前组合", "失败", "目标模式已恢复，但点击前输入输出组合不再同时成立");
      return null;
    }
    return recovery;
  };

  let lastDiagnosis: RecoveryDiagnosis = {
    kind: "证据不足",
    confidence: "无法确认",
    summary: "尚未完成原因匹配",
    evidence: [],
  };
  const reconnectAndFinish = async (diagnosis: RecoveryDiagnosis, recoveryPath: A2dpRecoveryResult["recoveryPath"]): Promise<A2dpRecoveryResult> => {
    if (state.reconnectAttempted) {
      addStep(name, steps, "断开并重连目标设备", "跳过", "本轮已经执行过一次蓝牙重连，不再重复");
      return result("未恢复", diagnosis, recoveryPath);
    }
    state.reconnectAttempted = true;
    let reconnectError: unknown = null;
    try {
      runtime.reconnectDevice(name);
    } catch (error) {
      reconnectError = error;
    }
    const currentTarget = runtime.readDevices().find((device) => device.name === name);
    const direction = currentTarget?.outputChannels && currentTarget.outputChannels > 0 ? "output" : "input";
    const targetAvailable = await waitForDevice(name, direction, runtime);
    addStep(name, steps, "断开并重连目标设备", targetAvailable ? "成功" : "失败", targetAvailable
      ? reconnectError ? "连接命令未正常返回，但系统已确认目标设备重新出现" : "只重建本次蓝牙声音链路，不把该动作记录为根因修复"
      : reconnectFailureDetail(reconnectError));
    const routesRestored = await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
    const finalRecovery = targetAvailable && routesRestored ? await verifyStableRecovery(name, runtime, reportProgress) : null;
    const finalRate = finalRecovery?.rate ?? currentOutputRate(runtime, name);
    if (finalRecovery !== null) return result("完全恢复", diagnosis, recoveryPath, { sampleRate: finalRate });
    const message = !targetAvailable
      ? `${name} 当前仍断开，需要手动重新连接；已恢复其他仍可用的点击前声音设备。`
      : !routesRestored
        ? `${name} 已重新出现，但点击前输入输出没有全部恢复，本轮不报告完全恢复。`
        : reconnectError
          ? `${name} 的连接操作未正常返回，且目标设备仍未稳定退出 HFP/HSP。`
          : baseMessage("未恢复", name, finalRate);
    return result("未恢复", diagnosis, recoveryPath, { sampleRate: finalRate, message });
  };

  reportProgress({ stage: "正在定位原因", message: "正在依次检查多端点与 tsco、实体麦克风占用、链路残留和其他证据。" });
  let matched: { cause: CauseMatch; users: MicrophoneUser[] } | null = null;
  if (!state.initialOccupancyChecked) {
    state.initialOccupancyChecked = true;
    const users = await readCurrentUsers(true);
    prefetchedUsersForReview = users;
  }

  while (true) {
    if (!matched) matched = await matchCurrentCause();
    if (!matched) return reconnectAndFinish(lastDiagnosis, "声音链路重建兜底");
    const { cause, users } = matched;
    matched = null;
    lastDiagnosis = cause.diagnosis;

    if (cause.diagnosis.kind === "多端点会话类") {
      if (cause.routeChoices.length === 0) return result("未恢复", cause.diagnosis, "多端点路由组合");
      return result("等待选择", cause.diagnosis, "多端点路由组合", {
        actionRequired: {
          kind: "route-choice",
          prompt: `${cause.diagnosis.summary}。请选择希望保留输入还是输出。`,
          choices: cause.routeChoices,
        },
      });
    }

    if ((cause.diagnosis.kind === "麦克风占用类" || cause.diagnosis.kind === "格式请求类") && cause.processes.length > 0) {
      const processCause = cause.diagnosis.kind;
      const terminalProcesses = cause.processes.filter((processInfo) => state.processAttempts.some((attempt) =>
        attempt.cause === processCause && attempt.command === processInfo.command && attempt.authorizedAttempted
      ));
      if (terminalProcesses.length > 0) {
        addStep(name, steps, "防止重复处理", "失败", `已授权后仍再次触发：${terminalProcesses.map(processDescription).join("、")}`);
        return result("未恢复", cause.diagnosis, "原因对应处理", {
          message: `已在本次开机期间阻止${unique(terminalProcesses.map((item) => item.name)).join("、")}自动拉起，但它仍再次触发问题，本轮已停止。`,
        });
      }
      const repeatedProcesses = cause.processes.filter((processInfo) => state.processAttempts.some((attempt) =>
        attempt.cause === processCause && attempt.command === processInfo.command && attempt.automaticAttempted && !attempt.authorizedAttempted
      ));
      if (repeatedProcesses.length > 0) {
        const pendingGuards = [...new Map(repeatedProcesses.map((processInfo) => [processInfo.command, {
          cause: processCause,
          command: processInfo.command,
          processName: processInfo.name,
          microphoneDeviceName: processCause === "麦克风占用类"
            ? users.find((user) => user.pid === processInfo.pid)?.confirmedDeviceNames?.[0]
            : undefined,
        }] as const)).values()];
        const processNames = unique(pendingGuards.map((guard) => guard.processName));
        const neverExited = repeatedProcesses.some((processInfo) => state.processAttempts.some((attempt) =>
          attempt.cause === processCause &&
          attempt.command === processInfo.command &&
          attempt.automaticExitConfirmed !== true &&
          attempt.automaticProcessPid === processInfo.pid &&
          attempt.automaticProcessStartedAt === processInfo.startedAt
        ));
        const trigger = processCause === "格式请求类"
          ? neverExited ? "未能退出且仍在触发声音格式请求" : "退出后再次触发声音格式请求"
          : neverExited ? "未能退出且仍在读取麦克风" : "退出后再次读取麦克风";
        addStep(name, steps, "检测持续或再次触发", "失败", `${trigger}：${repeatedProcesses.map(processDescription).join("、")}`);
        return result("等待授权", cause.diagnosis, "原因对应处理", {
          actionRequired: {
            kind: "relaunch-authorization",
            cause: processCause,
            triggerState: neverExited ? "still-running" : "restarted",
            prompt: `以下进程${trigger}：${processNames.join("、")}。${neverExited
              ? "是否授权工具仅在本次开机期间持续阻止它运行并继续处理？"
              : "是否授权工具仅在本次开机期间阻止它自动拉起并继续处理？"}不会修改登录项、删除应用或改变下次开机配置。`,
            processNames,
          },
          continuationGuards: pendingGuards,
        });
      }
      const freshProcesses = cause.processes.filter((processInfo) => !state.processAttempts.some((attempt) =>
        attempt.cause === processCause && attempt.command === processInfo.command
      ));
      if (freshProcesses.length === 0) continue;
      for (const processInfo of freshProcesses) {
        const microphoneDeviceName = processCause === "麦克风占用类"
          ? users.find((user) => user.pid === processInfo.pid)?.confirmedDeviceNames?.[0]
          : undefined;
        state.processAttempts.push({
          cause: processCause,
          command: processInfo.command,
          processName: processInfo.name,
          microphoneDeviceName,
          automaticProcessPid: processInfo.pid,
          automaticProcessStartedAt: processInfo.startedAt,
          automaticAttempted: true,
          automaticExitConfirmed: false,
          authorizedAttempted: false,
        });
      }
      const bluetoothInputWasUsed = processCause === "麦克风占用类" && usersIncludeBluetoothInput(users);
      const actionStartedAt = runtime.now();
      const action = await executeProcessAction(name, freshProcesses, steps, runtime, reportProgress);
      for (const processInfo of freshProcesses) {
        const attempt = state.processAttempts.find((item) =>
          item.cause === processCause && item.command === processInfo.command
        );
        if (attempt) {
          attempt.automaticExitConfirmed = action.released.some((released) => released.command === processInfo.command);
        }
      }
      state.releasedPrograms.push(...action.released.map((processInfo) => processInfo.name));
      state.remainingPrograms = state.remainingPrograms
        .filter((program) => !action.released.some((processInfo) => processInfo.name === program));
      state.remainingPrograms.push(...action.remaining.map((processInfo) => processInfo.name));
      if (bluetoothInputWasUsed) state.releasedBluetoothInputPrograms.push(...action.released.map((processInfo) => processInfo.name));
      if (action.stableRecovery !== null) {
        return result("完全恢复", cause.diagnosis, "原因对应处理", { sampleRate: action.stableRecovery.rate });
      }
      state.evidenceSinceMs = actionStartedAt;
      continue;
    }

    if (cause.diagnosis.kind === "链路残留类") {
      if (state.linkResidualAttempted) return reconnectAndFinish(cause.diagnosis, "原因对应处理");
      state.linkResidualAttempted = true;
      const actionStartedAt = runtime.now();
      const recovery = await performInputReset("链路残留处理");
      if (recovery !== null) return result("完全恢复", cause.diagnosis, "原因对应处理", { sampleRate: recovery.rate });
      state.evidenceSinceMs = actionStartedAt;
      continue;
    }

    if (!state.fallbackInputAttempted) {
      state.fallbackInputAttempted = true;
      const recovery = await performInputReset("声音链路重建兜底");
      if (recovery !== null) return result("完全恢复", cause.diagnosis, "声音链路重建兜底", { sampleRate: recovery.rate });
    }
    return reconnectAndFinish(cause.diagnosis, "声音链路重建兜底");
  }
}
