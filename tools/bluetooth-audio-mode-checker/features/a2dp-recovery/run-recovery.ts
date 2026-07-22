import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { setDefaultAudioDevice } from "../../core/macos-audio-route/index.ts";
import { connectBluetoothDevice } from "../../core/macos-bluetooth-link/index.ts";
import { readBluetoothPower, setBluetoothPower } from "../../core/macos-bluetooth-control/index.ts";
import {
  readRunningProcess,
  runningProcessIdentity,
  terminateAndConfirmRunningProcesses,
  terminateRunningProcess,
  type RunningProcess,
} from "../../core/macos-running-apps/index.ts";
import {
  readServicePid,
  restartService,
  type AudioChainService,
} from "../../core/macos-system-services/index.ts";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import type { AudioModeAssessment, MicrophoneUser, RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import {
  bluetoothPhysicalIdentity,
  isBluetoothTransport,
} from "../../shared/bluetooth-device-identity/index.ts";
import {
  diagnoseFormatRequestCause,
  diagnoseMultiEndpointCause,
  readSystemAudioEvidenceSince,
  type FormatRequestEvidence,
} from "./format-request-diagnosis.ts";
import {
  isA2dpRecoveryEligible,
  orderedRouteCandidates,
  routeDevicePriority,
  routeDevicePriorityLabel,
} from "./recovery-policy.ts";
import type {
  A2dpRecoveryResult,
  RecoveryDiagnosis,
  RecoveryProgress,
  RecoveryMicrophoneReleaseResult,
  RecoveryRequest,
  RecoveryRequestContext,
  RecoveryStep,
} from "./types.ts";

const serviceOrder: AudioChainService[] = [
  "bluetoothd", "bluetoothuserd", "coreaudiod", "audioaccessoryd", "audiomxd",
];
const routeTimeoutMs = 2_000;
const routePollMs = 100;
const linkReleaseTimeoutMs = 500;
const linkPollMs = 50;
const linkHoldMs = 1_000;

export type RecoveryRuntime = {
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
  readDevices: () => RawAudioDevice[];
  releaseBluetoothMicrophoneOccupancy: (deviceName: string) => Promise<RecoveryMicrophoneReleaseResult>;
  readFormatRequestUsers: () => MicrophoneUser[];
  readProcess: (pid: number) => RunningProcess | null;
  terminateProcess: (processInfo: RunningProcess) => void;
  readEvidenceSince: (startedAtMs: number) => FormatRequestEvidence;
  readModeAssessment: (name: string) => AudioModeAssessment | null;
  readModeAssessments?: () => AudioModeAssessment[];
  setDefaultDevice: (direction: "input" | "output", name: string) => void;
  readBluetoothPower: () => boolean;
  setBluetoothPower: (enabled: boolean) => void;
  readServicePid: (service: AudioChainService) => number | null;
  restartService: (service: AudioChainService) => void;
  connectDevice: (name: string) => void;
};

export const systemRuntime: RecoveryRuntime = {
  now: Date.now,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  readDevices: () => readAudioDevices().devices,
  releaseBluetoothMicrophoneOccupancy: async () => ({
    users: [], processes: [], requestedPids: [], releasedPids: [], remainingPids: [], protectedPids: [],
  }),
  readFormatRequestUsers: () => [],
  readProcess: readRunningProcess,
  terminateProcess: terminateRunningProcess,
  readEvidenceSince: readSystemAudioEvidenceSince,
  readModeAssessment: () => null,
  readModeAssessments: () => [],
  setDefaultDevice: setDefaultAudioDevice,
  readBluetoothPower,
  setBluetoothPower,
  readServicePid,
  restartService,
  connectDevice: connectBluetoothDevice,
};

type StableRecovery = { rate: number | null; mode: AudioModeAssessment["mode"] };
type RecoveryState = {
  context: RecoveryRequestContext;
  attemptedProcessIdentities: Set<string>;
  releasedPrograms: string[];
  remainingPrograms: string[];
  steps: RecoveryStep[];
};

function isBluetooth(device: RawAudioDevice): boolean {
  return isBluetoothTransport(device.transport);
}

function currentAssessments(runtime: RecoveryRuntime, request: RecoveryRequest): AudioModeAssessment[] {
  if (runtime.readModeAssessments) return runtime.readModeAssessments();
  const target = runtime.readModeAssessment(request.name);
  return target ? [target] : [];
}

function currentAssessment(runtime: RecoveryRuntime, request: RecoveryRequest): AudioModeAssessment | null {
  return currentAssessments(runtime, request).find((item) => item.name === request.name) ??
    runtime.readModeAssessment(request.name);
}

function currentDefaultName(devices: RawAudioDevice[], direction: "input" | "output"): string | null {
  return devices.find((device) => direction === "input" ? device.isDefaultInput : device.isDefaultOutput)?.name ?? null;
}

function targetOutput(devices: RawAudioDevice[], name: string): RawAudioDevice | null {
  return devices
    .filter((device) => device.name === name && device.outputChannels > 0)
    .sort((left, right) => Number(right.isDefaultOutput) - Number(left.isDefaultOutput))[0] ?? null;
}

function uniqueBluetoothDeviceNames(devices: RawAudioDevice[]): string[] {
  const byPhysicalIdentity = new Map<string, string>();
  for (const device of devices) {
    const identity = bluetoothPhysicalIdentity(device.bluetoothAddress, device.name);
    if (!byPhysicalIdentity.has(identity)) byPhysicalIdentity.set(identity, device.name);
  }
  return [...byPhysicalIdentity.values()];
}

function recoveryEvidenceStart(
  context: RecoveryRequestContext,
  formatRequestUsers: MicrophoneUser[],
  fallback: number,
): number {
  const clickedAt = Date.parse(context.clickedAt);
  const activeRequestTimes = formatRequestUsers
    .filter((user) => user.occupancyEvidenceKinds?.includes("unclosed-format-request"))
    .map((user) => Date.parse(user.unclosedFormatRequestAt ?? ""))
    .filter(Number.isFinite);
  const clickStart = Number.isFinite(clickedAt) ? clickedAt - 2_000 : fallback;
  return Math.min(clickStart, ...activeRequestTimes);
}

function currentObservation(runtime: RecoveryRuntime, request: RecoveryRequest) {
  const assessment = currentAssessment(runtime, request);
  return {
    mode: assessment?.mode ?? null,
    rate: assessment?.actualSampleRateOutput ?? null,
    isDefaultOutput: assessment?.isDefaultOutput ?? false,
  };
}

function addStep(name: string, steps: RecoveryStep[], stage: string, status: RecoveryStep["status"], detail: string): void {
  steps.push({ stage, status, detail });
  detailedLog(status === "失败" ? "warn" : "info", "a2dp-recovery.step", {
    deviceName: name, stage, status, detail,
  });
}

function processDisplayName(processInfo: RunningProcess, cause?: "麦克风占用类" | "格式请求类"): string {
  return cause === "格式请求类" ? `${processInfo.name}（格式请求）` : processInfo.name;
}

function processDescription(processInfo: RunningProcess, cause?: "麦克风占用类" | "格式请求类"): string {
  return `${processDisplayName(processInfo, cause)}（进程号 ${processInfo.pid}）`;
}

async function verifyStableRecovery(
  request: RecoveryRequest,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  attempts = 10,
): Promise<StableRecovery | null> {
  const deadline = runtime.now() + 5_000;
  let consecutive = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const observation = currentObservation(runtime, request);
    const recovered = observation.isDefaultOutput
      ? observation.rate !== null && observation.rate > 16_000 && observation.mode === "A2DP"
      : observation.mode !== null && observation.mode !== "HFP_HSP";
    consecutive = recovered ? consecutive + 1 : 0;
    if (consecutive === 1) {
      reportProgress({ stage: "正在确认稳定", message: "已初步退出通话模式，正在连续确认。" });
    }
    if (consecutive >= 3 && observation.mode !== null) {
      return { rate: observation.rate, mode: observation.mode };
    }
    const remaining = deadline - runtime.now();
    if (attempt >= attempts - 1 || remaining <= 0) break;
    await runtime.wait(Math.min(500, remaining));
  }
  return null;
}

