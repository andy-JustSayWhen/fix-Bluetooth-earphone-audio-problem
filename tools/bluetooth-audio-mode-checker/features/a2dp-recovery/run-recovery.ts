import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { requestOutputSampleRate } from "../../core/macos-audio-format/index.ts";
import { reconnectBluetoothDevice } from "../../core/macos-bluetooth-link/index.ts";
import { setDefaultAudioDevice } from "../../core/macos-audio-route/index.ts";
import { readMicrophoneUsers, releaseMicrophoneUser } from "../../core/macos-microphone-usage/index.ts";
import { isApplicationRunning } from "../../core/macos-running-apps/index.ts";
import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import type { A2dpRecoveryResult, RecoveryDiagnosis, RecoveryStep } from "./index.ts";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function outputDevice(name: string): RawAudioDevice | undefined {
  return readAudioDevices().devices.find((device) =>
    device.name === name && device.outputChannels > 0
  );
}

function currentOutputRate(name: string): number | null {
  const output = outputDevice(name);
  return output?.isDefaultOutput ? output.sampleRateOutput : null;
}

function priority(device: RawAudioDevice): number {
  if (device.transport === "built-in") return 5;
  if (device.transport === "usb" || device.transport === "display-port") return 4;
  if (device.transport === "virtual") return 3;
  if (device.transport !== "bluetooth" && device.transport !== "bluetooth-le") return 2;
  return 1;
}

function fallbackDevice(
  devices: RawAudioDevice[],
  direction: "input" | "output",
  excludedName: string,
  allowBluetooth: boolean,
): RawAudioDevice | undefined {
  const channelsKey = direction === "input" ? "inputChannels" : "outputChannels";
  return devices
    .filter((device) =>
      device.name !== excludedName &&
      device[channelsKey] > 0 &&
      (allowBluetooth || (device.transport !== "bluetooth" && device.transport !== "bluetooth-le"))
    )
    .sort((left, right) => priority(right) - priority(left))[0];
}

async function verifyStableHighRate(name: string, attempts = 4): Promise<number | null> {
  let consecutive = 0;
  let rate: number | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    rate = currentOutputRate(name);
    consecutive = rate !== null && rate > 16_000 ? consecutive + 1 : 0;
    if (consecutive >= 2) return rate;
    await wait(500);
  }
  return rate !== null && rate > 16_000 && consecutive >= 2 ? rate : null;
}

async function waitForOutput(name: string): Promise<boolean> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (outputDevice(name)) return true;
    await wait(250);
  }
  return false;
}

function step(
  steps: RecoveryStep[],
  stage: string,
  status: RecoveryStep["status"],
  detail: string,
  sampleRate?: number | null,
): void {
  steps.push({ stage, status, detail, sampleRate });
}

function result(
  ok: boolean,
  name: string,
  diagnosis: RecoveryDiagnosis,
  steps: RecoveryStep[],
  releasedPrograms: string[],
  remainingPrograms: string[],
  usedReconnect: boolean,
  sampleRate: number | null,
): A2dpRecoveryResult {
  return {
    ok,
    sampleRate,
    releasedPrograms,
    remainingPrograms,
    diagnosis,
    steps,
    usedReconnect,
    message: ok
      ? `已恢复高音质输出，当前采样率为 ${(sampleRate ?? 0) / 1000} kHz。`
      : `${name} 未能恢复到高于 16 kHz 的稳定输出。`,
  };
}

