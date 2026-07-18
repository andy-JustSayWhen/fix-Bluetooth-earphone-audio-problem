import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { readMicrophoneUsers } from "../../core/macos-microphone-usage/index.ts";
import {
  readRunningProcess,
  terminateRunningProcess,
  type RunningProcess,
} from "../../core/macos-running-apps/index.ts";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import type { A2dpRecoveryResult, RecoveryDiagnosis, RecoveryStep } from "./index.ts";
import {
  diagnoseFormatRequestCause,
  readRecentSystemAudioEvidence,
  type FormatRequestCause,
} from "./format-request-diagnosis.ts";
import { selectRecoveryPolicy } from "./recovery-policy.ts";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const protectedProcessNames = new Set([
  "audioaccessoryd",
  "audiomxd",
  "bluetoothd",
  "coreaudiod",
  "kernel_task",
  "launchd",
]);
let recoveryDeviceName = "";

function outputDevice(name: string): RawAudioDevice | undefined {
  return readAudioDevices().devices.find((device) =>
    device.name === name && device.outputChannels > 0
  );
}

function currentOutputRate(name: string): number | null {
  const output = outputDevice(name);
  return output?.isDefaultOutput ? output.sampleRateOutput : null;
}

async function verifyStableHighRate(name: string, attempts = 8): Promise<number | null> {
  let consecutive = 0;
  let rate: number | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    rate = currentOutputRate(name);
    consecutive = rate !== null && rate > 16_000 ? consecutive + 1 : 0;
    if (consecutive >= 6) return rate;
    await wait(500);
  }
  return rate !== null && rate > 16_000 && consecutive >= 6 ? rate : null;
}

function step(
  steps: RecoveryStep[],
  stage: string,
  status: RecoveryStep["status"],
  detail: string,
  sampleRate?: number | null,
): void {
  steps.push({ stage, status, detail, sampleRate });
  detailedLog(status === "失败" ? "warn" : "info", "a2dp-recovery.step", {
    deviceName: recoveryDeviceName,
    stage,
    status,
    detail,
    sampleRate,
  });
}

function result(
  ok: boolean,
  name: string,
  handledCause: boolean,
  diagnosis: RecoveryDiagnosis,
  steps: RecoveryStep[],
  releasedPrograms: string[],
  remainingPrograms: string[],
  sampleRate: number | null,
): A2dpRecoveryResult {
  const recoveryResult: A2dpRecoveryResult = {
    ok,
    recoveryPath: handledCause ? "原因对应处理" : "仅原因定位",
    handledCause,
    sampleRate,
    releasedPrograms,
    remainingPrograms,
    diagnosis,
    steps,
    usedReconnect: false,
    message: ok
      ? `系统端点已稳定恢复为高采样率，当前为 ${(sampleRate ?? 0) / 1000} kHz；请以实际听感确认播放器已经出声。`
      : handledCause
        ? `已完成已确认原因对应的处理，但 ${name} 尚未稳定恢复到高于 16 kHz；本轮已停止，没有执行其他方法或兜底。`
        : `原因证据不足，本轮只完成定位并停止，没有结束候选进程，也没有执行其他方法或兜底。`,
  };
  detailedLog(ok ? "info" : "warn", "a2dp-recovery.completed", {
    deviceName: name,
    fallbackExecuted: false,
    result: recoveryResult,
  });
  return recoveryResult;
}

function processDescription(processInfo: RunningProcess): string {
  return `${processInfo.name}（进程号 ${processInfo.pid}，启动时间 ${processInfo.startedAt}，路径 ${processInfo.command}）`;
}

function canTerminate(processInfo: RunningProcess): boolean {
  return !protectedProcessNames.has(processInfo.name);
}

async function waitForProcessesToExit(processes: RunningProcess[]): Promise<RunningProcess[]> {
  let remaining = processes;
  for (let attempt = 0; attempt < 20 && remaining.length > 0; attempt += 1) {
    await wait(100);
    remaining = processes
      .map((processInfo) => readRunningProcess(processInfo.pid))
      .filter((processInfo): processInfo is RunningProcess => processInfo !== null)
      .filter((current) => processes.some((expected) =>
        expected.pid === current.pid &&
        expected.startedAt === current.startedAt &&
        expected.command === current.command
      ));
  }
  return remaining;
}

