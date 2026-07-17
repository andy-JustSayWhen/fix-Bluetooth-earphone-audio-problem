import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { reconnectBluetoothDevice } from "../../core/macos-bluetooth-link/index.ts";
import { setDefaultAudioDevice } from "../../core/macos-audio-route/index.ts";
import { readOutputVolume, synchronizeOutputVolume } from "../../core/macos-audio-volume/index.ts";
import { readMicrophoneUsers } from "../../core/macos-microphone-usage/index.ts";
import { isApplicationRunning } from "../../core/macos-running-apps/index.ts";
import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import type { A2dpRecoveryResult, RecoveryDiagnosis, RecoveryStep } from "./index.ts";
import { selectRecoveryPolicy } from "./recovery-policy.ts";
import { detailedLog } from "../../core/detailed-logging/index.ts";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  recoveryPath: A2dpRecoveryResult["recoveryPath"],
  diagnosis: RecoveryDiagnosis,
  steps: RecoveryStep[],
  releasedPrograms: string[],
  remainingPrograms: string[],
  usedReconnect: boolean,
  sampleRate: number | null,
): A2dpRecoveryResult {
  const recoveryResult: A2dpRecoveryResult = {
    ok,
    recoveryPath,
    sampleRate,
    releasedPrograms,
    remainingPrograms,
    diagnosis,
    steps,
    usedReconnect,
    message: ok
      ? `系统端点已稳定恢复为高采样率，当前为 ${(sampleRate ?? 0) / 1000} kHz；请以实际听感确认播放器已经出声。`
      : remainingPrograms.length > 0
        ? `暂时无法恢复：${remainingPrograms.join("、")} 仍在读取目标麦克风。请先结束语音输入，再重新执行恢复。`
        : usedReconnect
          ? `恢复失败：最后兜底后，${name} 仍未恢复到高于 16 kHz 的稳定输出。`
          : `恢复失败：${name} 未恢复到高于 16 kHz 的稳定输出。`,
  };
  detailedLog(ok ? "info" : "error", "a2dp-recovery.completed", { deviceName: name, result: recoveryResult });
  return recoveryResult;
}

export async function runRecovery(name: string): Promise<A2dpRecoveryResult> {
  recoveryDeviceName = name;
  detailedLog("info", "a2dp-recovery.started", { deviceName: name });
  const steps: RecoveryStep[] = [];
  const initialSnapshot = readAudioDevices();
  const initialVolume = readOutputVolume();
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
  detailedLog("info", "a2dp-recovery.diagnosed", {
    deviceName: name,
    diagnosis,
    soundSourceRunning,
    microphoneUsers: initialUsers,
    initialOutputRate: target?.sampleRateOutput ?? null,
  });

  if (!target) {
    step(steps, "现场诊断", "成功", "确认目标设备输出端点已经消失");
    step(steps, "原因对应恢复", "跳过", "设备已断开，直接进入最后兜底");
    return reconnectAndFinish(name, "原因对应恢复", diagnosis, steps, [], [], null);
  }

  if (!target.isDefaultOutput) {
    setDefaultAudioDevice("output", name);
    step(steps, "恢复默认输出", "成功", "已将目标设备设为默认输出");
    await wait(500);
  }

  if (initialUsers.length > 0) {
    step(
      steps,
      "原因对应恢复",
      "失败",
      `检测到 ${initialUsers.map((user) => user.name).join("、")} 仍在读取目标麦克风；占用存在时不执行断开重连，也不判定 A2DP 恢复成功`,
    );
    return result(
      false,
      name,
      "原因对应恢复",
      diagnosis,
      steps,
      [],
      initialUsers.map((user) => user.name),
      false,
      currentOutputRate(name),
    );
  }

  step(steps, "恢复路径", "成功", `未命中已确认原因：${selectRecoveryPolicy(false, false)}`);
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
    synchronizeOutputVolume(initialVolume);
    step(steps, "同步输出音量", "成功", `已将 A2DP 端点音量重新同步为恢复前的 ${initialVolume.volume}%`);
    rate = await verifyStableHighRate(name);
    if (rate !== null) {
      step(steps, "等待系统自行恢复", "成功", "音量同步后，实际输出仍连续六次高于 16 kHz", rate);
      return result(true, name, "逐方法尝试", diagnosis, steps, [], [], false, rate);
    }
    step(steps, "音量同步后复核", "失败", "音量同步后输出采样率再次回落，继续下一种恢复方法", currentOutputRate(name));
  }
  step(steps, "等待系统自行恢复", "失败", "实际输出未稳定高于 16 kHz", currentOutputRate(name));

  try {
    setDefaultAudioDevice("output", name);
    step(steps, "重新评估输出路由", "成功", "已重新向系统提交当前默认输出，等待系统重新评估音频链路");
  } catch {
    step(steps, "重新评估输出路由", "失败", "系统未接受当前输出路由的重新提交");
  }
  rate = await verifyStableHighRate(name);
  if (rate !== null) {
    synchronizeOutputVolume(initialVolume);
    step(steps, "同步输出音量", "成功", `已将 A2DP 端点音量重新同步为恢复前的 ${initialVolume.volume}%`);
    rate = await verifyStableHighRate(name);
    if (rate !== null) return result(true, name, "逐方法尝试", diagnosis, steps, [], [], false, rate);
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
    if (rate !== null) {
      synchronizeOutputVolume(initialVolume);
      step(steps, "同步输出音量", "成功", `已将 A2DP 端点音量重新同步为恢复前的 ${initialVolume.volume}%`);
      rate = await verifyStableHighRate(name);
      if (rate !== null) return result(true, name, "逐方法尝试", diagnosis, steps, [], [], false, rate);
    }
  } else {
    step(steps, "重建声音路由", "跳过", "没有任何其他输出设备，继续最后兜底");
  }

  return reconnectAndFinish(name, "逐方法尝试", diagnosis, steps, [], [], currentOutputRate(name), initialVolume);
}

async function reconnectAndFinish(
  name: string,
  recoveryPath: A2dpRecoveryResult["recoveryPath"],
  diagnosis: RecoveryDiagnosis,
  steps: RecoveryStep[],
  releasedPrograms: string[],
  remainingPrograms: string[],
  previousRate: number | null,
  initialVolume = readOutputVolume(),
): Promise<A2dpRecoveryResult> {
  try {
    reconnectBluetoothDevice(name);
    if (!await waitForOutput(name)) {
      step(steps, "断开并重新连接", "失败", "设备已尝试重连，但输出端点没有重新出现");
      return result(false, name, recoveryPath, diagnosis, steps, releasedPrograms, remainingPrograms, true, previousRate);
    }
    setDefaultAudioDevice("output", name);
    step(steps, "断开并重新连接", "成功", "设备已重新连接并恢复为默认输出");
  } catch {
    step(steps, "断开并重新连接", "失败", "设备未能自动重新连接，需要手动连接");
    return result(false, name, recoveryPath, diagnosis, steps, releasedPrograms, remainingPrograms, true, previousRate);
  }
  let rate = await verifyStableHighRate(name, 12);
  if (rate === null) step(steps, "最终验证", "失败", "最后兜底后仍未连续六次高于 16 kHz", currentOutputRate(name));
  if (rate !== null) {
    synchronizeOutputVolume(initialVolume);
    step(steps, "同步输出音量", "成功", `已将 A2DP 端点音量重新同步为恢复前的 ${initialVolume.volume}%`);
    rate = await verifyStableHighRate(name);
  }
  return result(rate !== null, name, recoveryPath, diagnosis, steps, releasedPrograms, remainingPrograms, true, rate);
}
