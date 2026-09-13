import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePhysicalDevices, type WindowsEndpointFacts, type WindowsProbeResult } from "../../core/windows-audio-probe/index.ts";
import { assessBluetoothDevices, applyActiveOutputSnapshot, applyActiveInputSnapshot } from "./index.ts";
import { deviceModePresentation } from "./web/client.js";

test("无活动与证据不足显示中性提示，通话证据仍优先显示", () => {
  const idle = {mode: "UNKNOWN", windowsEvidence: {sessionsKnown: true, activeOutput: false, activeCapture: false}};
  assert.deepEqual(deviceModePresentation(idle), {className: "pending", text: "未检测到音频活动"});
  assert.equal(deviceModePresentation({...idle, windowsEvidence: {...idle.windowsEvidence, activeOutput: true}}).text, "模式待确认");
  assert.equal(deviceModePresentation({...idle, mode: "HFP_HSP"}).className, "hfp_hsp");
  assert.equal(deviceModePresentation({...idle, windowsEvidence: {sessionsKnown: false}}).className, "unknown");
});

const endpoint: WindowsEndpointFacts = {
  id: "output", flow: "eRender", name: "测试耳机", physicalName: "测试耳机", transport: "bluetooth",
  role: "a2dp", bluetoothAddress: "AABBCCDDEEFF", canonicalId: "BTHENUM\\DEV_AABBCCDDEEFF\\1",
  manufacturer: null, pnpFound: true, rate: 48000, channels: 2, bits: 32, sessionsKnown: true,
  sessions: [{pid: 100, name: "播放器", id: "session1"}],
};
function assess(endpoints: WindowsEndpointFacts[]) {
  const result: WindowsProbeResult = {endpoints, defaults: {renderConsole: endpoint, renderComms: null, captureConsole: null}};
  return assessBluetoothDevices(aggregatePhysicalDevices(result));
}
test("高混音采样率与活动播放不能证明统一端点使用高音质模式", () => {
  const [device] = assess([endpoint]);
  assert.equal(device.mode, "UNKNOWN");
  assert.equal(device.actualSampleRateOutput, null);
  assert.deepEqual(device.availableSampleRateRangesOutput, []);
});
test("默认蓝牙麦克风没有活动会话时不能判定通话模式", () => {
  const [device] = assess([endpoint, {...endpoint, id: "input", flow: "eCapture", sessions: []}]);
  assert.equal(device.mode, "UNKNOWN");
});
test("传统蓝牙的真实输入活动优先于高混音采样率", () => {
  const [device] = assess([endpoint, {...endpoint, id: "input", flow: "eCapture"}]);
  assert.equal(device.mode, "HFP_HSP");
  assert.equal(device.isInputActive, true);
});
test("低功耗蓝牙的输入活动不套用传统蓝牙通话规则", () => {
  const [device] = assess([{...endpoint, transport: "bluetooth-le"}, {...endpoint, id: "input", flow: "eCapture", transport: "bluetooth-le"}]);
  assert.equal(device.mode, "UNKNOWN");
});
test("独立免提输出会话能够判定通话模式", () => {
  assert.equal(assess([{...endpoint, role: "handsfree"}])[0].mode, "HFP_HSP");
});
test("独立双输出端点只有立体声播放且无输入会话时可确认高音质", () => {
  const endpoints = [endpoint, {...endpoint, id: "handsfree", role: "handsfree" as const, sessions: []}];
  assert.equal(assess(endpoints)[0].mode, "A2DP");
  assert.equal(assess([...endpoints, {...endpoint, id: "input", flow: "eCapture"}])[0].mode, "HFP_HSP");
  assert.equal(assess([endpoint, {...endpoints[1], sessionsKnown: false}])[0].mode, "UNKNOWN");
});
test("状态重新组合保留 Windows 证据，不能被高采样率快照覆盖", () => {
  const state = {devices: assess([endpoint]), routes: {input: [], output: []}};
  const output = applyActiveOutputSnapshot(state, {name: "测试耳机", nominalSampleRate: 48000, actualSampleRate: 48000, isRunning: true, timestamp: new Date().toISOString()});
  assert.equal(output.devices[0].mode, "UNKNOWN");
  const input = applyActiveInputSnapshot(output, {name: "测试耳机", nominalSampleRate: 48000, actualSampleRate: 48000, isRunning: false, timestamp: new Date().toISOString()});
  assert.equal(input.devices[0].mode, "UNKNOWN");
  assert.ok(input.devices[0].windowsEvidence);
});