export async function runRecovery(name: string): Promise<A2dpRecoveryResult> {
  const steps: RecoveryStep[] = [];
  const initialSnapshot = readAudioDevices();
  let target = initialSnapshot.devices.find((device) => device.name === name && device.outputChannels > 0);
  const soundSourceRunning = isApplicationRunning("SoundSource");
  const initialUsers = readMicrophoneUsers().filter((user) => user.devices.includes(name));
  const evidence: string[] = [];
  let diagnosis: RecoveryDiagnosis;

  if (!target) {
    diagnosis = { confidence: "已确认", summary: "目标设备的输出端点已经断开", evidence: ["系统设备列表中不存在目标输出端点"] };
  } else if (initialUsers.length > 0) {
    evidence.push(`检测到 ${initialUsers.map((user) => user.name).join("、")} 正在读取目标麦克风`);
    diagnosis = { confidence: "已确认", summary: "本机程序正在占用目标麦克风", evidence };
  } else if (target.isDefaultInput) {
    evidence.push("目标设备仍是当前默认输入，但未检测到本机读取者");
    diagnosis = { confidence: "高度疑似", summary: "通话链路或默认输入状态残留", evidence };
  } else {
    diagnosis = { confidence: "无法确认", summary: "未发现可直接证明的本机原因", evidence: ["可能存在系统链路残留或非本机占用"] };
  }
  if (soundSourceRunning) diagnosis.evidence.push("检测到 SoundSource 正在运行，可能保留旧应用输出通道");

  if (!target) {
    step(steps, "现场诊断", "成功", "确认目标设备输出端点已经消失");
    return reconnectAndFinish(name, diagnosis, steps, [], [], null);
  }

  if (!target.isDefaultOutput) {
    setDefaultAudioDevice("output", name);
    step(steps, "恢复默认输出", "成功", "已将目标设备设为默认输出");
    await wait(500);
  }

  for (const user of initialUsers) releaseMicrophoneUser(user.pid);
  let remaining = initialUsers;
  for (let attempt = 0; attempt < 10 && remaining.length > 0; attempt += 1) {
    await wait(100);
    remaining = readMicrophoneUsers().filter((user) => user.devices.includes(name));
  }
  const releasedPrograms = initialUsers
    .filter((user) => !remaining.some((item) => item.pid === user.pid))
    .map((user) => user.name);
  if (remaining.length > 0) {
    step(steps, "解除麦克风占用", "失败", `仍有程序正在读取麦克风：${remaining.map((user) => user.name).join("、")}`);
  } else if (initialUsers.length > 0) {
    step(steps, "解除麦克风占用", "成功", `已停止：${releasedPrograms.join("、")}`);
  } else {
    step(steps, "解除麦克风占用", "跳过", "未检测到本机麦克风占用");
  }

  const inputFallback = fallbackDevice(initialSnapshot.devices, "input", name, false);
  if (target.isDefaultInput && inputFallback) {
    setDefaultAudioDevice("input", inputFallback.name);
    step(steps, "切换默认输入", "成功", `已切换到 ${inputFallback.name}`);
  } else if (target.isDefaultInput) {
    step(steps, "切换默认输入", "跳过", "没有可用的非蓝牙输入，保留当前输入并继续恢复");
  } else {
    step(steps, "切换默认输入", "跳过", "目标设备不是当前默认输入");
  }

  await wait(1_500);
  let rate = await verifyStableHighRate(name);
  if (rate !== null) {
    step(steps, "等待系统自行恢复", "成功", "实际输出已连续两次高于 16 kHz", rate);
    return result(true, name, diagnosis, steps, releasedPrograms, remaining.map((user) => user.name), false, rate);
  }
  step(steps, "等待系统自行恢复", "失败", "实际输出未稳定高于 16 kHz", currentOutputRate(name));

  target = outputDevice(name) ?? target;
  const desiredRate = target.maxSupportedOutputRate ?? 0;
  if (desiredRate > 16_000) {
    try {
      requestOutputSampleRate(name, desiredRate);
      step(steps, "请求高采样率", "成功", `已请求 ${desiredRate / 1000} kHz，等待系统确认`);
    } catch {
      step(steps, "请求高采样率", "失败", "系统或设备驱动未接受采样率请求");
    }
    rate = await verifyStableHighRate(name);
    if (rate !== null) return result(true, name, diagnosis, steps, releasedPrograms, [], false, rate);
  } else {
    step(steps, "请求高采样率", "跳过", "无法读取高于 16 kHz 的可请求采样率");
  }

  const latestDevices = readAudioDevices().devices;
  const outputFallback = fallbackDevice(latestDevices, "output", name, true);
  if (outputFallback) {
    try {
      setDefaultAudioDevice("output", outputFallback.name);
      await wait(1_500);
      setDefaultAudioDevice("output", name);
      step(steps, "重建声音路由", "成功", `已临时切换到 ${outputFallback.name} 后切回`);
    } catch {
      step(steps, "重建声音路由", "失败", "临时输出切换未完成");
    }
    rate = await verifyStableHighRate(name);
    if (rate !== null) return result(true, name, diagnosis, steps, releasedPrograms, [], false, rate);
  } else {
    step(steps, "重建声音路由", "跳过", "没有任何其他输出设备，继续最后兜底");
  }

  return reconnectAndFinish(name, diagnosis, steps, releasedPrograms, [], currentOutputRate(name));
}

async function reconnectAndFinish(
  name: string,
  diagnosis: RecoveryDiagnosis,
  steps: RecoveryStep[],
  releasedPrograms: string[],
  remainingPrograms: string[],
  previousRate: number | null,
): Promise<A2dpRecoveryResult> {
  try {
    reconnectBluetoothDevice(name);
    if (!await waitForOutput(name)) {
      step(steps, "断开并重新连接", "失败", "设备已尝试重连，但输出端点没有重新出现");
      return result(false, name, diagnosis, steps, releasedPrograms, remainingPrograms, true, previousRate);
    }
    setDefaultAudioDevice("output", name);
    step(steps, "断开并重新连接", "成功", "设备已重新连接并恢复为默认输出");
  } catch {
    step(steps, "断开并重新连接", "失败", "设备未能自动重新连接，需要手动连接");
    return result(false, name, diagnosis, steps, releasedPrograms, remainingPrograms, true, previousRate);
  }
  const rate = await verifyStableHighRate(name, 8);
  return result(rate !== null, name, diagnosis, steps, releasedPrograms, remainingPrograms, true, rate);
}
