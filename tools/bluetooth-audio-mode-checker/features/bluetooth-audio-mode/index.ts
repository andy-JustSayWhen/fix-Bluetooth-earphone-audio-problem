import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { startActiveOutputMonitor } from "../../core/macos-audio-events/index.ts";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AudioModeState,
  AudioModeAssessment,
  AudioRouteOption,
  ActiveOutputSnapshot,
  RawAudioDevice,
} from "../../shared/audio-device-types/index.ts";

type DeviceGroup = {
  name: string;
  devices: RawAudioDevice[];
};

type AssessmentFacts = Omit<
  AudioModeAssessment,
  "mode" | "label" | "confidence" | "evidence" | "explanation"
>;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const webAssetsDirectory = join(moduleDirectory, "web");

function isBluetooth(device: RawAudioDevice): boolean {
  return device.transport === "bluetooth" || device.transport === "bluetooth-le";
}

function chooseOutput(devices: RawAudioDevice[]): RawAudioDevice | undefined {
  return devices
    .filter((device) => device.outputChannels > 0)
    .sort((left, right) =>
      Number(right.isDefaultOutput) - Number(left.isDefaultOutput) ||
      Number(right.isDefaultSystemOutput) - Number(left.isDefaultSystemOutput) ||
      right.outputChannels - left.outputChannels ||
      (right.sampleRateOutput ?? 0) - (left.sampleRateOutput ?? 0)
    )[0];
}

function chooseInput(devices: RawAudioDevice[]): RawAudioDevice | undefined {
  return devices
    .filter((device) => device.inputChannels > 0)
    .sort((left, right) =>
      Number(right.isDefaultInput) - Number(left.isDefaultInput) ||
      Number(right.isRunning) - Number(left.isRunning) ||
      right.inputChannels - left.inputChannels
    )[0];
}

