import assert from "node:assert/strict";
import test from "node:test";
import {
  isA2dpRecoveryEligible,
  orderedRouteCandidates,
  routeDevicePriority,
} from "./recovery-policy.ts";
import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";

function device(name: string, transport: string, inputChannels = 1, outputChannels = 1): RawAudioDevice {
  return {
    id: 1, name, uid: name, manufacturer: "", transport,
    sampleRateInput: 48_000, sampleRateOutput: 48_000,
    inputChannels, outputChannels, isRunning: false,
    isDefaultInput: false, isDefaultOutput: false, isDefaultSystemOutput: false,
  };
}

test("非蓝牙候选固定按内置、有线接收器、其他非蓝牙排序", () => {
  const candidates = orderedRouteCandidates([
    device("类型不明", "unknown"),
    device("蓝牙耳机", "bluetooth"),
    device("USB 声卡", "usb"),
    device("内置设备", "built-in"),
  ], "input").filter((item) => routeDevicePriority(item) < 3);
  assert.deepEqual(candidates.map((item) => item.name), ["内置设备", "USB 声卡", "类型不明"]);
});

test("任何蓝牙设备都不能进入非蓝牙降级候选", () => {
  assert.equal(routeDevicePriority(device("经典蓝牙", "bluetooth")), 3);
  assert.equal(routeDevicePriority(device("低功耗蓝牙", "bluetooth-le")), 3);
});

test("输入输出分别过滤有效声道并排除原设备", () => {
  const devices = [
    device("原设备", "built-in"),
    device("只有输入", "usb", 1, 0),
    device("只有输出", "usb", 0, 2),
  ];
  assert.deepEqual(orderedRouteCandidates(devices, "input", ["原设备"]).map((item) => item.name), ["只有输入"]);
  assert.deepEqual(orderedRouteCandidates(devices, "output", ["原设备"]).map((item) => item.name), ["只有输出"]);
});

test("一键修复资格只由一个服务端规则判定", () => {
  assert.equal(isA2dpRecoveryEligible({ mode: "HFP_HSP", a2dpSupport: "SUPPORTED" }), true);
  assert.equal(isA2dpRecoveryEligible({ mode: "HFP_HSP", a2dpSupport: "UNKNOWN" }), true);
  assert.equal(isA2dpRecoveryEligible({ mode: "HFP_HSP", a2dpSupport: "UNSUPPORTED" }), false);
  assert.equal(isA2dpRecoveryEligible({ mode: "A2DP", a2dpSupport: "SUPPORTED" }), false);
  assert.equal(isA2dpRecoveryEligible(null), false);
});