async function handleConfirmedProcesses(
  name: string,
  processes: RunningProcess[],
  diagnosis: RecoveryDiagnosis,
  steps: RecoveryStep[],
): Promise<A2dpRecoveryResult> {
  const rateBeforeHandling = currentOutputRate(name);
  if (rateBeforeHandling === null || rateBeforeHandling > 16_000) {
    step(steps, "原因对应处理", "跳过", "处理前目标设备已经不再是低采样率默认输出；未结束任何进程");
    return result(false, name, false, diagnosis, steps, [], [], rateBeforeHandling);
  }
  const unsafe = processes.filter((processInfo) => !canTerminate(processInfo));
  if (unsafe.length > 0) {
    step(steps, "原因对应处理", "失败", `命中受保护系统进程：${unsafe.map(processDescription).join("、")}；未发送退出请求`);
    return result(false, name, false, diagnosis, steps, [], unsafe.map((item) => item.name), currentOutputRate(name));
  }

  for (const processInfo of processes) terminateRunningProcess(processInfo);
  step(steps, "原因对应处理", "成功", `只向已确认原因进程发送正常退出请求：${processes.map(processDescription).join("、")}`);
  const remaining = await waitForProcessesToExit(processes);
  if (remaining.length > 0) {
    step(steps, "复查原因进程", "失败", `以下进程仍存在：${remaining.map(processDescription).join("、")}`);
    return result(
      false,
      name,
      true,
      diagnosis,
      steps,
      processes.filter((item) => !remaining.some((left) => left.pid === item.pid)).map((item) => item.name),
      remaining.map((item) => item.name),
      currentOutputRate(name),
    );
  }

  step(steps, "复查原因进程", "成功", "已确认本轮处理的进程退出；未处理其他进程");
  await wait(1_500);
  const rate = await verifyStableHighRate(name);
  step(
    steps,
    "等待系统自行恢复",
    rate === null ? "失败" : "成功",
    rate === null
      ? "原因进程退出后，实际输出仍未连续六次高于 16 kHz；按严格工作流停止"
      : "原因进程退出后，实际输出连续六次高于 16 kHz",
    rate ?? currentOutputRate(name),
  );
  return result(
    rate !== null,
    name,
    true,
    diagnosis,
    steps,
    processes.map((item) => item.name),
    [],
    rate ?? currentOutputRate(name),
  );
}

function formatCauseEvidence(cause: FormatRequestCause, windowMinutes: number): string[] {
  const evidence = [`已查询最近 ${windowMinutes} 分钟系统声音日志`];
  if (cause.request) {
    evidence.push(`格式请求原文：${cause.request.raw}`);
    evidence.push(`该进程在窗口内共有 ${cause.requestCount} 条格式请求`);
  }
  if (cause.requester) evidence.push(`请求进程：${processDescription(cause.requester)}`);
  evidence.push(cause.sameProcessStartIo ? "同进程两秒内存在 StartIO" : "同进程两秒内未发现 StartIO");
  evidence.push(cause.matchingTsco ? `匹配的 tsco 原文：${cause.matchingTsco.raw}` : "请求后两秒内未发现匹配的 tsco");
  evidence.push(...cause.gaps.map((gap) => `证据缺口：${gap}`));
  return evidence;
}