async function waitForRoute(
  direction: "input" | "output",
  name: string,
  runtime: RecoveryRuntime,
): Promise<boolean> {
  const deadline = runtime.now() + routeTimeoutMs;
  while (true) {
    if (currentDefaultName(runtime.readDevices(), direction) === name) return true;
    const remaining = deadline - runtime.now();
    if (remaining <= 0) return false;
    await runtime.wait(Math.min(routePollMs, remaining));
  }
}

async function setAndConfirmRoute(
  direction: "input" | "output",
  name: string,
  runtime: RecoveryRuntime,
): Promise<boolean> {
  try { runtime.setDefaultDevice(direction, name); } catch { return false; }
  return waitForRoute(direction, name, runtime);
}

async function waitForLinkRelease(name: string, runtime: RecoveryRuntime): Promise<boolean> {
  const deadline = runtime.now() + linkReleaseTimeoutMs;
  while (true) {
    if (runtime.readModeAssessment(name)?.audioLinkType === "tacl") return true;
    const remaining = deadline - runtime.now();
    if (remaining <= 0) return false;
    await runtime.wait(Math.min(linkPollMs, remaining));
  }
}

function nonBluetoothCandidates(
  devices: RawAudioDevice[],
  direction: "input" | "output",
  excludedNames: Iterable<string>,
): RawAudioDevice[] {
  return orderedRouteCandidates(devices, direction, excludedNames)
    .filter((device) => routeDevicePriority(device) < 3);
}

