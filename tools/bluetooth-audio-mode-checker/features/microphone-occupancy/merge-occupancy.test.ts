import test from "node:test";
import assert from "node:assert/strict";

import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";
import {
  attachEmptyMicrophoneOccupancy,
  mergeMicrophoneOccupancy,
  shouldContinueOccupancyScanning,
  shouldStartOccupancyScanForInputActivity,
} from "./index.ts";

function device(overrides: Partial<AudioModeAssessment>): AudioModeAssessment {
  return {
    name: "REDMI",
    mode: "A2DP",
    label: "A2DP",
    confidence: "high",
    evidence: [],
    explanation: "",
    isActive: true,
    isInputActive: false,
    inputTransport: "bluetooth",
    bluetoothAddress: "50-C0-F0-F3-6A-66",
    audioLinkType: "tacl",
    audioLinkTypeObservedAt: "2026-07-20T12:00:00.000Z",
    sampleRateOutput: 44_100,
    availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
    nominalSampleRateOutput: 44_100,
    actualSampleRateOutput: 44_100,
    maxSupportedOutputRate: 44_100,
    outputChannels: 2,
    sampleRateInput: 16_000,
    availableSampleRateRangesInput: [{ minimum: 16_000, maximum: 16_000 }],
    nominalSampleRateInput: 16_000,
    actualSampleRateInput: 16_000,
    inputChannels: 1,
    isDefaultInput: true,
    isDefaultOutput: true,
    isDefaultSystemOutput: false,
    ...overrides,
  };
}

test("占用扫描不得用旧 A2DP 状态覆盖实时 HFP 状态", () => {
  const current = device({ mode: "HFP_HSP", label: "HFP", sampleRateOutput: 16_000, outputChannels: 1 });
  const staleScan = device({
    mode: "A2DP",
    sampleRateOutput: 44_100,
    microphoneOccupancy: {
      isInUse: true,
      users: [{ pid: 42, name: "Codex", bundleId: "com.openai.codex", devices: ["REDMI"] }],
      multipointSupport: "unknown",
      multipointExplanation: "",
      remoteReleaseSupported: false,
      remoteReleaseExplanation: "",
    },
  });

  const [merged] = mergeMicrophoneOccupancy([current], [staleScan]);

  assert.equal(merged.mode, "HFP_HSP");
  assert.equal(merged.sampleRateOutput, 16_000);
  assert.equal(merged.outputChannels, 1);
  assert.equal(merged.microphoneOccupancy?.isInUse, true);
});

test("没有占用程序时必须停止占用扫描", () => {
  const devices = attachEmptyMicrophoneOccupancy([device("HFP_HSP", 16_000)]);
  assert.equal(shouldContinueOccupancyScanning(devices), false);
});

test("仍有占用程序时继续扫描直到释放", () => {
  const devices = [{
    ...device("HFP_HSP", 16_000),
    microphoneOccupancy: {
      isInUse: true,
      users: [{ pid: 42, name: "语音程序", bundleId: "test.voice", devices: ["耳机"] }],
      multipointSupport: "unknown" as const,
      multipointExplanation: "未知",
      remoteReleaseSupported: false,
      remoteReleaseExplanation: "不支持",
    },
  }];
  assert.equal(shouldContinueOccupancyScanning(devices), true);
});

test("读取者无法归属到蓝牙设备时仍必须继续全局占用扫描", () => {
  const devices = attachEmptyMicrophoneOccupancy([device({ mode: "HFP_HSP", sampleRateOutput: 16_000 })]);
  const unassignedUsers = [{ pid: 80530, name: "replayd", bundleId: "", devices: [] }];

  assert.equal(shouldContinueOccupancyScanning(devices, unassignedUsers), true);
});

test("默认输入从空闲变为运行时触发一次占用扫描", () => {
  assert.equal(shouldStartOccupancyScanForInputActivity(
    { name: "蓝牙麦克风", isRunning: false },
    { name: "蓝牙麦克风", isRunning: true },
  ), true);
});

test("默认输入持续运行时不重复触发占用扫描", () => {
  assert.equal(shouldStartOccupancyScanForInputActivity(
    { name: "蓝牙麦克风", isRunning: true },
    { name: "蓝牙麦克风", isRunning: true },
  ), false);
});

test("监听启动时发现默认输入已运行也触发占用扫描", () => {
  assert.equal(shouldStartOccupancyScanForInputActivity(
    null,
    { name: "蓝牙麦克风", isRunning: true },
  ), true);
});
