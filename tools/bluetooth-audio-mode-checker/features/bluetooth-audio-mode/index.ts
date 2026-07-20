import { readAudioDevices } from "../../core/macos-audio-probe/index.ts";
import { startActiveOutputMonitor } from "../../core/macos-audio-events/index.ts";
import { startBluetoothLinkMonitor } from "../../core/macos-bluetooth-link/index.ts";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ActiveInputSnapshot,
  BluetoothLinkSnapshot,
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
  const maxAvailableOutputRate = Math.max(
    0,
    ...base.availableSampleRateRangesOutput.map((range) => range.maximum),
  ) || null;
  const supportsHighRate = maxAvailableOutputRate !== null && maxAvailableOutputRate > 16_000;
  const nominalIsLow = base.nominalSampleRateOutput !== null && base.nominalSampleRateOutput <= 16_000;
  const actualIsLow = base.actualSampleRateOutput !== null && base.actualSampleRateOutput <= 16_000;
  const evidence = [
    `输出可用最高采样率：${maxAvailableOutputRate === null ? "无法读取" : formatRate(maxAvailableOutputRate)}`,
    `输出标称采样率：${base.nominalSampleRateOutput === null ? "无法读取" : formatRate(base.nominalSampleRateOutput)}`,
    `输出实际采样率：${base.actualSampleRateOutput === null ? "无法读取" : formatRate(base.actualSampleRateOutput)}`,
    `输出声道：${base.outputChannels > 0 ? `${base.outputChannels} 声道` : "无法读取"}`,
    `设备最新声音链路：${base.audioLinkType ?? "无法确认"}`,
  ];

  if (base.audioLinkType === "tsco") {
    return {
      ...base,
      evidence,
      mode: "HFP_HSP",
      label: "HFP等模式（低音质语音模式）",
      confidence: "高",
      explanation: "该设备最新的独立链路事实仍为 tsco，因此直接判定为 HFP/HSP 等低音质语音模式。",
    };
  }

  if (supportsHighRate && (nominalIsLow || actualIsLow)) {
    return {
      ...base,
      evidence,
      mode: "HFP_HSP",
      label: "HFP等模式（低音质语音模式）",
      confidence: "高",
      explanation: "该输出端点可用采样率包含高于 16 kHz 的值，但标称或实际采样率不高于 16 kHz，因此判定为 HFP/HSP 等低音质语音模式。",
    };
  }

  if (base.actualSampleRateOutput !== null && base.actualSampleRateOutput > 16_000 && base.outputChannels >= 2) {
    return {
      ...base,
      evidence,
      mode: "A2DP",
      label: "A2DP等模式（高音质播放模式）",
      confidence: "高",
      explanation: "输出实际采样率高于 16 kHz，且输出端点不少于 2 声道，因此判定为 A2DP 等高音质播放模式。",
    };
  }

  return {
    ...base,
    evidence,
    mode: "UNKNOWN",
    label: "模式无法确认",
    confidence: "低",
    explanation: "最新输出端点事实没有组成 HFP/HSP 或 A2DP 的完整条件，因此不强行归类。",
  };
}

