import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { setDefaultAudioDevice } from "../../core/macos-audio-route/index.ts";
import { connectBluetoothDevice } from "../../core/macos-bluetooth-link/index.ts";
import { readBluetoothPower, setBluetoothPower } from "../../core/macos-bluetooth-control/index.ts";
import { readMicrophoneUsersAsync } from "../../core/macos-microphone-usage/index.ts";
import {
  readRunningProcess,
  readRunningProcessesByCommand,
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
  diagnoseFormatRequestCause,
  diagnoseMultiEndpointCause,
  readSystemAudioEvidenceSince,
  type FormatRequestEvidence,
} from "./format-request-diagnosis.ts";
import { orderedRouteCandidates, routeDevicePriority, routeDevicePriorityLabel } from "./recovery-policy.ts";
import type {
  A2dpRecoveryResult,
  RecoveryDiagnosis,
  RecoveryProgress,
  RecoveryRequest,
  RecoveryRoundState,
  RecoveryStep,
  RelaunchGuardRequest,
} from "./types.ts";

const protectedProcessNames = new Set([
  "audioaccessoryd", "audiomxd", "bluetoothd", "bluetoothuserd", "coreaudiod", "kernel_task", "launchd",
]);
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
  readMicrophoneUsers: () => Promise<MicrophoneUser[]>;
  readProcess: (pid: number) => RunningProcess | null;
  readProcessesByCommand: (command: string) => RunningProcess[];
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
  readMicrophoneUsers: () => readMicrophoneUsersAsync(2_000),
  readProcess: readRunningProcess,
  readProcessesByCommand: readRunningProcessesByCommand,
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

function isBluetooth(device: RawAudioDevice): boolean {
  const transport = (device.transport ?? "").toLowerCase();
  return transport === "bluetooth" || transport === "bluetooth-le" || transport.includes("bluetooth");
}

function currentAssessments(runtime: RecoveryRuntime, request: RecoveryRequest): AudioModeAssessment[] {
  const live = runtime.readModeAssessments?.() ?? [];
  if (live.length > 0) return live;
  if ((request.context?.deviceAssessments?.length ?? 0) > 0) return request.context?.deviceAssessments ?? [];
  const target = runtime.readModeAssessment(request.name) ?? request.context?.targetAssessment ?? null;
  return target ? [target] : [];
}

function currentAssessment(runtime: RecoveryRuntime, request: RecoveryRequest): AudioModeAssessment | null {
  return currentAssessments(runtime, request).find((item) => item.name === request.name) ??
    runtime.readModeAssessment(request.name) ?? request.context?.targetAssessment ?? null;
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
    const address = device.bluetoothAddress?.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
    const identity = address ? `address:${address}` : `name:${device.name}`;
    if (!byPhysicalIdentity.has(identity)) byPhysicalIdentity.set(identity, device.name);
  }
  return [...byPhysicalIdentity.values()];
}