async function selectAndSetNonBluetooth(
  direction: "input" | "output",
  excludedNames: Iterable<string>,
  runtime: RecoveryRuntime,
): Promise<RawAudioDevice | null> {
  const attempted = new Set<string>();
  while (true) {
    const candidate = nonBluetoothCandidates(runtime.readDevices(), direction, excludedNames)
      .find((device) => !attempted.has(device.name));
    if (!candidate) return null;
    attempted.add(candidate.name);
    if (await setAndConfirmRoute(direction, candidate.name, runtime)) return candidate;
  }
}

async function restoreRoutes(
  request: RecoveryRequest,
  state: RecoveryState,
  runtime: RecoveryRuntime,
  originalInput: string | null,
  originalOutput: string | null,
): Promise<boolean> {
  const pairs = [["output", originalOutput], ["input", originalInput]] as const;
  let restored = true;
  for (const [direction, expected] of pairs) {
    if (!expected || currentDefaultName(runtime.readDevices(), direction) === expected) continue;
    const channels = direction === "input" ? "inputChannels" : "outputChannels";
    if (!runtime.readDevices().some((device) => device.name === expected && device[channels] > 0)) {
      addStep(request.name, state.steps, "恢复本步骤声音设备", "失败", `${expected} 当前不可用`);
      restored = false;
      continue;
    }
    const confirmed = await setAndConfirmRoute(direction, expected, runtime);
    addStep(request.name, state.steps, "恢复本步骤声音设备", confirmed ? "成功" : "失败", `${direction === "input" ? "输入" : "输出"}：${expected}`);
    restored = restored && confirmed;
  }
  return restored;
}

function processesNotYetAttempted(processes: RunningProcess[], state: RecoveryState): RunningProcess[] {
  const unique = [...new Map(processes.map((item) => [runningProcessIdentity(item), item] as const)).values()];
  return unique.filter((item) => !state.attemptedProcessIdentities.has(runningProcessIdentity(item)));
}

