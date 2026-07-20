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
import type { MicrophoneUser, RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import {
  diagnoseFormatRequestCause,
  diagnoseMultiEndpointCause,
  readRecentSystemAudioEvidence,
  readMultiEndpointEvidenceSince,
  readSystemAudioEvidenceSince,
  type FormatRequestCause,
  type FormatRequestEvidence,
  type MultiEndpointCause,
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
  readMultiEndpointEvidenceSince: (startedAtMs: number) => FormatRequestEvidence;
  setDefaultDevice: (direction: "input" | "output", name: string) => void;
  reconnectDevice: (name: string) => void;
};

const systemRuntime: RecoveryRuntime = {
  now: Date.now,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  readDevices: () => readAudioDevices().devices,
  readMicrophoneUsers: () => readMicrophoneUsersAsync(2_000),
  readProcess: readRunningProcess,
  terminateProcess: terminateRunningProcess,
  readEvidence: () => readRecentSystemAudioEvidence(10),
  readEvidenceSince: readSystemAudioEvidenceSince,
  readMultiEndpointEvidenceSince,
  setDefaultDevice: setDefaultAudioDevice,
  reconnectDevice: reconnectBluetoothDevice,
};

type CauseMatch = {
  diagnosis: RecoveryDiagnosis;
  processes: RunningProcess[];
  routeChoices: RecoveryRouteChoice[];
};

type ProcessActionResult = {
  stableRate: number | null;
  released: RunningProcess[];
  remaining: RunningProcess[];
};

type ObservedBluetoothConflict = NonNullable<NonNullable<RecoveryRequest["context"]>["observedBluetoothConflict"]>;

function isBluetooth(device: RawAudioDevice): boolean {
  return device.transport === "bluetooth" || device.transport === "bluetooth-le";
}

function targetOutput(devices: RawAudioDevice[], name: string): RawAudioDevice | undefined {
  return devices.find((device) => device.name === name && device.outputChannels > 0);
}

function currentOutputRate(runtime: RecoveryRuntime, name: string): number | null {
  const target = targetOutput(runtime.readDevices(), name);
  return target?.isDefaultOutput ? target.sampleRateOutput : null;
}

function currentDefaultName(
  devices: RawAudioDevice[],
  direction: "input" | "output",
): string | null {
  return devices.find((device) =>
    direction === "input" ? device.isDefaultInput : device.isDefaultOutput
  )?.name ?? null;
}

function hasDifferentBluetoothDefaultRoutes(devices: RawAudioDevice[]): boolean {
  const input = devices.find((device) => device.isDefaultInput && device.inputChannels > 0);
  const output = devices.find((device) => device.isDefaultOutput && device.outputChannels > 0);
  return Boolean(input && output && isBluetooth(input) && isBluetooth(output) && input.name !== output.name);
}

function recentObservedBluetoothConflict(
  request: RecoveryRequest,
  devices: RawAudioDevice[],
  now: number,
): ObservedBluetoothConflict | null {
  const observed = request.context?.observedBluetoothConflict;
  if (!observed || observed.inputName === observed.outputName || observed.outputName !== request.name) return null;
  const observedAt = Date.parse(observed.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now + 1_000 || now - observedAt > 15_000) return null;
  const input = devices.find((device) => device.name === observed.inputName && device.inputChannels > 0);
  const output = devices.find((device) => device.name === observed.outputName && device.outputChannels > 0);
  return input && output && isBluetooth(input) && isBluetooth(output) ? observed : null;
}

function withObservedDefaultRoutes(
  devices: RawAudioDevice[],
  observed: ObservedBluetoothConflict,
): RawAudioDevice[] {
  if (!observed) return devices;
  return devices.map((device) => ({
    ...device,
    isDefaultInput: device.inputChannels > 0 && device.name === observed.inputName,
    isDefaultOutput: device.outputChannels > 0 && device.name === observed.outputName,
  }));
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

function multiEndpointEvidence(cause: MultiEndpointCause): string[] {
  const evidence = cause.bindings.map((binding) =>
    `${binding.direction === "input" ? "输入" : "输出"}端点：${binding.address}`
  );
  if (cause.requester) evidence.push(`声音会话进程：${processDescription(cause.requester)}`);
  if (cause.rejection) evidence.push(`系统拒绝原文：${cause.rejection}`);
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
  options: { allowRecoveredMultiEndpoint?: boolean; onlyMultiEndpoint?: boolean } = {},
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

  const multi = diagnoseMultiEndpointCause(evidence, target, runtime.readProcess, {
    allowRecoveredTarget: options.allowRecoveredMultiEndpoint,
  });
  const lowRateBluetoothOutputNames = devices
    .filter((device) =>
      device.isDefaultOutput && device.outputChannels > 0 && isBluetooth(device) &&
      device.sampleRateOutput !== null && device.sampleRateOutput <= 16_000
    )
    .map((device) => device.name);
  const format = diagnoseFormatRequestCause(evidence, name, lowRateBluetoothOutputNames, runtime.readProcess);
  const kind = selectCauseRoute(
    false,
    multi.confidence === "已确认",
    !options.onlyMultiEndpoint && format.confidence === "已确认",
  );

  if (kind === "多端点会话类") {
    const requesterName = multi.requester?.name ?? "该应用";
    return {
      diagnosis: {
        kind,
        confidence: "已确认",
        summary: `${requesterName} 提交了来自两台蓝牙设备的输入输出组合，该组合被系统拒绝`,
        evidence: multiEndpointEvidence(multi),
      },
      processes: multi.requester ? [multi.requester] : [],
      routeChoices: createMultiEndpointRouteChoices(devices, name),
    };
  }
  if (options.onlyMultiEndpoint) {
    return {
      diagnosis: {
        kind: "证据不足",
        confidence: multi.confidence,
        summary: "尚不能确认具体应用拒绝了当前双蓝牙组合",
        evidence: multiEndpointEvidence(multi),
      },
      processes: [],
      routeChoices: [],
    };
  }
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

  const candidate = multi.confidence === "高度疑似" ? multiEndpointEvidence(multi) : formatCauseEvidence(format, evidence.windowMinutes);
  return {
    diagnosis: {
      kind: "证据不足",
      confidence: multi.confidence === "高度疑似" || format.confidence === "高度疑似" ? "高度疑似" : "无法确认",
      summary: "没有完整命中已确证原因特征，不结束任何候选进程",
      evidence: candidate,
    },
    processes: [],
    routeChoices: [],
  };
}

async function verifyStableHighRate(
  name: string,
  runtime: RecoveryRuntime,
  reportProgress: (progress: RecoveryProgress) => void,
  attempts = 10,
): Promise<number | null> {
  let consecutive = 0;
  let lastRate: number | null = null;
  let progressReported = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastRate = currentOutputRate(runtime, name);
    if (lastRate !== null && lastRate > 16_000) {
      consecutive += 1;
      if (!progressReported) {
        progressReported = true;
        reportProgress({
          stage: "正在确认稳定",
          message: `已观察到 ${lastRate / 1_000} kHz，正在连续确认不会再次进入通话模式。`,
        });
      }
      if (consecutive >= 3) return lastRate;
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
    return { stableRate: null, released: [], remaining: unsafe };
  }
  if (currentOutputRate(runtime, name) === null || (currentOutputRate(runtime, name) ?? 0) > 16_000) {
    addStep(name, steps, "解除已确证原因", "跳过", "动作前目标已经不再是低采样率默认输出");
    return { stableRate: await verifyStableHighRate(name, runtime, reportProgress), released: [], remaining: [] };
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
  const stableRate = remaining.length === 0
    ? await verifyStableHighRate(name, runtime, reportProgress)
    : null;
  return { stableRate, released, remaining };
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

async function restoreOriginalRoutes(
  name: string,
  originalInput: string | null,
  originalOutput: string | null,
  steps: RecoveryStep[],
  runtime: RecoveryRuntime,
): Promise<boolean> {
  let restored = true;
  const devices = runtime.readDevices();
  for (const [direction, expected] of [["input", originalInput], ["output", originalOutput]] as const) {
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
  if (outcome === "完全恢复") return `${name} 已稳定恢复到 ${(rate ?? 0) / 1_000} kHz，并尽量恢复了点击前输入输出。`;
  if (outcome === "绕过成功") return "替代输入输出组合已经稳定；这是绕过成功，不代表原组合已完全修复。";
  if (outcome === "原组合复发") return "恢复点击前输入输出组合后再次进入通话模式，原组合仍会复发。";
  if (outcome === "等待选择") return "已确认多端点会话问题，请选择希望保留输入还是输出。";
  if (outcome === "等待授权") return "同一进程自动重启并再次触发问题，需要授权后才能在本次开机期间阻止它继续拉起。";
  return `${name} 仍未稳定恢复到高于 16 kHz，本轮已停止，不再猜测或继续结束进程。`;
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
  const observedConflict = recentObservedBluetoothConflict(request, devices, runtime.now());
  const originalInput = observedConflict?.inputName ?? request.context?.defaultInput ?? currentDefaultName(devices, "input");
  const originalOutput = observedConflict?.outputName ?? request.context?.defaultOutput ?? currentDefaultName(devices, "output");
  const initialRate = target?.sampleRateOutput ?? request.context?.targetSampleRate ?? null;
  addStep(name, steps, "保存现场", "成功", `点击时间：${request.context?.clickedAt ?? new Date(runtime.now()).toISOString()}；输入：${originalInput ?? "未知"}；输出：${originalOutput ?? "未知"}；目标采样率：${initialRate ?? "未知"}`);

  const canInspectMultiEndpoint = request.inspectMultiEndpoint === true &&
    target?.isDefaultOutput === true && (hasDifferentBluetoothDefaultRoutes(devices) || observedConflict !== null);
  const isNormalInputOnlyTarget = target?.isDefaultOutput === false &&
    devices.some((device) => device.name === name && device.isDefaultInput && device.inputChannels > 0);
  const isInactiveOutputTarget = target?.isDefaultOutput === false;
  const cannotProveOutputDegradation = target?.isDefaultOutput === true &&
    (target.maxSupportedOutputRate ?? 0) <= 16_000;
  if (!target || !target.isDefaultOutput || target.sampleRateOutput === null ||
      cannotProveOutputDegradation ||
      (target.sampleRateOutput > 16_000 && !canInspectMultiEndpoint) ||
      (request.inspectMultiEndpoint === true && !canInspectMultiEndpoint)) {
    const rate = target?.sampleRateOutput ?? null;
    const alreadyRecovered = target?.isDefaultOutput === true && rate !== null && rate > 16_000;
    const summary = alreadyRecovered
      ? "目标现场已经恢复"
      : isNormalInputOnlyTarget
        ? "该设备当前只作为麦克风输入使用，无需修复输出"
        : cannotProveOutputDegradation
          ? "无法证明该设备的输出从高采样率降级，无需执行输出修复"
          : "该设备当前不是需要修复的默认输出";
    const diagnosis: RecoveryDiagnosis = {
      kind: "证据不足",
      confidence: alreadyRecovered || isInactiveOutputTarget || cannotProveOutputDegradation ? "已确认" : "无法确认",
      summary,
      evidence: [
        `当前默认输入：${originalInput ?? "未知"}`,
        `当前默认输出：${originalOutput ?? "未知"}`,
        `该设备系统输出端点：${rate === null ? "未知" : `${rate / 1_000} kHz`}${target?.isDefaultOutput ? "（当前输出）" : "（当前未播放）"}`,
        `该设备已知最高输出采样率：${target?.maxSupportedOutputRate === null || target?.maxSupportedOutputRate === undefined ? "未知" : `${target.maxSupportedOutputRate / 1_000} kHz`}`,
      ],
    };
    addStep(name, steps, "复核目标", "成功", diagnosis.summary, rate);
    const outcome = "无需修复";
    const message = isNormalInputOnlyTarget
      ? `${name} 当前只作为麦克风输入使用；16 kHz 输入可以是正常规格，未播放的系统输出端点无需恢复。`
      : cannotProveOutputDegradation
        ? `${name} 没有已证明的高采样率输出能力，本次不把 16 kHz 当作输出故障。`
        : alreadyRecovered
          ? baseMessage(outcome, name, rate)
          : !target
            ? `${name} 当前没有可用的系统输出端点，无需执行输出修复。`
            : !target.isDefaultOutput
              ? `${name} 当前没有承担声音输出，无需执行输出修复。`
              : `${name} 当前输出采样率无法读取，本次未执行修复动作。`;
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

  reportProgress({
    stage: "正在定位原因",
    message: request.inspectMultiEndpoint
      ? "正在只读复核最近的双蓝牙会话拒绝证据。"
      : "正在按麦克风占用、多端点会话、格式请求的顺序定位原因。",
  });
  let users: MicrophoneUser[];
  if (request.inspectMultiEndpoint) {
    users = [];
  } else try {
    users = await currentMicrophoneUsers(request, runtime);
  } catch (error) {
    users = [];
    addStep(name, steps, "补充麦克风占用检查", "失败", error instanceof Error ? error.message : String(error));
  }
  let evidence: FormatRequestEvidence | null = null;
  if (users.length === 0) {
    evidence = request.inspectMultiEndpoint && observedConflict
      ? runtime.readMultiEndpointEvidenceSince(
          Date.parse(observedConflict.observedAt) - (observedConflict.lookbackSeconds ?? 2) * 1_000,
        )
      : runtime.readEvidence();
  }
  const diagnosisDevices = observedConflict ? withObservedDefaultRoutes(devices, observedConflict) : devices;
  let cause = diagnoseCause(name, diagnosisDevices, users, evidence, runtime, {
    allowRecoveredMultiEndpoint: request.inspectMultiEndpoint,
    onlyMultiEndpoint: request.inspectMultiEndpoint,
  });
  addStep(name, steps, "原因定位", cause.diagnosis.confidence === "已确认" ? "成功" : "失败", `${cause.diagnosis.kind}：${cause.diagnosis.summary}`);

  if (request.inspectMultiEndpoint && cause.diagnosis.kind !== "多端点会话类") {
    return makeResult({
      outcome: "未恢复",
      recoveryPath: "现场复核",
      handledCause: false,
      sampleRate: currentOutputRate(runtime, name),
      releasedPrograms: [],
      remainingPrograms: [],
      diagnosis: cause.diagnosis,
      steps,
      usedReconnect: false,
      message: "检测到双蓝牙组合波动，但系统证据尚不足以点名具体应用；本次没有结束进程或切换设备。",
    });
  }

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
    if (action.stableRate !== null) {
      await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
      const restoredRate = await verifyStableHighRate(name, runtime, reportProgress, 3);
      const outcome = restoredRate !== null ? "完全恢复" : "原组合复发";
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
    const freshEvidence = freshUsers.length === 0 ? runtime.readEvidenceSince(actionStartedAt) : null;
    const freshCause = diagnoseCause(name, freshDevices, freshUsers, freshEvidence, runtime);
    const originalCommands = new Set(cause.processes.map((processInfo) => processInfo.command));
    const repeatedProcesses = freshCause.processes.filter((processInfo) => originalCommands.has(processInfo.command));
    if (freshCause.diagnosis.confidence === "已确认" && repeatedProcesses.length > 0) {
      if (!request.authorizeRelaunchBlock) {
        addStep(name, steps, "检测自动重启", "失败", `同一进程再次触发：${repeatedProcesses.map(processDescription).join("、")}`);
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
            prompt: "是否授权工具仅在本次开机期间阻止该进程继续自动拉起？不会修改登录项、删除应用或改变下次开机配置。",
            processNames: repeatedProcesses.map((processInfo) => processInfo.name),
          },
          message: baseMessage(outcome, name, currentOutputRate(runtime, name)),
        });
      }
      const repeatedAction = await executeProcessAction(name, repeatedProcesses, steps, runtime, reportProgress);
      releasedPrograms.push(...repeatedAction.released.map((processInfo) => processInfo.name));
      remainingPrograms.push(...repeatedAction.remaining.map((processInfo) => processInfo.name));
      if (repeatedAction.released.length > 0) guardCommand = repeatedAction.released[0].command;
      if (repeatedAction.released.length > 0) guardProcessName = repeatedAction.released[0].name;
      if (repeatedAction.stableRate !== null) {
        await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
        const restoredRate = await verifyStableHighRate(name, runtime, reportProgress, 3);
        const outcome = restoredRate !== null ? "完全恢复" : "原组合复发";
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
      if (secondAction.stableRate !== null) {
        await restoreOriginalRoutes(name, originalInput, originalOutput, steps, runtime);
        const restoredRate = await verifyStableHighRate(name, runtime, reportProgress, 3);
        const outcome = restoredRate !== null ? "完全恢复" : "原组合复发";
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
      const rate = restored ? await verifyStableHighRate(name, runtime, reportProgress) : null;
      if (rate !== null) {
        const outcome = "完全恢复";
        return makeResult({
          outcome,
          recoveryPath,
          handledCause,
          sampleRate: rate,
          releasedPrograms,
          remainingPrograms,
          diagnosis: cause.diagnosis,
          steps,
          usedReconnect,
          message: baseMessage(outcome, name, rate),
          _relaunchGuard: guardCommand && guardProcessName ? { command: guardCommand, processName: guardProcessName } : undefined,
        });
      }
    }
  } else {
    addStep(name, steps, "临时切换到非蓝牙输入", "跳过", "没有可用的非蓝牙中转输入，或点击前输入未知");
  }

  try {
    runtime.reconnectDevice(name);
    usedReconnect = true;
    addStep(name, steps, "断开并重连目标设备", "成功", "只重建本次蓝牙声音链路，不把该动作记录为根因修复");
  } catch (error) {
    addStep(name, steps, "断开并重连目标设备", "失败", error instanceof Error ? error.message : String(error));
  }
  const finalRate = usedReconnect ? await verifyStableHighRate(name, runtime, reportProgress) : null;
  const outcome = finalRate !== null ? "完全恢复" : "未恢复";
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
    message: baseMessage(outcome, name, finalRate),
    _relaunchGuard: guardCommand && guardProcessName ? { command: guardCommand, processName: guardProcessName } : undefined,
  });
}