function currentObservation(runtime: RecoveryRuntime, request: RecoveryRequest) {
  const assessment = currentAssessment(runtime, request);
  const output = targetOutput(runtime.readDevices(), request.name);
  return {
    mode: assessment?.mode ?? null,
    rate: assessment?.actualSampleRateOutput ?? output?.actualSampleRateOutput ?? null,
    isDefaultOutput: assessment?.isDefaultOutput ?? output?.isDefaultOutput ?? false,
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

function physicalBluetoothUsers(users: MicrophoneUser[], devices: RawAudioDevice[]): MicrophoneUser[] {
  const names = new Set(devices.filter((device) => isBluetooth(device) && device.inputChannels > 0).map((device) => device.name));
  return users.filter((user) =>
    user.inputActivityKind === "已确认实体麦克风占用" &&
    user.devices.some((deviceName) => names.has(deviceName))
  );
}

function identifiedProcesses(users: MicrophoneUser[], runtime: RecoveryRuntime): RunningProcess[] {
  return [...new Map(users
    .map((user) => runtime.readProcess(user.pid))
    .filter((item): item is RunningProcess => item !== null)
    .map((item) => [item.pid, item] as const)).values()];
}

async function verifyStableRecovery(
  request: RecoveryRequest,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  attempts = 10,
): Promise<StableRecovery | null> {
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
    if (attempt < attempts - 1) await runtime.wait(500);
  }
  return null;
}

async function waitForRoute(
  direction: "input" | "output",
  name: string,
  runtime: RecoveryRuntime,
): Promise<boolean> {
  for (let elapsed = 0; elapsed <= routeTimeoutMs; elapsed += routePollMs) {
    if (currentDefaultName(runtime.readDevices(), direction) === name) return true;
    if (elapsed < routeTimeoutMs) await runtime.wait(routePollMs);
  }
  return false;
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
  for (let elapsed = 0; elapsed <= linkReleaseTimeoutMs; elapsed += linkPollMs) {
    if (runtime.readModeAssessment(name)?.audioLinkType === "tacl") return true;
    if (elapsed < linkReleaseTimeoutMs) await runtime.wait(linkPollMs);
  }
  return false;
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
  state: RecoveryRoundState,
  runtime: RecoveryRuntime,
  outputFirst = true,
): Promise<boolean> {
  const pairs = outputFirst
    ? [["output", state.context.defaultOutput], ["input", state.context.defaultInput]] as const
    : [["input", state.context.defaultInput], ["output", state.context.defaultOutput]] as const;
  let restored = true;
  for (const [direction, expected] of pairs) {
    if (!expected || currentDefaultName(runtime.readDevices(), direction) === expected) continue;
    const channels = direction === "input" ? "inputChannels" : "outputChannels";
    if (!runtime.readDevices().some((device) => device.name === expected && device[channels] > 0)) {
      addStep(request.name, state.steps, "恢复点击前声音设备", "失败", `${expected} 当前不可用`);
      restored = false;
      continue;
    }
    const confirmed = await setAndConfirmRoute(direction, expected, runtime);
    addStep(request.name, state.steps, "恢复点击前声音设备", confirmed ? "成功" : "失败", `${direction === "input" ? "输入" : "输出"}：${expected}`);
    restored = restored && confirmed;
  }
  return restored;
}

async function terminateAndWait(processes: RunningProcess[], runtime: RecoveryRuntime): Promise<RunningProcess[]> {
  const safe = processes.filter((processInfo) => !protectedProcessNames.has(processInfo.name));
  for (const processInfo of safe) runtime.terminateProcess(processInfo);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const remaining = safe.filter((expected) => {
      const current = runtime.readProcess(expected.pid);
      return current?.command === expected.command && current.startedAt === expected.startedAt;
    });
    if (remaining.length === 0) return [];
    if (attempt < 19) await runtime.wait(100);
  }
  return safe.filter((expected) => runtime.readProcess(expected.pid) !== null);
}

function result(
  request: RecoveryRequest,
  state: RecoveryRoundState,
  runtime: RecoveryRuntime,
  outcome: A2dpRecoveryResult["outcome"],
  diagnosis: RecoveryDiagnosis,
  rebuiltAudioChain: boolean,
  options: Pick<A2dpRecoveryResult, "actionRequired" | "_continuation"> = {},
): A2dpRecoveryResult {
  const observation = currentObservation(runtime, request);
  const value: A2dpRecoveryResult = {
    ok: outcome === "无需修复" || outcome === "完全恢复",
    outcome,
    recoveryPath: outcome === "无需修复" ? "现场复核" : "固定处理顺序",
    handledCause: state.releasedPrograms.length > 0,
    sampleRate: observation.rate ?? request.context?.targetSampleRate ?? null,
    releasedPrograms: [...new Set(state.releasedPrograms)],
    remainingPrograms: [...new Set(state.remainingPrograms)],
    guardedPrograms: [...new Set(state.guardedPrograms)],
    diagnosis,
    steps: state.steps,
    rebuiltAudioChain,
    actionRequired: options.actionRequired,
    message: outcome === "完全恢复"
      ? `${request.name} 已稳定恢复高音质播放。`
      : outcome === "无需修复" ? `${request.name} 当前无需修复。`
      : outcome === "等待授权" ? "需要授权后继续同一修复回合。"
      : `${request.name} 完成固定处理顺序后仍未恢复。`,
    _continuation: options._continuation,
  };
  detailedLog(value.ok ? "info" : "warn", "a2dp-recovery.completed", { result: value });
  return value;
}