function recordProcessRelease(
  request: RecoveryRequest,
  state: RecoveryState,
  stage: string,
  cause: "麦克风占用类" | "格式请求类" | "多端点会话类",
  release: RecoveryMicrophoneReleaseResult,
): void {
  const released = release.processes.filter((processInfo) => release.releasedPids.includes(processInfo.pid));
  const remaining = release.processes.filter((processInfo) => release.remainingPids.includes(processInfo.pid));
  const protectedProcesses = release.processes.filter((processInfo) => release.protectedPids.includes(processInfo.pid));
  state.releasedPrograms.push(...released.map((item) => item.name));
  state.remainingPrograms.push(...remaining.map((item) => item.name));
  const displayCause = cause === "多端点会话类" ? undefined : cause;
  const details = [
    released.length > 0
      ? `已确认退出：${released.map((item) => processDescription(item, displayCause)).join("、")}`
      : null,
    remaining.length > 0
      ? `仍未退出：${remaining.map((item) => processDescription(item, displayCause)).join("、")}`
      : null,
    protectedProcesses.length > 0
      ? `系统核心进程未处理：${protectedProcesses.map((item) => processDescription(item)).join("、")}`
      : null,
  ].filter((item): item is string => item !== null);
  const status: RecoveryStep["status"] = remaining.length > 0
    ? "失败"
    : released.length > 0 ? "成功" : "跳过";
  addStep(request.name, state.steps, stage, status, details.join("；") || "没有可请求退出的应用进程");
}

async function requestProcessExitOnce(
  request: RecoveryRequest,
  state: RecoveryState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  stage: string,
  cause: "麦克风占用类" | "格式请求类" | "多端点会话类",
  processes: RunningProcess[],
): Promise<RecoveryMicrophoneReleaseResult | null> {
  const candidates = processesNotYetAttempted(processes, state);
  if (candidates.length === 0) {
    addStep(request.name, state.steps, stage, "跳过", "本次修复已经请求该进程身份退出一次");
    return null;
  }
  for (const item of candidates) state.attemptedProcessIdentities.add(runningProcessIdentity(item));
  reportProgress({
    stage: "正在检查占用",
    message: `正在请求${candidates.map((item) => processDisplayName(item, cause === "多端点会话类" ? undefined : cause)).join("、")}正常退出。`,
  });
  const termination = await terminateAndConfirmRunningProcesses(candidates, {
    now: runtime.now,
    readProcess: runtime.readProcess,
    terminateProcess: runtime.terminateProcess,
    wait: runtime.wait,
  });
  const release: RecoveryMicrophoneReleaseResult = { users: [], ...termination };
  recordProcessRelease(request, state, stage, cause, release);
  return release;
}

function result(
  request: RecoveryRequest,
  state: RecoveryState,
  runtime: RecoveryRuntime,
  outcome: A2dpRecoveryResult["outcome"],
  diagnosis: RecoveryDiagnosis,
  rebuiltAudioChain: boolean,
): A2dpRecoveryResult {
  const observation = currentObservation(runtime, request);
  const value: A2dpRecoveryResult = {
    ok: outcome === "无需修复" || outcome === "完全恢复",
    outcome,
    recoveryPath: outcome === "无需修复" ? "现场复核" : "固定处理顺序",
    handledCause: state.releasedPrograms.length > 0,
    sampleRate: observation.rate,
    releasedPrograms: [...new Set(state.releasedPrograms)],
    remainingPrograms: [...new Set(state.remainingPrograms)],
    diagnosis,
    steps: state.steps,
    rebuiltAudioChain,
    message: outcome === "完全恢复"
      ? `${request.name} 已稳定恢复高音质播放。`
      : outcome === "无需修复" ? `${request.name} 当前无需修复。`
      : `${request.name} 完成固定处理顺序后仍未恢复。`,
  };
  detailedLog(value.ok ? "info" : "warn", "a2dp-recovery.completed", { result: value });
  return value;
}

