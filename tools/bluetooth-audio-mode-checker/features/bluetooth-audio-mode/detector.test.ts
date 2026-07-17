import assert from "node:assert/strict";
import test from "node:test";

import {
  applyActiveOutputSnapshot,
  assessBluetoothDevices,
} from "./index.ts";

import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";

function device(overrides: Partial<RawAudioDevice>): RawAudioDevice {
  return {
    id: 1,
    name: "测试耳机",
    uid: "test-device",
    manufacturer: "测试厂商",
    transport: "bluetooth",
    sampleRateInput: null,
    sampleRateOutput: null,
    maxSupportedOutputRate: null,
    inputChannels: 0,
    outputChannels: 0,
    isRunning: false,
    isDefaultInput: false,
    isDefaultOutput: false,
    isDefaultSystemOutput: false,
    supportedBluetoothServices: ["HFP", "A2DP"],
    ...overrides,
  };
}

test("最高支持高于 16 kHz 且当前不高于 16 kHz 时判定为非 A2DP", () => {
  const [result] = assessBluetoothDevices([
    device({
      maxSupportedOutputRate: 48_000,
      sampleRateOutput: 16_000,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(result.mode, "HFP_HSP");
  assert.equal(result.maxSupportedOutputRate, 48_000);
  assert.match(result.explanation, /支持高于 16 kHz、实际不高于 16 kHz/);
});

test("当前输出高于 16 kHz 时判定为 A2DP", () => {
  const [result] = assessBluetoothDevices([
    device({
      maxSupportedOutputRate: 48_000,
      sampleRateOutput: 44_100,
      outputChannels: 1,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(result.mode, "A2DP");
  assert.equal(result.confidence, "高");
});

test("声道和默认麦克风不改变低采样率判定", () => {
  const [result] = assessBluetoothDevices([
    device({
      maxSupportedOutputRate: 44_100,
      sampleRateOutput: 16_000,
      outputChannels: 2,
      inputChannels: 1,
      sampleRateInput: 48_000,
      isDefaultInput: true,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(result.mode, "HFP_HSP");
});

test("无法证明设备支持高于 16 kHz 时不强行判定", () => {
  const [result] = assessBluetoothDevices([
    device({
      maxSupportedOutputRate: 16_000,
      sampleRateOutput: 16_000,
      outputChannels: 1,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(result.mode, "UNKNOWN");
});

test("无法读取当前输出采样率时不强行判定", () => {
  const [result] = assessBluetoothDevices([
    device({ maxSupportedOutputRate: 48_000, isDefaultOutput: true }),
  ]);
  assert.equal(result.mode, "UNKNOWN");
});

test("当前实际采样率本身可以证明设备支持高于 16 kHz", () => {
  const [result] = assessBluetoothDevices([
    device({ sampleRateOutput: 44_100, outputChannels: 2, isDefaultOutput: true }),
  ]);
  assert.equal(result.mode, "A2DP");
  assert.equal(result.maxSupportedOutputRate, 44_100);
});

test("非默认输出设备的待机采样率不用于模式判定", () => {
  const [result] = assessBluetoothDevices([
    device({
      sampleRateOutput: 44_100,
      maxSupportedOutputRate: 44_100,
      outputChannels: 2,
      isDefaultInput: true,
    }),
  ]);
  assert.equal(result.mode, "INACTIVE");
  assert.equal(result.label, "活动参数未刷新");
  assert.match(result.explanation, /不展示输入、输出采样率或声道/);
});

test("实时输出事件会切换活动设备并立即重新判定", () => {
  const devices = assessBluetoothDevices([
    device({
      name: "耳机",
      sampleRateOutput: 44_100,
      maxSupportedOutputRate: 44_100,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
    device({
      id: 2,
      name: "音箱",
      sampleRateOutput: 44_100,
      maxSupportedOutputRate: 44_100,
      outputChannels: 2,
    }),
  ]);
  const next = applyActiveOutputSnapshot({
    devices,
    routes: { input: [], output: [] },
  }, {
    name: "音箱",
    nominalSampleRate: 16_000,
    actualSampleRate: 16_000,
    isRunning: true,
    timestamp: "2026-07-17T00:00:00.000Z",
  });
  assert.equal(next.devices.find((item) => item.name === "耳机")?.mode, "INACTIVE");
  assert.equal(next.devices.find((item) => item.name === "音箱")?.mode, "HFP_HSP");
});

test("忽略非蓝牙设备", () => {
  const result = assessBluetoothDevices([
    device({ transport: "usb", isDefaultOutput: true }),
  ]);
  assert.deepEqual(result, []);
});