function makeDiagnosis(kind: RecoveryDiagnosis["kind"], summary: string, evidence: string[] = []): RecoveryDiagnosis {
  return { kind, confidence: evidence.length > 0 ? "已确认" : "无法确认", summary, evidence };
}

async function processStep(
  request: RecoveryRequest,
  state: RecoveryRoundState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  cause: "麦克风占用类" | "格式请求类",
  processes: RunningProcess[],
  nextStep: RecoveryRoundState["nextStep"],
  microphoneDeviceName?: string,
): Promise<A2dpRecoveryResult | StableRecovery | null> {
  if (processes.length === 0) return null;
  const safe = processes.filter((item) => !protectedProcessNames.has(item.name));
  if (safe.length === 0) {
    addStep(request.name, state.steps, `处理${cause}`, "失败", "证据指向受保护系统进程，未结束进程");
    return null;
  }
  reportProgress({ stage: "正在检查占用", message: `正在请求${safe.map((item) => processDisplayName(item, cause)).join("、")}正常退出。` });
  const remaining = await terminateAndWait(safe, runtime);
  const released = safe.filter((item) => !remaining.some((current) => current.pid === item.pid));
  state.releasedPrograms.push(...released.map((item) => item.name));
  state.remainingPrograms.push(...remaining.map((item) => item.name));
  state.processAttempts.push(...safe.map((item) => ({
    cause,
    command: item.command,
    processName: item.name,
    microphoneDeviceName,
    automaticProcessPid: item.pid,
    automaticProcessStartedAt: item.startedAt,
    automaticAttempted: true,
    automaticExitConfirmed: !remaining.some((current) => current.pid === item.pid),
    authorizedAttempted: false,
  })));
  addStep(request.name, state.steps, `处理${cause}`, remaining.length === 0 ? "成功" : "失败",
    remaining.length === 0
      ? `已确认退出：${released.map((item) => processDescription(item, cause)).join("、")}`
      : `仍未退出：${remaining.map((item) => processDescription(item, cause)).join("、")}`);

  const restarted = released.flatMap((item) => runtime.readProcessesByCommand(item.command));
  const needsAuthorization = [...new Map([...remaining, ...restarted].map((item) => [item.command, item] as const)).values()];
  if (needsAuthorization.length > 0) {
    state.nextStep = nextStep;
    const guards: RelaunchGuardRequest[] = needsAuthorization.map((item) => ({
      cause,
      command: item.command,
      processName: item.name,
      microphoneDeviceName,
      occupancyEvidence: cause === "麦克风占用类" ? "physical-bluetooth-microphone" : "unclosed-format-request",
    }));
    const diagnosis = makeDiagnosis(cause, `${cause}进程未退出或重新启动`, needsAuthorization.map((item) => processDescription(item, cause)));
    return result(request, state, runtime, "等待授权", diagnosis, false, {
      actionRequired: {
        kind: "relaunch-authorization",
        prompt: "是否授权在本次开机期间阻止这些进程再次形成同一占用？",
        processNames: needsAuthorization.map((item) => item.name),
        cause,
        triggerState: remaining.length > 0 ? "still-running" : "restarted",
        occupancyEvidence: guards[0].occupancyEvidence,
      },
      _continuation: { roundState: state, pendingGuards: guards },
    });
  }
  return verifyStableRecovery(request, runtime, reportProgress);
}