export async function runRecovery(name: string): Promise<A2dpRecoveryResult> {
  recoveryDeviceName = name;
  detailedLog("info", "a2dp-recovery.started", { deviceName: name, workflow: "strict-cause-only" });
  const steps: RecoveryStep[] = [];
  const initialSnapshot = readAudioDevices();
  const initialUsers = readMicrophoneUsers().filter((user) => user.devices.includes(name));
  const logEvidence = readRecentSystemAudioEvidence(10);
  const decisionSnapshot = readAudioDevices();
  const currentUsers = readMicrophoneUsers().filter((user) => user.devices.includes(name));
  const target = decisionSnapshot.devices.find((device) => device.name === name && device.outputChannels > 0);
  detailedLog(logEvidence.queryError ? "warn" : "info", "a2dp-recovery.system-log-read", {
    deviceName: name,
    windowMinutes: logEvidence.windowMinutes,
    eventCount: logEvidence.events.length,
    rawLines: logEvidence.rawLines,
    queryError: logEvidence.queryError,
    initialMicrophoneUsers: initialUsers,
    decisionMicrophoneUsers: currentUsers,
    initialDevice: initialSnapshot.devices.find((device) => device.name === name) ?? null,
    decisionDevice: target ?? null,
  });

  step(
    steps,
    "保存现场",
    "成功",
    `目标设备：${name}；开始查询时读取进程：${initialUsers.map((user) => user.name).join("、") || "无"}；处理前复查：${currentUsers.map((user) => user.name).join("、") || "无"}`,
  );
  step(
    steps,
    "读取系统声音日志",
    logEvidence.queryError ? "失败" : "成功",
    logEvidence.queryError
      ? `最近 ${logEvidence.windowMinutes} 分钟日志读取失败：${logEvidence.queryError}`
      : `已读取最近 ${logEvidence.windowMinutes} 分钟日志，共解析 ${logEvidence.events.length} 个相关事件`,
  );

  if (!target) {
    const diagnosis: RecoveryDiagnosis = {
      confidence: "无法确认",
      summary: "目标设备输出端点当前不存在",
      evidence: ["系统设备列表中没有目标输出端点"],
    };
    step(steps, "原因定位", "失败", "目标输出端点不存在，严格工作流停止");
    return result(false, name, false, diagnosis, steps, [], [], null);
  }

  if (!target.isDefaultOutput || target.sampleRateOutput === null || target.sampleRateOutput > 16_000) {
    const diagnosis: RecoveryDiagnosis = {
      confidence: "无法确认",
      summary: "当前现场不满足 HFP 原因处理条件",
      evidence: [
        `是否默认输出：${target.isDefaultOutput ? "是" : "否"}`,
        `当前实际输出：${target.sampleRateOutput === null ? "未知" : `${target.sampleRateOutput / 1000} kHz`}`,
      ],
    };
    step(steps, "原因定位", "跳过", "目标设备当前不是低采样率默认输出，不执行处理");
    return result(false, name, false, diagnosis, steps, [], [], target.sampleRateOutput);
  }

  if (currentUsers.length > 0) {
    const identifiedProcesses = [...new Map(currentUsers
      .map((user) => readRunningProcess(user.pid))
      .filter((processInfo): processInfo is RunningProcess => processInfo !== null)
      .map((processInfo) => [processInfo.pid, processInfo] as const)).values()];
    const missingUsers = currentUsers.filter((user) => !identifiedProcesses.some((processInfo) => processInfo.pid === user.pid));
    const diagnosis: RecoveryDiagnosis = {
      confidence: missingUsers.length === 0 ? "已确认" : "高度疑似",
      summary: missingUsers.length === 0
        ? "本机程序正在真实读取目标麦克风"
        : "检测到麦克风读取者，但部分进程身份无法复核",
      evidence: currentUsers.map((user) => `${user.name}（进程号 ${user.pid}）正在读取 ${name}`),
    };
    step(steps, "原因定位", missingUsers.length === 0 ? "成功" : "失败", `${diagnosis.confidence}：${diagnosis.summary}`);
    if (missingUsers.length > 0 || identifiedProcesses.length === 0) {
      step(steps, "原因对应处理", "跳过", `${selectRecoveryPolicy(false)}；没有结束任何进程`);
      return result(false, name, false, diagnosis, steps, [], [], currentOutputRate(name));
    }
    step(steps, "处理策略", "成功", selectRecoveryPolicy(true));
    return handleConfirmedProcesses(name, identifiedProcesses, diagnosis, steps);
  }

  const lowRateBluetoothOutputNames = decisionSnapshot.devices
    .filter((device) =>
      device.outputChannels > 0 &&
      device.transport === "bluetooth" &&
      device.sampleRateOutput !== null &&
      device.sampleRateOutput <= 16_000
    )
    .map((device) => device.name);
  const formatCause = diagnoseFormatRequestCause(logEvidence, name, lowRateBluetoothOutputNames);
  const diagnosis: RecoveryDiagnosis = {
    confidence: formatCause.confidence,
    summary: formatCause.request
      ? formatCause.confidence === "已确认"
        ? "程序提交蓝牙输入格式请求并在两秒内触发 tsco"
        : "已定位格式请求者，但当前证据链不完整"
      : "最近日志没有定位到当前 HFP 的具体请求进程",
    evidence: formatCauseEvidence(formatCause, logEvidence.windowMinutes),
  };
  step(steps, "原因定位", formatCause.confidence === "已确认" ? "成功" : "失败", `${diagnosis.confidence}：${diagnosis.summary}`);

  if (formatCause.confidence !== "已确认" || !formatCause.requester) {
    step(steps, "原因对应处理", "跳过", `${selectRecoveryPolicy(false)}；没有结束候选进程，也没有执行兜底`);
    return result(false, name, false, diagnosis, steps, [], [], currentOutputRate(name));
  }

  step(steps, "处理策略", "成功", selectRecoveryPolicy(true));
  return handleConfirmedProcesses(name, [formatCause.requester], diagnosis, steps);
}