function groupBluetoothDevices(devices: RawAudioDevice[]): DeviceGroup[] {
  const groups = new Map<string, DeviceGroup>();
  for (const device of devices.filter(isBluetooth)) {
    const key = device.name.trim().toLocaleLowerCase();
    const group = groups.get(key) ?? { name: device.name.trim() || "未命名蓝牙设备", devices: [] };
    group.devices.push(device);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function classifyFacts(base: AssessmentFacts): AudioModeAssessment {
  const outputRate = base.sampleRateOutput;
  const maxSupportedOutputRate = base.maxSupportedOutputRate;

  if (!base.isDefaultOutput) {
    return {
      ...base,
      evidence: ["活动参数未刷新：该设备当前未承担声音输出。"],
      mode: "INACTIVE",
      label: "活动参数未刷新",
      confidence: "高",
      explanation: "该设备不是当前默认输出，因此不展示输入、输出采样率或声道。切换为默认输出后，系统监听会立即刷新实际参数。",
    };
  }

  const evidence = [
    `设备支持的最高输出采样率：${maxSupportedOutputRate === null ? "无法读取" : formatRate(maxSupportedOutputRate)}`,
    `当前活动输出采样率：${outputRate === null ? "无法读取" : formatRate(outputRate)}`,
    "判定规则：仅比较以上两个采样率；声道、麦克风、蓝牙服务和链路日志均不参与结论。",
  ];

  if (maxSupportedOutputRate !== null && maxSupportedOutputRate > 16_000 && outputRate !== null && outputRate <= 16_000) {
    return {
      ...base,
      evidence,
      mode: "HFP_HSP",
      label: "HFP/其他非 A2DP 模式",
      confidence: "高",
      explanation: `该设备最高支持 ${formatRate(maxSupportedOutputRate)}，但当前实际输出仅为 ${formatRate(outputRate)}，符合“支持高于 16 kHz、实际不高于 16 kHz”的规则，因此判定已进入 HFP 等非 A2DP 模式。`,
    };
  }

  if (outputRate !== null && outputRate > 16_000) {
    return {
      ...base,
      evidence,
      mode: "A2DP",
      label: "A2DP（高音质播放模式）",
      confidence: "高",
      explanation: `当前实际输出为 ${formatRate(outputRate)}，高于 16 kHz，因此按指定规则判定为 A2DP 模式。`,
    };
  }

  return {
    ...base,
    evidence,
    mode: "UNKNOWN",
    label: "暂时无法判定",
    confidence: "低",
    explanation: outputRate === null
      ? "无法读取当前实际输出采样率，因此不能按指定规则判定。"
      : "当前实际输出不高于 16 kHz，但无法证明该设备支持高于 16 kHz 的输出采样率，因此不强行判定。",
  };
}

function assessGroup(group: DeviceGroup): AudioModeAssessment {
  const output = chooseOutput(group.devices);
  const input = chooseInput(group.devices);
  const outputRate = output?.sampleRateOutput ?? null;
  const reportedMaximumRate = Math.max(
    0,
    ...group.devices.map((device) => device.maxSupportedOutputRate ?? 0),
  );
  const maxSupportedOutputRate = Math.max(reportedMaximumRate, outputRate ?? 0) || null;
  const isDefaultOutput = group.devices.some((device) => device.isDefaultOutput);
  return classifyFacts({
    name: group.name,
    isActive: isDefaultOutput,
    sampleRateOutput: outputRate,
    maxSupportedOutputRate,
    outputChannels: output?.outputChannels ?? 0,
    sampleRateInput: input?.sampleRateInput ?? null,
    inputChannels: input?.inputChannels ?? 0,
    isDefaultInput: group.devices.some((device) => device.isDefaultInput),
    isDefaultOutput,
    isDefaultSystemOutput: group.devices.some((device) => device.isDefaultSystemOutput),
  });
}

export function assessBluetoothDevices(devices: RawAudioDevice[]): AudioModeAssessment[] {
  return groupBluetoothDevices(devices).map(assessGroup);
}

export function formatRate(rate: number): string {
  const value = rate / 1_000;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} kHz`;
}

export function readAndAssess(): AudioModeAssessment[] {
  return assessBluetoothDevices(readAudioDevices().devices);
}

function routeOptions(devices: RawAudioDevice[], direction: "input" | "output"): AudioRouteOption[] {
  const byName = new Map<string, AudioRouteOption>();
  for (const device of devices) {
    const channels = direction === "input" ? device.inputChannels : device.outputChannels;
    if (channels <= 0) continue;
    const option: AudioRouteOption = {
      name: device.name,
      direction,
      transport: device.transport,
      channels,
      sampleRate: direction === "input" ? device.sampleRateInput : device.sampleRateOutput,
      isDefault: direction === "input" ? device.isDefaultInput : device.isDefaultOutput,
    };
    const existing = byName.get(device.name);
    if (!existing || option.isDefault) byName.set(device.name, option);
  }
  return [...byName.values()].sort((left, right) =>
    Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, "zh-CN")
  );
}

export function readAudioModeState(): AudioModeState {
  const devices = readAudioDevices().devices;
  return {
    devices: assessBluetoothDevices(devices),
    routes: {
      input: routeOptions(devices, "input"),
      output: routeOptions(devices, "output"),
    },
  };
}

export function readAudioModeStateAsync(): Promise<AudioModeState> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(moduleDirectory, "state-reader.ts")], {
      cwd: join(moduleDirectory, "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "后台设备扫描失败"));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as AudioModeState);
      } catch {
        reject(new Error("后台设备扫描结果无法读取"));
      }
    });
  });
}

export function applyActiveOutputSnapshot(
  state: AudioModeState,
  snapshot: ActiveOutputSnapshot,
): AudioModeState {
  const sampleRate = snapshot.actualSampleRate && snapshot.actualSampleRate > 0
    ? snapshot.actualSampleRate
    : snapshot.nominalSampleRate && snapshot.nominalSampleRate > 0
      ? snapshot.nominalSampleRate
      : null;
  return {
    devices: state.devices.map((device) => {
      const isDefaultOutput = snapshot.name !== null && device.name === snapshot.name;
      return classifyFacts({
        name: device.name,
        isActive: isDefaultOutput,
        sampleRateOutput: isDefaultOutput ? sampleRate : device.sampleRateOutput,
        maxSupportedOutputRate: device.maxSupportedOutputRate,
        outputChannels: device.outputChannels,
        sampleRateInput: device.sampleRateInput,
        inputChannels: device.inputChannels,
        isDefaultInput: device.isDefaultInput,
        isDefaultOutput,
        isDefaultSystemOutput: device.isDefaultSystemOutput,
        microphoneOccupancy: device.microphoneOccupancy,
      });
    }),
    routes: {
      input: state.routes.input,
      output: state.routes.output.map((route) => ({
        ...route,
        isDefault: snapshot.name !== null && route.name === snapshot.name,
        sampleRate: route.name === snapshot.name ? sampleRate : route.sampleRate,
      })),
    },
  };
}

export function startAudioModeRealtimeMonitor(
  onSnapshot: (snapshot: ActiveOutputSnapshot) => void,
): () => void {
  return startActiveOutputMonitor(onSnapshot);
}

export function selectAssessments(
  assessments: AudioModeAssessment[],
  nameFragment?: string,
): AudioModeAssessment[] {
  if (!nameFragment) {
    return assessments;
  }
  const normalized = nameFragment.trim().toLocaleLowerCase();
  return assessments.filter((assessment) =>
    assessment.name.toLocaleLowerCase().includes(normalized)
  );
}

export function formatAssessment(assessment: AudioModeAssessment): string {
  const route = [
    assessment.isDefaultOutput ? "当前默认输出" : null,
    assessment.isDefaultInput ? "当前默认输入" : null,
    assessment.isDefaultSystemOutput ? "系统提示音输出" : null,
  ].filter(Boolean).join("、") || "已连接，非默认设备";

  return [
    `设备：${assessment.name}`,
    `判定：${assessment.label}`,
    `把握：${assessment.confidence}`,
    `状态：${route}`,
    "依据：",
    ...assessment.evidence.map((item) => `  - ${item}`),
    `说明：${assessment.explanation}`,
  ].join("\n");
}
