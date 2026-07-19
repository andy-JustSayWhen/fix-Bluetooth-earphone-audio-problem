import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyActiveInputSnapshot,
  applyActiveOutputSnapshot,
  assessBluetoothDevices,
} from "./index.ts";
import { describeBluetoothRouteRisk } from "./web/client.js";

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

test("经典蓝牙默认输入开始运行时立即显示 HFP 和活动参数", () => {
  const [assessment] = assessBluetoothDevices([
    device({
      sampleRateInput: 16_000,
      sampleRateOutput: 16_000,
      maxSupportedOutputRate: 16_000,
      inputChannels: 1,
      outputChannels: 1,
      isDefaultInput: true,
    }),
  ]);
  const next = applyActiveInputSnapshot({
    devices: [assessment],
    routes: {
      input: [{ name: "测试耳机", direction: "input", transport: "bluetooth", channels: 1, sampleRate: 16_000, isDefault: true }],
      output: [{ name: "测试耳机", direction: "output", transport: "bluetooth", channels: 1, sampleRate: 16_000, isDefault: false }],
    },
  }, {
    name: "测试耳机",
    isRunning: true,
    nominalSampleRate: 16_000,
    actualSampleRate: 16_000,
  });

  assert.equal(next.devices[0].isActive, true);
  assert.equal(next.devices[0].isInputActive, true);
  assert.equal(next.devices[0].mode, "HFP_HSP");
  assert.equal(next.devices[0].sampleRateInput, 16_000);
  assert.match(next.devices[0].explanation, /正常录音/);
});

test("默认输入停止运行后非默认输出设备恢复为未活动", () => {
  const [assessment] = assessBluetoothDevices([
    device({
      sampleRateInput: 16_000,
      sampleRateOutput: 16_000,
      inputChannels: 1,
      outputChannels: 1,
      isDefaultInput: true,
    }),
  ]);
  const active = applyActiveInputSnapshot({ devices: [assessment], routes: { input: [], output: [] } }, {
    name: "测试耳机",
    isRunning: true,
    actualSampleRate: 16_000,
  });
  const stopped = applyActiveInputSnapshot(active, {
    name: "测试耳机",
    isRunning: false,
    actualSampleRate: 16_000,
  });

  assert.equal(stopped.devices[0].isInputActive, false);
  assert.equal(stopped.devices[0].mode, "INACTIVE");
});

test("低功耗蓝牙输入运行时展示活动参数但不冒充已识别模式", () => {
  const [assessment] = assessBluetoothDevices([
    device({
      transport: "bluetooth-le",
      sampleRateInput: 32_000,
      inputChannels: 1,
      isDefaultInput: true,
    }),
  ]);
  const next = applyActiveInputSnapshot({ devices: [assessment], routes: { input: [], output: [] } }, {
    name: "测试耳机",
    isRunning: true,
    actualSampleRate: 32_000,
  });

  assert.equal(next.devices[0].isInputActive, true);
  assert.equal(next.devices[0].mode, "UNKNOWN");
  assert.equal(next.devices[0].label, "蓝牙麦克风活动中");
});

test("忽略非蓝牙设备", () => {
  const result = assessBluetoothDevices([
    device({ transport: "usb", isDefaultOutput: true }),
  ]);
  assert.deepEqual(result, []);
});

test("一键修复请求期间立即显示忙碌状态并阻止重复提交", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");
  const busyState = source.indexOf("runningDevices.add(device.name)");
  const request = source.indexOf('fetch("/api/a2dp-recovery"');

  assert.ok(busyState >= 0 && busyState < request);
  assert.match(source, /正在修复，请稍候/);
  assert.match(source, /if \(runningDevices\.has\(device\.name\)\) return/);
});

test("一键修复使用独立原生按钮而不是在卡片按钮内嵌交互文字", () => {
  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");

  assert.match(source, /createElement\("button", "recovery-trigger", "一键修复 HFP"\)/);
  assert.doesNotMatch(source, /badge\.setAttribute\("role", "button"\)/);
  assert.match(source, /header\.append\(summary, modeActions\)/);
});

test("同一标签页刷新后保留已完成修复结果但不恢复运行中状态", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.match(source, /window\.sessionStorage\.getItem\(storageKey\)/);
  assert.match(source, /setFeedback\(device\.name, \{\s+kind: "running"[\s\S]*?\}, false\)/);
  assert.match(source, /setFeedback\(device\.name, \{\s+kind: result\.ok/);
});

test("不同经典蓝牙输入输出在语音前显示风险提示", () => {
  const routes = {
    input: [{ name: "蓝牙麦克风 A", transport: "bluetooth", isDefault: true }],
    output: [{ name: "蓝牙耳机 B", transport: "bluetooth", isDefault: true }],
  };

  assert.match(describeBluetoothRouteRisk(routes), /两台不同的蓝牙设备/);
  assert.equal(describeBluetoothRouteRisk({
    input: [{ name: "同一耳机", transport: "bluetooth", isDefault: true }],
    output: [{ name: "同一耳机", transport: "bluetooth", isDefault: true }],
  }), null);
  assert.equal(describeBluetoothRouteRisk({
    input: [{ name: "内建麦克风", transport: "built-in", isDefault: true }],
    output: [{ name: "蓝牙耳机 B", transport: "bluetooth", isDefault: true }],
  }), null);
});

test("一键修复结果不会因麦克风仍在使用而被页面删除", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /microphoneOccupancy\?\.isInUse\) feedbackByDevice\.delete/);
  assert.match(source, /kind: result\.ok \? "success" : result\.actionRequired \? "pending" : "error"/);
  assert.match(source, /finally \{\s+runningDevices\.delete\(device\.name\);\s+renderDevices\(getLastRenderedDevices\(\)\);/s);
});