function makeDiagnosis(kind: RecoveryDiagnosis["kind"], summary: string, evidence: string[] = []): RecoveryDiagnosis {
  return { kind, confidence: evidence.length > 0 ? "已确认" : "无法确认", summary, evidence };
}

async function processStep(
  request: RecoveryRequest,
  state: RecoveryState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  cause: "麦克风占用类" | "格式请求类",
  processes: RunningProcess[],
): Promise<StableRecovery | null> {
  if (processes.length === 0) return null;
  const release = await requestProcessExitOnce(
    request,
    state,
    runtime,
    reportProgress,
    `处理${cause}`,
    cause,
    processes,
  );
  return release && release.requestedPids.length > 0
    ? verifyStableRecovery(request, runtime, reportProgress)
    : null;
}

async function runInputReset(
  request: RecoveryRequest,
  state: RecoveryState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  stage: string,
): Promise<StableRecovery | null> {
  const original = currentDefaultName(runtime.readDevices(), "input");
  if (!original) {
    addStep(request.name, state.steps, stage, "跳过", "没有可恢复的默认输入");
    return null;
  }
  reportProgress({ stage: "正在切换声音设备", message: "正在通过非蓝牙输入刷新声音路由。" });
  const candidate = await selectAndSetNonBluetooth("input", [original], runtime);
  if (!candidate) {
    const restored = currentDefaultName(runtime.readDevices(), "input") === original ||
      await setAndConfirmRoute("input", original, runtime);
    addStep(
      request.name,
      state.steps,
      stage,
      restored ? "跳过" : "失败",
      restored ? "没有可用的其他非蓝牙输入，原输入保持或已恢复" : "没有可用中转输入，且原输入恢复失败",
    );
    return null;
  }
  const released = await waitForLinkRelease(request.name, runtime);
  if (released) await runtime.wait(linkHoldMs);
  const restored = await setAndConfirmRoute("input", original, runtime);
  addStep(request.name, state.steps, stage, restored ? "成功" : "失败",
    `${original} → ${candidate.name}（${routeDevicePriorityLabel(candidate)}）→ ${original}；${released ? "观察到 tacl 并保持 1 秒" : "500 毫秒内未观察到 tacl"}`);
  return restored ? verifyStableRecovery(request, runtime, reportProgress) : null;
}

async function runDualRouteReset(
  request: RecoveryRequest,
  state: RecoveryState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
): Promise<StableRecovery | null> {
  const originalInput = currentDefaultName(runtime.readDevices(), "input");
  const originalOutput = currentDefaultName(runtime.readDevices(), "output");
  if (!originalInput || !originalOutput) {
    addStep(request.name, state.steps, "同时切换输入输出", "跳过", "本步骤开始时缺少默认输入或输出");
    return null;
  }
  const inputCandidates = nonBluetoothCandidates(runtime.readDevices(), "input", [originalInput]);
  const outputCandidates = nonBluetoothCandidates(runtime.readDevices(), "output", [originalOutput]);
  if (inputCandidates.length === 0 || outputCandidates.length === 0) {
    addStep(request.name, state.steps, "同时切换输入输出", "跳过", "没有完整的非蓝牙输入输出候选");
    return null;
  }
  reportProgress({ stage: "正在切换声音设备", message: "正在同时刷新默认输入和输出。" });
  const input = await selectAndSetNonBluetooth("input", [originalInput], runtime);
  const output = input ? await selectAndSetNonBluetooth("output", [originalOutput], runtime) : null;
  if (!input || !output) {
    await restoreRoutes(request, state, runtime, originalInput, originalOutput);
    addStep(request.name, state.steps, "同时切换输入输出", "失败", "中转路由未能完整建立，已恢复本步骤原路由");
    return null;
  }
  const outputRestored = await setAndConfirmRoute("output", originalOutput, runtime);
  const released = await waitForLinkRelease(request.name, runtime);
  if (released) await runtime.wait(linkHoldMs);
  const inputRestored = await setAndConfirmRoute("input", originalInput, runtime);
  const restored = outputRestored && inputRestored;
  addStep(request.name, state.steps, "同时切换输入输出", restored ? "成功" : "失败",
    `输入 ${originalInput} → ${input.name} → ${originalInput}；输出 ${originalOutput} → ${output.name} → ${originalOutput}`);
  return restored ? verifyStableRecovery(request, runtime, reportProgress) : null;
}