async function runInputReset(
  request: RecoveryRequest,
  state: RecoveryRoundState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  stage: string,
): Promise<StableRecovery | null> {
  const original = currentDefaultName(runtime.readDevices(), "input") ?? state.context.defaultInput;
  if (!original) {
    addStep(request.name, state.steps, stage, "跳过", "没有可恢复的默认输入");
    return null;
  }
  reportProgress({ stage: "正在切换声音设备", message: "正在通过非蓝牙输入刷新声音路由。" });
  const candidate = await selectAndSetNonBluetooth("input", [original], runtime);
  if (!candidate) {
    addStep(request.name, state.steps, stage, "跳过", "没有可用的其他非蓝牙输入");
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
  state: RecoveryRoundState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
): Promise<StableRecovery | null> {
  const originalInput = currentDefaultName(runtime.readDevices(), "input") ?? state.context.defaultInput;
  const originalOutput = currentDefaultName(runtime.readDevices(), "output") ?? state.context.defaultOutput;
  if (!originalInput || !originalOutput) {
    addStep(request.name, state.steps, "同时切换输入输出", "跳过", "点击现场缺少默认输入或输出");
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
    await restoreRoutes(request, state, runtime, true);
    addStep(request.name, state.steps, "同时切换输入输出", "失败", "中转路由未能完整建立，已恢复点击前路由");
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
  for (let elapsed = 0; elapsed <= 5_000; elapsed += 100) {
    try { if (runtime.readBluetoothPower() === expected) return true; } catch { /* continue */ }
    if (elapsed < 5_000) await runtime.wait(100);
  }
  return false;
}

async function waitForNewServicePid(
  service: AudioChainService,
  previousPid: number | null,
  runtime: RecoveryRuntime,
): Promise<number | null> {
  for (let elapsed = 0; elapsed <= 5_000; elapsed += 100) {
    const current = runtime.readServicePid(service);
    if (current !== null && current !== previousPid) return current;
    if (elapsed < 5_000) await runtime.wait(100);
  }
  return null;
}

async function waitForTargetEndpoint(name: string, runtime: RecoveryRuntime): Promise<boolean> {
  for (let elapsed = 0; elapsed <= 3_000; elapsed += 100) {
    if (runtime.readDevices().some((device) => device.name === name && (device.inputChannels > 0 || device.outputChannels > 0))) return true;
    if (elapsed < 3_000) await runtime.wait(100);
  }
  return false;
}

async function rebuildAudioChain(
  request: RecoveryRequest,
  state: RecoveryRoundState,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
): Promise<StableRecovery | null> {
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
  const restored = await restoreRoutes(request, state, runtime, true);
  return restored && appeared ? verifyStableRecovery(request, runtime, reportProgress) : null;
}

export async function runRecovery(
  request: RecoveryRequest,
  runtime: RecoveryRuntime = systemRuntime,
  reportProgress: (progress: RecoveryProgress) => void = () => {},
): Promise<A2dpRecoveryResult> {
  const assessment = currentAssessment(runtime, request);
  const context = request._roundState?.context ?? request.context ?? {
    clickedAt: new Date(runtime.now()).toISOString(),
    defaultInput: currentDefaultName(runtime.readDevices(), "input"),
    defaultOutput: currentDefaultName(runtime.readDevices(), "output"),
    targetSampleRate: assessment?.actualSampleRateOutput ?? null,
    targetAssessment: assessment,
    deviceAssessments: currentAssessments(runtime, request),
  };
  const state: RecoveryRoundState = request._roundState ? {
    ...request._roundState,
    processAttempts: [...request._roundState.processAttempts],
    releasedPrograms: [...request._roundState.releasedPrograms],
    remainingPrograms: [...request._roundState.remainingPrograms],
    guardedPrograms: [...request._roundState.guardedPrograms],
    steps: [...request._roundState.steps],
  } : {
    context,
    nextStep: 1,
    processAttempts: [],
    releasedPrograms: [],
    remainingPrograms: [],
    guardedPrograms: [],
    steps: [],
  };
  request = { ...request, context };

  if (!request._roundState) {
    reportProgress({ stage: "正在保存现场", message: "正在保存点击时的输入、输出、模式和链路证据。" });
    addStep(request.name, state.steps, "保存现场", "成功", `输入：${context.defaultInput ?? "未知"}；输出：${context.defaultOutput ?? "未知"}`);
  }
  if (assessment?.a2dpSupport === "UNSUPPORTED" || assessment?.mode !== "HFP_HSP") {
    const diagnosis = makeDiagnosis("证据不足", assessment?.a2dpSupport === "UNSUPPORTED" ? "目标不支持 A2DP" : "目标当前不在 HFP/HSP");
    return result(request, state, runtime, "无需修复", diagnosis, false);
  }

  if ((request._approvedRelaunchGuards?.length ?? 0) > 0) {
    state.guardedPrograms.push(...(request._approvedRelaunchGuards ?? []).map((guard) => guard.processName));
    addStep(request.name, state.steps, "启用本次开机阻止自动拉起", "成功", state.guardedPrograms.join("、"));
    const stable = await verifyStableRecovery(request, runtime, reportProgress, 3);
    if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("麦克风占用类", "授权后稳定恢复", state.guardedPrograms), false);
  }

  const finishIfAlreadyRecovered = async (): Promise<A2dpRecoveryResult | null> => {
    if (currentAssessment(runtime, request)?.mode === "HFP_HSP") return null;
    const stable = await verifyStableRecovery(request, runtime, reportProgress, 3);
    return stable
      ? result(request, state, runtime, "完全恢复", makeDiagnosis("证据不足", "执行下一动作前目标已自行稳定恢复"), false)
      : null;
  };

  if (state.nextStep <= 1) {
    const alreadyRecovered = await finishIfAlreadyRecovered();
    if (alreadyRecovered) return alreadyRecovered;
    reportProgress({ stage: "正在检查占用", message: "正在检查实时蓝牙麦克风占用。" });
    let users: MicrophoneUser[] = [];
    const capturedAt = Date.parse(context.occupancySnapshot?.capturedAt ?? "");
    if (Number.isFinite(capturedAt) && runtime.now() - capturedAt <= 2_000) users = context.occupancySnapshot?.users ?? [];
    else {
      try { users = await runtime.readMicrophoneUsers(); }
      catch (error) { addStep(request.name, state.steps, "检查实时蓝牙麦克风占用", "失败", error instanceof Error ? error.message : String(error)); }
    }
    const confirmedUsers = physicalBluetoothUsers(users, runtime.readDevices());
    const processes = identifiedProcesses(confirmedUsers, runtime);
    if (processes.length === 0) addStep(request.name, state.steps, "检查实时蓝牙麦克风占用", "跳过", "没有已确认占用进程");
    else {
      const action = await processStep(request, state, runtime, reportProgress, "麦克风占用类", processes, 2, confirmedUsers[0]?.confirmedDeviceNames?.[0]);
      if (action && "outcome" in action) return action;
      if (action) return result(request, state, runtime, "完全恢复", makeDiagnosis("麦克风占用类", "结束占用进程后稳定恢复", processes.map(processDescription)), false);
    }
    state.nextStep = 2;
  }

  if (state.nextStep <= 2) {
    const alreadyRecovered = await finishIfAlreadyRecovered();
    if (alreadyRecovered) return alreadyRecovered;
    const stable = await runInputReset(request, state, runtime, reportProgress, "只切换默认输入");
    if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("声音链路类", "输入路由复位后稳定恢复"), false);
    state.nextStep = 3;
  }

  if (state.nextStep <= 3) {
    const alreadyRecovered = await finishIfAlreadyRecovered();
    if (alreadyRecovered) return alreadyRecovered;
    const stable = await runDualRouteReset(request, state, runtime, reportProgress);
    if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("声音链路类", "输入输出路由复位后稳定恢复"), false);
    state.nextStep = 4;
  }

  if (state.nextStep <= 4) {
    const alreadyRecovered = await finishIfAlreadyRecovered();
    if (alreadyRecovered) return alreadyRecovered;
    reportProgress({ stage: "正在检查占用", message: "正在检查仍有效的格式请求。" });
    const evidence = runtime.readEvidenceSince(Date.parse(context.clickedAt));
    const devices = runtime.readDevices();
    const lowRateBluetoothNames = uniqueBluetoothDeviceNames(devices.filter((device) =>
      isBluetooth(device) && device.outputChannels > 0 && (device.actualSampleRateOutput ?? device.sampleRateOutput ?? Infinity) <= 16_000
    ));
    const cause = diagnoseFormatRequestCause(evidence, request.name, lowRateBluetoothNames, runtime.readProcess);
    if (cause.confidence === "已确认" && cause.requester) {
      const action = await processStep(request, state, runtime, reportProgress, "格式请求类", [cause.requester], 5);
      if (action && "outcome" in action) return action;
      if (action) return result(request, state, runtime, "完全恢复", makeDiagnosis("格式请求类", "结束格式请求进程后稳定恢复", [processDescription(cause.requester, "格式请求类")]), false);
    } else {
      addStep(request.name, state.steps, "检查格式请求", cause.confidence === "高度疑似" ? "失败" : "跳过", cause.gaps.join("；"));
    }
    state.nextStep = 5;
  }

  if (state.nextStep <= 5) {
    const alreadyRecovered = await finishIfAlreadyRecovered();
    if (alreadyRecovered) return alreadyRecovered;
    const devices = runtime.readDevices();
    const input = devices.find((device) => device.isDefaultInput && device.inputChannels > 0);
    const output = devices.find((device) => device.isDefaultOutput && device.outputChannels > 0);
    if (input && output && isBluetooth(input) && isBluetooth(output) && input.name !== output.name) {
      const target = targetOutput(devices, request.name);
      if (target) {
        const evidence = runtime.readEvidenceSince(Date.parse(context.clickedAt));
        const cause = diagnoseMultiEndpointCause(evidence, target, runtime.readProcess, { allowRecoveredTarget: true });
        if (cause.confidence === "已确认" && cause.requester && !protectedProcessNames.has(cause.requester.name)) {
          const remaining = await terminateAndWait([cause.requester], runtime);
          if (remaining.length === 0) state.releasedPrograms.push(cause.requester.name);
          else state.remainingPrograms.push(cause.requester.name);
          addStep(request.name, state.steps, "处理多蓝牙拒绝进程", remaining.length === 0 ? "成功" : "失败", processDescription(cause.requester));
        } else {
          addStep(request.name, state.steps, "检查多蓝牙拒绝进程", "跳过", cause.gaps.join("；") || "没有唯一已确认进程");
        }
      }
      const stable = await runInputReset(request, state, runtime, reportProgress, "不同蓝牙设备输入复位");
      if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("多端点会话类", "多蓝牙输入复位后稳定恢复"), false);
    } else {
      addStep(request.name, state.steps, "检查不同蓝牙输入输出", "跳过", "当前输入输出不是两台不同蓝牙设备");
    }
    state.nextStep = 6;
  }

  const alreadyRecovered = await finishIfAlreadyRecovered();
  if (alreadyRecovered) return alreadyRecovered;
  const stable = await rebuildAudioChain(request, state, runtime, reportProgress);
  if (stable) return result(request, state, runtime, "完全恢复", makeDiagnosis("声音链路类", "完整声音链路重建后稳定恢复"), true);
  return result(request, state, runtime, "未恢复", makeDiagnosis("声音链路类", "固定处理顺序执行完毕仍未恢复"), true);
}
