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
  RecoveryRouteChoice,
  RecoveryStep,
} from "./types.ts";

const protectedProcessNames = new Set([
  "audioaccessoryd",
  "audiomxd",
  "bluetoothd",
  "coreaudiod",
  "kernel_task",
  "launchd",
]);

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
  setDefaultDevice: setDefaultAudioDevice,
  reconnectDevice: reconnectBluetoothDevice,
};

type CauseMatch = {
  diagnosis: RecoveryDiagnosis;
  processes: RunningProcess[];
  routeChoices: RecoveryRouteChoice[];
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

function currentModeAssessment(
  runtime: RecoveryRuntime,
  request: RecoveryRequest,
): AudioModeAssessment | null {
  return runtime.readModeAssessment(request.name) ?? request.context?.targetAssessment ?? null;
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

function diagnoseCause(
  name: string,
  devices: RawAudioDevice[],
  users: MicrophoneUser[],
  evidence: FormatRequestEvidence | null,
  runtime: RecoveryRuntime,
): CauseMatch {
  if (users.length > 0) {
    const identified = identifyProcesses(users, runtime);
    const confirmed = identified.processes.length > 0 && identified.missing.length === 0;
    return {
      diagnosis: {
        kind: selectCauseRoute(confirmed, false, false),
        confidence: confirmed ? "已确认" : "高度疑似",
        summary: confirmed
          ? "本机程序正在实际读取当前麦克风，先按固定优先级尝试解除占用"
          : "检测到麦克风读取者，但无法完整复核进程身份",
        evidence: users.map((user) => `${user.name}（进程号 ${user.pid}）正在读取：${user.devices.join("、") || "未知麦克风"}`),
      },
      processes: identified.processes,
      routeChoices: [],
    };
  }

  const target = targetOutput(devices, name);
  const targetAssessment = runtime.readModeAssessment(name);
  const input = devices.find((device) => device.isDefaultInput && device.inputChannels > 0);
  const output = devices.find((device) => device.isDefaultOutput && device.outputChannels > 0);
  const targetRate = actualOutputRate(target);
  if (targetAssessment?.mode === "HFP_HSP" && targetAssessment.isDefaultOutput &&
      target?.isDefaultOutput && targetRate !== null && targetRate <= 16_000 &&
      input && output && isBluetooth(input) && isBluetooth(output) && input.name !== output.name) {
    return {
      diagnosis: {
        kind: "多端点会话类",
        confidence: "已确认",
        summary: "当前输入和输出来自两台不同的蓝牙设备，目标输出仍处于 HFP",
        evidence: [
          `当前输入：${input.name}`,
          `当前输出：${output.name}`,
          `目标输出：${targetRate / 1_000} kHz`,
        ],
      },
      processes: [],
      routeChoices: createMultiEndpointRouteChoices(devices, name),
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
    };
  }

  const lowRateBluetoothOutputNames = devices
    .filter((device) =>
      device.isDefaultOutput && device.outputChannels > 0 && isBluetooth(device) &&
      actualOutputRate(device) !== null && (actualOutputRate(device) ?? 0) <= 16_000
    )
    .map((device) => device.name);
  const format = diagnoseFormatRequestCause(evidence, name, lowRateBluetoothOutputNames, runtime.readProcess);
  const kind = selectCauseRoute(false, false, format.confidence === "已确认");
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
    lastRate = currentOutputRate(runtime, name);
    const assessment = runtime.readModeAssessment(name);
    lastMode = assessment?.mode ?? null;
    const target = targetOutput(runtime.readDevices(), name);
    const isDefaultOutput = assessment?.isDefaultOutput === true || target?.isDefaultOutput === true;
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
      ? `${name} 已稳定恢复到 ${rate / 1_000} kHz，且已恢复点击前输入输出。`
      : `${name} 已稳定退出 HFP/HSP，且已恢复点击前输入输出。`;
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
  const steps: RecoveryStep[] = [];
  reportProgress({ stage: "正在保存现场", message: "正在保存点击时的输入、输出、采样率和麦克风占用。" });
  const devices = runtime.readDevices();
  const target = targetOutput(devices, name);
  const targetAssessment = currentModeAssessment(runtime, request);
  const originalInput = request.context?.defaultInput ?? currentDefaultName(devices, "input");
  const originalOutput = request.context?.defaultOutput ?? currentDefaultName(devices, "output");
  const initialRate = actualOutputRate(target) ?? request.context?.targetSampleRate ?? null;
  addStep(name, steps, "保存现场", "成功", `点击时间：${request.context?.clickedAt ?? new Date(runtime.now()).toISOString()}；输入：${originalInput ?? "未知"}；输出：${originalOutput ?? "未知"}；目标采样率：${initialRate ?? "未知"}`);

  const targetRate = actualOutputRate(target);
  if (targetAssessment?.mode !== "HFP_HSP") {
    const rate = targetRate;
    const alreadyRecovered = targetAssessment !== null && targetAssessment?.mode !== "HFP_HSP";
    const skippedRouteChoice = alreadyRecovered && request._confirmedRouteChoice !== undefined;
    const summary = skippedRouteChoice
      ? "目标已自行恢复，本次未执行输入输出切换"
      : alreadyRecovered
        ? "目标现场已经退出 HFP/HSP"
        : "没有可用的最新模式判定，无法确认目标仍处于 HFP/HSP";
    const diagnosis: RecoveryDiagnosis = {
      kind: "证据不足",
      confidence: alreadyRecovered ? "已确认" : "无法确认",
      summary,
      evidence: [
        `当前默认输入：${originalInput ?? "未知"}`,
        `当前默认输出：${originalOutput ?? "未知"}`,
        `最新模式判定：${targetAssessment?.mode ?? "UNKNOWN"}`,
        `该设备系统输出端点：${rate === null ? "未知" : `${rate / 1_000} kHz`}${target?.isDefaultOutput ? "（当前输出）" : "（当前未播放）"}`,
        `该设备可用最高输出采样率：${maxAvailableOutputRate(target) > 0 ? `${maxAvailableOutputRate(target) / 1_000} kHz` : "未知"}`,
      ],
    };
    addStep(name, steps, "复核目标", "成功", diagnosis.summary, rate);
    const outcome = "无需修复";
    const message = skippedRouteChoice
          ? `${name} 已在执行前自行恢复，本次没有修改系统默认输入输出。`
          : alreadyRecovered
            ? baseMessage(outcome, name, rate)
            : `${name} 当前缺少可用的最新模式判定，本次未执行修复动作。`;
    return makeResult({
      outcome,
      recoveryPath: "现场复核",
      handledCause: false,
      sampleRate: rate,
      releasedPrograms: [],
      remainingPrograms: [],
      diagnosis,
      steps,
      usedReconnect: false,
      message,
    });
  }

  if (request._confirmedRouteChoice) {
    const { choice, diagnosis } = request._confirmedRouteChoice;
    reportProgress({ stage: "正在执行处理", message: `正在应用已确认组合：${choice.label}` });
    runtime.setDefaultDevice(choice.direction, choice.deviceName);
    const changed = await waitForRoute(choice.direction, choice.deviceName, runtime);
    const stable = changed && await verifyStableRouteChoice(choice, runtime);
    addStep(name, steps, "应用多端点替代组合", stable ? "成功" : "失败", choice.label);
    const outcome = stable ? "绕过成功" : "未恢复";
    return makeResult({
      outcome,
      recoveryPath: "多端点路由组合",
      handledCause: stable,
      sampleRate: currentOutputRate(runtime, name),
      releasedPrograms: [],
      remainingPrograms: [],
      diagnosis,
      steps,
      usedReconnect: false,
      message: baseMessage(outcome, name, currentOutputRate(runtime, name)),
    });
  }

  reportProgress({
    stage: "正在定位原因",
    message: "正在先检查并尝试解除麦克风占用，再检查当前多端点组合和格式请求。",
  });
  let users: MicrophoneUser[];
  try {
    users = await currentMicrophoneUsers(request, runtime);
  } catch (error) {
    users = [];
    addStep(name, steps, "补充麦克风占用检查", "失败", error instanceof Error ? error.message : String(error));
  }
  let cause = diagnoseCause(name, devices, users, null, runtime);
  if (users.length === 0 && cause.diagnosis.kind !== "多端点会话类") {
    cause = diagnoseCause(name, devices, users, runtime.readEvidence(), runtime);
  }
  addStep(name, steps, "原因定位", cause.diagnosis.confidence === "已确认" ? "成功" : "失败", `${cause.diagnosis.kind}：${cause.diagnosis.summary}`);

  if (cause.diagnosis.kind === "多端点会话类") {
    const choice = cause.routeChoices.find((item) => item.id === request.routeChoiceId);
    if (!choice) {
      const outcome = cause.routeChoices.length > 0 ? "等待选择" : "未恢复";
      return makeResult({
        outcome,
        recoveryPath: "多端点路由组合",
        handledCause: false,
        sampleRate: currentOutputRate(runtime, name),
        releasedPrograms: [],
        remainingPrograms: [],
        diagnosis: cause.diagnosis,
        steps,
        usedReconnect: false,
        actionRequired: cause.routeChoices.length > 0 ? {
          kind: "route-choice",
          prompt: `${cause.diagnosis.summary}。是否授权工具保留输入或保留输出？`,
          choices: cause.routeChoices,
        } : undefined,
        message: baseMessage(outcome, name, currentOutputRate(runtime, name)),
      });
    }
    reportProgress({ stage: "正在执行处理", message: `正在应用组合：${choice.label}` });
    runtime.setDefaultDevice(choice.direction, choice.deviceName);
    const changed = await waitForRoute(choice.direction, choice.deviceName, runtime);
    const stable = changed && await verifyStableRouteChoice(choice, runtime);
    addStep(name, steps, "应用多端点替代组合", stable ? "成功" : "失败", choice.label);
    const outcome = stable ? "绕过成功" : "未恢复";
    return makeResult({
      outcome,
      recoveryPath: "多端点路由组合",
      handledCause: stable,
      sampleRate: currentOutputRate(runtime, name),
      releasedPrograms: [],
      remainingPrograms: [],
      diagnosis: cause.diagnosis,
      steps,
      usedReconnect: false,
      message: baseMessage(outcome, name, currentOutputRate(runtime, name)),
    });
  }

  const releasedPrograms: string[] = [];
  const remainingPrograms: string[] = [];
  let handledCause = false;
  let guardCommand: string | null = null;
  let guardProcessName: string | null = null;
  let usedReconnect = false;
  let recoveryPath: A2dpRecoveryResult["recoveryPath"] = "原因对应处理";

  if ((cause.diagnosis.kind === "麦克风占用类" || cause.diagnosis.kind === "格式请求类") && cause.processes.length > 0) {
    handledCause = true;
    const actionStartedAt = runtime.now();
    const action = await executeProcessAction(name, cause.processes, steps, runtime, reportProgress);
    releasedPrograms.push(...action.released.map((processInfo) => processInfo.name));
    remainingPrograms.push(...action.remaining.map((processInfo) => processInfo.name));
    if (request.authorizeRelaunchBlock && action.released.length > 0) {
      guardCommand = action.released[0].command;
      guardProcessName = action.released[0].name;
    }
    if (action.stableRecovery !== null) {
      const routesRestored = await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
      const restoredRecovery = routesRestored ? await verifyStableRecovery(name, runtime, reportProgress, 3) : null;
      const restoredRate = restoredRecovery?.rate ?? null;
      const outcome = restoredRecovery !== null ? "完全恢复" : routesRestored ? "原组合复发" : "未恢复";
      return makeResult({
        outcome,
        recoveryPath,
        handledCause,
        sampleRate: restoredRate ?? currentOutputRate(runtime, name),
        releasedPrograms,
        remainingPrograms,
        diagnosis: cause.diagnosis,
        steps,
        usedReconnect,
        message: baseMessage(outcome, name, restoredRate),
        _relaunchGuard: guardCommand && guardProcessName ? { command: guardCommand, processName: guardProcessName } : undefined,
      });
    }

    let freshUsers: MicrophoneUser[] = [];
    try {
      freshUsers = await runtime.readMicrophoneUsers();
    } catch (error) {
      addStep(name, steps, "重新判定现场", "失败", error instanceof Error ? error.message : String(error));
    }
    const freshDevices = runtime.readDevices();
    let freshCause = diagnoseCause(name, freshDevices, freshUsers, null, runtime);
    if (freshUsers.length === 0 && freshCause.diagnosis.kind !== "多端点会话类") {
      freshCause = diagnoseCause(name, freshDevices, freshUsers, runtime.readEvidenceSince(actionStartedAt), runtime);
    }
    if (freshCause.diagnosis.kind === "多端点会话类") {
      addStep(name, steps, "重新判定现场", "成功", `${freshCause.diagnosis.kind}：${freshCause.diagnosis.summary}`);
      const outcome = freshCause.routeChoices.length > 0 ? "等待选择" : "未恢复";
      return makeResult({
        outcome,
        recoveryPath: "多端点路由组合",
        handledCause,
        sampleRate: currentOutputRate(runtime, name),
        releasedPrograms,
        remainingPrograms,
        diagnosis: freshCause.diagnosis,
        steps,
        usedReconnect,
        actionRequired: freshCause.routeChoices.length > 0 ? {
          kind: "route-choice",
          prompt: `${freshCause.diagnosis.summary}。是否授权工具保留输入或保留输出？`,
          choices: freshCause.routeChoices,
        } : undefined,
        message: baseMessage(outcome, name, currentOutputRate(runtime, name)),
      });
    }
    const originalCommands = new Set(cause.processes.map((processInfo) => processInfo.command));
    const repeatedProcesses = freshCause.processes.filter((processInfo) => originalCommands.has(processInfo.command));
    if (freshCause.diagnosis.confidence === "已确认" && repeatedProcesses.length > 0) {
      const repeatedProcessNames = [...new Set(repeatedProcesses.map((processInfo) => processInfo.name))];
      if (!request.authorizeRelaunchBlock) {
        addStep(name, steps, "检测持续或再次占用", "失败", `进程未退出或再次触发：${repeatedProcesses.map(processDescription).join("、")}`);
        const outcome = "等待授权";
        return makeResult({
          outcome,
          recoveryPath,
          handledCause,
          sampleRate: currentOutputRate(runtime, name),
          releasedPrograms,
          remainingPrograms,
          diagnosis: freshCause.diagnosis,
          steps,
          usedReconnect,
          actionRequired: {
            kind: "relaunch-authorization",
            prompt: `以下进程未退出或再次触发麦克风占用：${repeatedProcessNames.join("、")}。是否授权工具继续处理，并仅在本次开机期间阻止它重新启动？不会修改登录项、删除应用或改变下次开机配置。`,
            processNames: repeatedProcessNames,
          },
          message: baseMessage(outcome, name, currentOutputRate(runtime, name)),
        });
      }
      const repeatedAction = await executeProcessAction(name, repeatedProcesses, steps, runtime, reportProgress);
      releasedPrograms.push(...repeatedAction.released.map((processInfo) => processInfo.name));
      remainingPrograms.push(...repeatedAction.remaining.map((processInfo) => processInfo.name));
      if (repeatedAction.released.length > 0) guardCommand = repeatedAction.released[0].command;
      if (repeatedAction.released.length > 0) guardProcessName = repeatedAction.released[0].name;
      if (repeatedAction.stableRecovery !== null) {
        const routesRestored = await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
        const restoredRecovery = routesRestored ? await verifyStableRecovery(name, runtime, reportProgress, 3) : null;
        const restoredRate = restoredRecovery?.rate ?? null;
        const outcome = restoredRecovery !== null ? "完全恢复" : routesRestored ? "原组合复发" : "未恢复";
        return makeResult({
          outcome,
          recoveryPath,
          handledCause,
          sampleRate: restoredRate ?? currentOutputRate(runtime, name),
          releasedPrograms,
          remainingPrograms,
          diagnosis: freshCause.diagnosis,
          steps,
          usedReconnect,
          message: baseMessage(outcome, name, restoredRate),
          _relaunchGuard: guardCommand && guardProcessName ? { command: guardCommand, processName: guardProcessName } : undefined,
        });
      }
    } else if (freshCause.diagnosis.confidence === "已确认" && freshCause.diagnosis.kind !== "多端点会话类" && freshCause.processes.length > 0) {
      cause = freshCause;
      const secondAction = await executeProcessAction(name, cause.processes, steps, runtime, reportProgress);
      releasedPrograms.push(...secondAction.released.map((processInfo) => processInfo.name));
      remainingPrograms.push(...secondAction.remaining.map((processInfo) => processInfo.name));
      if (secondAction.stableRecovery !== null) {
        const routesRestored = await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
        const restoredRecovery = routesRestored ? await verifyStableRecovery(name, runtime, reportProgress, 3) : null;
        const restoredRate = restoredRecovery?.rate ?? null;
        const outcome = restoredRecovery !== null ? "完全恢复" : routesRestored ? "原组合复发" : "未恢复";
        return makeResult({
          outcome,
          recoveryPath,
          handledCause,
          sampleRate: restoredRate ?? currentOutputRate(runtime, name),
          releasedPrograms,
          remainingPrograms,
          diagnosis: cause.diagnosis,
          steps,
          usedReconnect,
          message: baseMessage(outcome, name, restoredRate),
          _relaunchGuard: guardCommand && guardProcessName ? { command: guardCommand, processName: guardProcessName } : undefined,
        });
      }
    }
  }

  recoveryPath = "声音链路重建兜底";
  reportProgress({ stage: "正在执行处理", message: "没有可继续安全结束的进程，正在重建本次声音链路。" });
  const fallbackInput = runtime.readDevices().find((device) =>
    device.inputChannels > 0 && !isBluetooth(device) && device.name !== originalInput
  );
  if (fallbackInput && originalInput) {
    runtime.setDefaultDevice("input", fallbackInput.name);
    const switched = await waitForRoute("input", fallbackInput.name, runtime);
    addStep(name, steps, "临时切换到非蓝牙输入", switched ? "成功" : "失败", fallbackInput.name);
    if (switched) {
      runtime.setDefaultDevice("input", originalInput);
      const restored = await waitForRoute("input", originalInput, runtime);
      addStep(name, steps, "恢复点击前输入", restored ? "成功" : "失败", originalInput);
      const recovery = restored ? await verifyStableRecovery(name, runtime, reportProgress) : null;
      if (recovery !== null) {
        const routesRestored = await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
        if (routesRestored) {
          const outcome = "完全恢复";
          return makeResult({
            outcome,
            recoveryPath,
            handledCause,
            sampleRate: recovery.rate,
            releasedPrograms,
            remainingPrograms,
            diagnosis: cause.diagnosis,
            steps,
            usedReconnect,
            message: baseMessage(outcome, name, recovery.rate),
            _relaunchGuard: guardCommand && guardProcessName ? { command: guardCommand, processName: guardProcessName } : undefined,
          });
        }
      }
    }
  } else {
    addStep(name, steps, "临时切换到非蓝牙输入", "跳过", "没有可用的非蓝牙中转输入，或点击前输入未知");
  }

  let reconnectError: unknown = null;
  usedReconnect = true;
  try {
    runtime.reconnectDevice(name);
  } catch (error) {
    reconnectError = error;
  }
  const targetAvailable = await waitForDevice(name, "output", runtime);
  addStep(
    name,
    steps,
    "断开并重连目标设备",
    targetAvailable ? "成功" : "失败",
    targetAvailable
      ? reconnectError
        ? "连接命令未正常返回，但系统已确认目标设备重新出现"
        : "只重建本次蓝牙声音链路，不把该动作记录为根因修复"
      : reconnectFailureDetail(reconnectError),
  );
  const routesRestored = await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
  const finalRecovery = targetAvailable && routesRestored
    ? await verifyStableRecovery(name, runtime, reportProgress)
    : null;
  const finalRate = finalRecovery?.rate ?? null;
  const outcome = finalRecovery !== null ? "完全恢复" : "未恢复";
  const message = finalRecovery !== null
    ? baseMessage(outcome, name, finalRate)
    : !targetAvailable
      ? `${name} 当前仍断开，需要手动重新连接；已恢复其他仍可用的点击前声音设备。`
      : !routesRestored
        ? `${name} 已重新出现，但点击前输入输出没有全部恢复，本轮不报告完全恢复。`
        : reconnectError
          ? `${name} 的连接操作未正常返回，且目标输出仍未稳定恢复到高于 16 kHz。`
          : baseMessage(outcome, name, finalRate);
  return makeResult({
    outcome,
    recoveryPath,
    handledCause,
    sampleRate: finalRate ?? currentOutputRate(runtime, name),
    releasedPrograms,
    remainingPrograms,
    diagnosis: cause.diagnosis,
    steps,
    usedReconnect,
    message,
    _relaunchGuard: guardCommand && guardProcessName ? { command: guardCommand, processName: guardProcessName } : undefined,
  });
}