async function waitForBluetoothPower(expected: boolean, runtime: RecoveryRuntime): Promise<boolean> {
  const deadline = runtime.now() + 5_000;
  while (true) {
    try { if (runtime.readBluetoothPower() === expected) return true; } catch { /* continue */ }
    const remaining = deadline - runtime.now();
    if (remaining <= 0) return false;
    await runtime.wait(Math.min(100, remaining));
  }
}

async function waitForNewServicePid(
  service: AudioChainService,
  previousPid: number | null,
  runtime: RecoveryRuntime,
): Promise<number | null> {
  const deadline = runtime.now() + 5_000;
  while (true) {
    const current = runtime.readServicePid(service);
    if (current !== null && current !== previousPid) return current;
    const remaining = deadline - runtime.now();
    if (remaining <= 0) return null;
    await runtime.wait(Math.min(100, remaining));
  }
}

async function waitForTargetEndpoint(name: string, runtime: RecoveryRuntime): Promise<boolean> {
  const deadline = runtime.now() + 3_000;
  while (true) {
    if (runtime.readDevices().some((device) => device.name === name && (device.inputChannels > 0 || device.outputChannels > 0))) return true;
    const remaining = deadline - runtime.now();
    if (remaining <= 0) return false;
    await runtime.wait(Math.min(100, remaining));
  }
}

async function rebuildAudioChain(
  request: RecoveryRequest,
  state: RecoveryState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
): Promise<StableRecovery | null> {
  const devicesBeforeRebuild = runtime.readDevices();
  const originalInput = currentDefaultName(devicesBeforeRebuild, "input");
  const originalOutput = currentDefaultName(devicesBeforeRebuild, "output");
  reportProgress({ stage: "正在重建声音链路", message: "正在关闭蓝牙并按固定顺序刷新系统声音服务。" });
  try {
    runtime.setBluetoothPower(false);
    const off = await waitForBluetoothPower(false, runtime);
    addStep(request.name, state.steps, "关闭蓝牙", off ? "成功" : "失败", off ? "蓝牙已关闭" : "5 秒内未确认蓝牙关闭");
  } catch (error) {
    addStep(request.name, state.steps, "关闭蓝牙", "失败", error instanceof Error ? error.message : String(error));
  }

  for (const service of serviceOrder) {
    const previousPid = runtime.readServicePid(service);
    try {
      runtime.restartService(service);
      const currentPid = await waitForNewServicePid(service, previousPid, runtime);
      addStep(request.name, state.steps, `重启 ${service}`, currentPid === null ? "失败" : "成功",
        currentPid === null ? "5 秒内未确认新进程" : `进程号 ${previousPid ?? "未知"} → ${currentPid}`);
    } catch (error) {
      addStep(request.name, state.steps, `重启 ${service}`, "失败", error instanceof Error ? error.message : String(error));
    }
  }

  try {
    runtime.setBluetoothPower(true);
    const on = await waitForBluetoothPower(true, runtime);
    addStep(request.name, state.steps, "打开蓝牙", on ? "成功" : "失败", on ? "蓝牙已打开" : "5 秒内未确认蓝牙打开");
  } catch (error) {
    addStep(request.name, state.steps, "打开蓝牙", "失败", error instanceof Error ? error.message : String(error));
  }

  let appeared = await waitForTargetEndpoint(request.name, runtime);
  if (appeared) {
    addStep(request.name, state.steps, "连接目标设备", "跳过", "目标已自动连接，不执行断开重连");
  } else {
    try {
      runtime.connectDevice(request.name);
      appeared = await waitForTargetEndpoint(request.name, runtime);
      addStep(request.name, state.steps, "连接目标设备", appeared ? "成功" : "失败", appeared ? "目标端点已出现" : "连接后 3 秒内目标端点未出现");
    } catch (error) {
      addStep(request.name, state.steps, "连接目标设备", "失败", error instanceof Error ? error.message : String(error));
    }
  }
  const restored = await restoreRoutes(request, state, runtime, originalInput, originalOutput);
  return restored && appeared ? verifyStableRecovery(request, runtime, reportProgress) : null;
}