function positiveRate(rate: number | null | undefined): number | null {
  return rate !== null && rate !== undefined && rate > 0 ? rate : null;
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
  const bluetoothAddress = output?.bluetoothAddress ?? input?.bluetoothAddress ??
    group.devices.find((device) => device.bluetoothAddress)?.bluetoothAddress ?? null;
  return classifyFacts({
    name: group.name,
    isActive: isDefaultOutput,
    isInputActive: false,
    inputTransport: input?.transport ?? null,
    bluetoothAddress,
    audioLinkType: null,
    audioLinkTypeObservedAt: null,
    sampleRateOutput: outputRate,
    availableSampleRateRangesOutput: output?.availableSampleRateRangesOutput ?? [],
    nominalSampleRateOutput: output?.nominalSampleRateOutput ?? outputRate,
    actualSampleRateOutput: output?.actualSampleRateOutput ?? null,
    maxSupportedOutputRate,
    outputChannels: output?.outputChannels ?? 0,
    sampleRateInput: input?.sampleRateInput ?? null,
    availableSampleRateRangesInput: input?.availableSampleRateRangesInput ?? [],
    nominalSampleRateInput: input?.nominalSampleRateInput ?? input?.sampleRateInput ?? null,
    actualSampleRateInput: input?.actualSampleRateInput ?? null,
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
  const nominalSampleRate = positiveRate(snapshot.nominalSampleRate);
  const actualSampleRate = positiveRate(snapshot.actualSampleRate);
  const sampleRate = actualSampleRate ?? nominalSampleRate;
  return {
    devices: state.devices.map((device) => {
      const isDefaultOutput = snapshot.name !== null && device.name === snapshot.name;
      return classifyFacts({
        name: device.name,
        isActive: isDefaultOutput || device.isInputActive,
        isInputActive: device.isInputActive,
        inputTransport: device.inputTransport,
        bluetoothAddress: device.bluetoothAddress,
        audioLinkType: device.audioLinkType,
        audioLinkTypeObservedAt: device.audioLinkTypeObservedAt,
        sampleRateOutput: isDefaultOutput ? sampleRate : device.sampleRateOutput,
        availableSampleRateRangesOutput: device.availableSampleRateRangesOutput,
        nominalSampleRateOutput: isDefaultOutput
          ? nominalSampleRate
          : device.nominalSampleRateOutput,
        actualSampleRateOutput: isDefaultOutput
          ? actualSampleRate
          : device.actualSampleRateOutput,
        maxSupportedOutputRate: device.maxSupportedOutputRate,
        outputChannels: isDefaultOutput && snapshot.outputChannels !== undefined
          ? snapshot.outputChannels
          : device.outputChannels,
        sampleRateInput: device.sampleRateInput,
        availableSampleRateRangesInput: device.availableSampleRateRangesInput,
        nominalSampleRateInput: device.nominalSampleRateInput,
        actualSampleRateInput: device.actualSampleRateInput,
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

export function applyActiveInputSnapshot(
  state: AudioModeState,
  snapshot: ActiveInputSnapshot,
): AudioModeState {
  const nominalSampleRate = positiveRate(snapshot.nominalSampleRate);
  const actualSampleRate = positiveRate(snapshot.actualSampleRate);
  const sampleRate = actualSampleRate ?? nominalSampleRate;
  return {
    devices: state.devices.map((device) => {
      const isInputActive = snapshot.isRunning && snapshot.name !== null && device.name === snapshot.name;
      return classifyFacts({
        name: device.name,
        isActive: device.isDefaultOutput || isInputActive,
        isInputActive,
        inputTransport: device.inputTransport,
        bluetoothAddress: device.bluetoothAddress,
        audioLinkType: device.audioLinkType,
        audioLinkTypeObservedAt: device.audioLinkTypeObservedAt,
        sampleRateOutput: device.sampleRateOutput,
        availableSampleRateRangesOutput: device.availableSampleRateRangesOutput,
        nominalSampleRateOutput: device.nominalSampleRateOutput,
        actualSampleRateOutput: device.actualSampleRateOutput,
        maxSupportedOutputRate: device.maxSupportedOutputRate,
        outputChannels: device.outputChannels,
        sampleRateInput: isInputActive && sampleRate !== null ? sampleRate : device.sampleRateInput,
        availableSampleRateRangesInput: device.availableSampleRateRangesInput,
        nominalSampleRateInput: snapshot.name !== null && device.name === snapshot.name
          ? nominalSampleRate
          : device.nominalSampleRateInput,
        actualSampleRateInput: snapshot.name !== null && device.name === snapshot.name
          ? actualSampleRate
          : device.actualSampleRateInput,
        inputChannels: device.inputChannels,
        isDefaultInput: snapshot.name !== null && device.name === snapshot.name,
        isDefaultOutput: device.isDefaultOutput,
        isDefaultSystemOutput: device.isDefaultSystemOutput,
        microphoneOccupancy: device.microphoneOccupancy,
      });
    }),
    routes: {
      input: state.routes.input.map((route) => ({
        ...route,
        isDefault: snapshot.name !== null && route.name === snapshot.name,
        sampleRate: route.name === snapshot.name && sampleRate !== null ? sampleRate : route.sampleRate,
      })),
      output: state.routes.output,
    },
  };
}

function normalizeBluetoothAddress(address: string | null): string {
  return (address ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

export function applyBluetoothLinkSnapshot(
  state: AudioModeState,
  snapshot: BluetoothLinkSnapshot,
): AudioModeState {
  const address = normalizeBluetoothAddress(snapshot.address);
  return {
    ...state,
    devices: state.devices.map((device) => {
      if (!address || normalizeBluetoothAddress(device.bluetoothAddress) !== address) return device;
      if (device.audioLinkTypeObservedAt &&
          Date.parse(device.audioLinkTypeObservedAt) > Date.parse(snapshot.timestamp)) return device;
      return classifyFacts({
        name: device.name,
        isActive: device.isActive,
        isInputActive: device.isInputActive,
        inputTransport: device.inputTransport,
        bluetoothAddress: device.bluetoothAddress,
        audioLinkType: snapshot.profile,
        audioLinkTypeObservedAt: snapshot.timestamp,
        sampleRateOutput: device.sampleRateOutput,
        availableSampleRateRangesOutput: device.availableSampleRateRangesOutput,
        nominalSampleRateOutput: device.nominalSampleRateOutput,
        actualSampleRateOutput: device.actualSampleRateOutput,
        maxSupportedOutputRate: device.maxSupportedOutputRate,
        outputChannels: device.outputChannels,
        sampleRateInput: device.sampleRateInput,
        availableSampleRateRangesInput: device.availableSampleRateRangesInput,
        nominalSampleRateInput: device.nominalSampleRateInput,
        actualSampleRateInput: device.actualSampleRateInput,
        inputChannels: device.inputChannels,
        isDefaultInput: device.isDefaultInput,
        isDefaultOutput: device.isDefaultOutput,
        isDefaultSystemOutput: device.isDefaultSystemOutput,
        microphoneOccupancy: device.microphoneOccupancy,
      });
    }),
  };
}

export function startAudioModeRealtimeMonitor(
  onSnapshot: (snapshot: ActiveOutputSnapshot) => void,
): () => void {
  return startActiveOutputMonitor(onSnapshot);
}

export function startAudioModeLinkMonitor(
  onSnapshot: (snapshot: BluetoothLinkSnapshot) => void,
): () => void {
  return startBluetoothLinkMonitor(onSnapshot);
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