export async function runRecovery(
  request: RecoveryRequest,
  runtime: RecoveryRuntime = systemRuntime,
  reportProgress: (progress: RecoveryProgress) => void = () => {},
): Promise<A2dpRecoveryResult> {
  const assessment = currentAssessment(runtime, request);
  const context = request.context ?? {
    clickedAt: new Date(runtime.now()).toISOString(),
  };
  const state: RecoveryState = {
    context,
    attemptedProcessIdentities: new Set(),
    releasedPrograms: [],
    remainingPrograms: [],
    steps: [],
  };
  request = { ...request, context };

  if (!isA2dpRecoveryEligible(assessment)) {
    const diagnosis = makeDiagnosis("证据不足", assessment?.a2dpSupport === "UNSUPPORTED" ? "目标不支持 A2DP" : "目标当前不在 HFP/HSP");
    return result(request, state, runtime, "无需修复", diagnosis, false);
  }

  const finishIfAlreadyRecovered = async (): Promise<A2dpRecoveryResult | null> => {
    const current = currentAssessment(runtime, request);
    if (current?.mode === "HFP_HSP") return null;
    if (!current) {
      return result(request, state, runtime, "未恢复", makeDiagnosis("证据不足", "执行下一动作前目标设备已不可用"), false);
    }
    const stable = await verifyStableRecovery(request, runtime, reportProgress, 3);
    return stable
      ? result(request, state, runtime, "完全恢复", makeDiagnosis("证据不足", "执行下一动作前目标已自行稳定恢复"), false)
      : result(request, state, runtime, "未恢复", makeDiagnosis("证据不足", "目标已不在 HFP/HSP，但未满足稳定恢复条件"), false);
  };

  let alreadyRecovered = await finishIfAlreadyRecovered();
  if (alreadyRecovered) return alreadyRecovered;
  reportProgress({ stage: "正在检查占用", message: "正在检查实时蓝牙麦克风占用。" });
  let microphoneRelease: RecoveryMicrophoneReleaseResult | null = null;
  try {
    microphoneRelease = await runtime.releaseBluetoothMicrophoneOccupancy(request.name);
  } catch (error) {
    addStep(request.name, state.steps, "检查实时蓝牙麦克风占用", "失败", error instanceof Error ? error.message : String(error));
  }
  if (microphoneRelease && microphoneRelease.processes.length === 0) {
    addStep(request.name, state.steps, "检查实时蓝牙麦克风占用", "跳过", "没有已确认占用进程");
  } else if (microphoneRelease) {
    for (const processInfo of microphoneRelease.processes) {
      state.attemptedProcessIdentities.add(runningProcessIdentity(processInfo));
    }
    recordProcessRelease(request, state, "处理麦克风占用类", "麦克风占用类", microphoneRelease);
    const stableAfterRelease = microphoneRelease.requestedPids.length > 0
      ? await verifyStableRecovery(request, runtime, reportProgress)
      : null;
    if (stableAfterRelease) {
      return result(request, state, runtime, "完全恢复", makeDiagnosis(
        "麦克风占用类",
        "结束占用进程后稳定恢复",
        microphoneRelease.processes.map((item) => processDescription(item)),
      ), false);
    }
  }

  alreadyRecovered = await finishIfAlreadyRecovered();
  if (alreadyRecovered) return alreadyRecovered;
  let stable = await runInputReset(request, state, runtime, reportProgress, "只切换默认输入");
  if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("声音链路类", "输入路由复位后稳定恢复"), false);

  alreadyRecovered = await finishIfAlreadyRecovered();
  if (alreadyRecovered) return alreadyRecovered;
  stable = await runDualRouteReset(request, state, runtime, reportProgress);
  if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("声音链路类", "输入输出路由复位后稳定恢复"), false);

  alreadyRecovered = await finishIfAlreadyRecovered();
  if (alreadyRecovered) return alreadyRecovered;
  reportProgress({ stage: "正在检查占用", message: "正在检查仍有效的格式请求。" });
  const formatEvidenceStart = recoveryEvidenceStart(context, runtime.readFormatRequestUsers(), runtime.now());
  const formatEvidence = runtime.readEvidenceSince(formatEvidenceStart);
  const devices = runtime.readDevices();
  const lowRateBluetoothNames = uniqueBluetoothDeviceNames(devices.filter((device) =>
    isBluetooth(device) && device.outputChannels > 0 && (device.actualSampleRateOutput ?? device.sampleRateOutput ?? Infinity) <= 16_000
  ));
  const formatCause = diagnoseFormatRequestCause(formatEvidence, request.name, lowRateBluetoothNames, runtime.readProcess);
  if (formatCause.confidence === "已确认" && formatCause.requester) {
    stable = await processStep(request, state, runtime, reportProgress, "格式请求类", [formatCause.requester]);
    if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("格式请求类", "结束格式请求进程后稳定恢复", [processDescription(formatCause.requester, "格式请求类")]), false);
  } else {
    addStep(request.name, state.steps, "检查格式请求", formatCause.confidence === "高度疑似" ? "失败" : "跳过", formatCause.gaps.join("；"));
  }

  alreadyRecovered = await finishIfAlreadyRecovered();
  if (alreadyRecovered) return alreadyRecovered;
  const currentDevices = runtime.readDevices();
  const input = currentDevices.find((device) => device.isDefaultInput && device.inputChannels > 0);
  const output = currentDevices.find((device) => device.isDefaultOutput && device.outputChannels > 0);
  if (input && output && isBluetooth(input) && isBluetooth(output) && input.name !== output.name) {
    const target = targetOutput(currentDevices, request.name);
    if (target) {
      const clickedAt = Date.parse(context.clickedAt);
      const multiEndpointEvidence = runtime.readEvidenceSince(Number.isFinite(clickedAt) ? clickedAt - 2_000 : runtime.now());
      const cause = diagnoseMultiEndpointCause(multiEndpointEvidence, target, runtime.readProcess);
      if (cause.confidence === "已确认" && cause.requester) {
        await requestProcessExitOnce(
          request,
          state,
          runtime,
          reportProgress,
          "处理多蓝牙拒绝进程",
          "多端点会话类",
          [cause.requester],
        );
      } else {
        addStep(request.name, state.steps, "检查多蓝牙拒绝进程", "跳过", cause.gaps.join("；") || "没有唯一已确认进程");
      }
    }
    stable = await runInputReset(request, state, runtime, reportProgress, "不同蓝牙设备输入复位");
    if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("多端点会话类", "多蓝牙输入复位后稳定恢复"), false);
  } else {
    addStep(request.name, state.steps, "检查不同蓝牙输入输出", "跳过", "当前输入输出不是两台不同蓝牙设备");
  }

  alreadyRecovered = await finishIfAlreadyRecovered();
  if (alreadyRecovered) return alreadyRecovered;
  stable = await rebuildAudioChain(request, state, runtime, reportProgress);
  if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("声音链路类", "完整声音链路重建后稳定恢复"), true);
  return result(request, state, runtime, "未恢复", makeDiagnosis("声音链路类", "固定处理顺序执行完毕仍未恢复"), true);
}
