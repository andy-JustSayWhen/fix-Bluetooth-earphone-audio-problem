import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePhysicalDevices, type WindowsEndpointFacts, type WindowsProbeResult } from "../../core/windows-audio-probe/index.ts";
import { assessBluetoothDevices, applyActiveOutputSnapshot, applyActiveInputSnapshot, applyBluetoothLinkSnapshot } from "./index.ts";
import { deviceModePresentation, audioEndpointMetrics } from "./web/client.js";

test("模式胶囊只显示模式，不用会话活动替换未知状态", () => {
  const idle = {mode: "UNKNOWN", windowsEvidence: {sessionsKnown: true, activeOutput: false, activeCapture: false}};
  assert.deepEqual(deviceModePresentation(idle), {className: "unknown", text: "模式无法确认"});
  assert.equal(deviceModePresentation({...idle, windowsEvidence: {...idle.windowsEvidence, activeOutput: true}}).text, "模式无法确认");
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

test("Windows 页面显示输入输出活动及程序，不把格式能力当运行状态", () => {
  const [device] = assess([
    {...endpoint, configuredRate: 44100, configuredStatus: "ok", supportedRates: [44100, 48000], supportedStatus: "ok"},
    {...endpoint, id: "input", flow: "eCapture", rate: 16000, channels: 1, configuredRate: 16000, configuredStatus: "ok", supportedRates: [16000], supportedStatus: "ok", sessions: []},
  ]);
  assert.deepEqual(audioEndpointMetrics(device, "output"), [["播放活动", "正在播放"], ["播放程序", "未识别到"]]);
  assert.equal(audioEndpointMetrics(device, "input")[0][1], "未检测到活动");
  assert.equal(audioEndpointMetrics({...device, windowsEvidence: {...device.windowsEvidence, activeCapture: true}, microphoneOccupancy: {users: [{name: "wetype_update"}]}}, "input")[1][1], "wetype_update");
  assert.equal(device.mode, "UNKNOWN");
  assert.equal(device.a2dpSupport, "UNKNOWN");
  assert.equal(device.actualSampleRateOutput, null);
  assert.deepEqual(device.availableSampleRateRangesOutput, []);
});

test("格式查询失败或不支持不影响独立活动展示及模式边界", () => {
  const [device] = assess([{...endpoint, configuredRate: 16000, configuredStatus: "error:80070490", supportedStatus: "partial", supportedRates: []}]);
  assert.equal(audioEndpointMetrics(device, "output")[0][1], "正在播放");
  assert.equal(audioEndpointMetrics(device, "output")[1][1], "未识别到");
  const [unsupported] = assess([{...endpoint, supportedRates: [], supportedStatus: "ok"}]);
  assert.equal(audioEndpointMetrics(unsupported, "output")[0][1], "正在播放");
  assert.equal(unsupported.a2dpSupport, "UNKNOWN");
});
test("高混音采样率与活动播放不能证明统一端点使用高音质模式", () => {
  const [device] = assess([endpoint]);
  assert.equal(device.mode, "UNKNOWN");
  assert.equal(device.actualSampleRateOutput, null);
  assert.equal(device.nominalSampleRateOutput, null);
  assert.equal(device.maxSupportedOutputRate, null);
  assert.deepEqual(device.availableSampleRateRangesOutput, []);
});
test("默认蓝牙麦克风没有活动会话时不能判定通话模式", () => {
  const [device] = assess([endpoint, {...endpoint, id: "input", flow: "eCapture", sessions: []}]);
  assert.equal(device.mode, "UNKNOWN");
});
test("传统蓝牙输入活动更新占用但不替代独立模式证据", () => {
  const [device] = assess([endpoint, {...endpoint, id: "input", flow: "eCapture"}]);
  assert.equal(device.mode, "UNKNOWN");
  assert.equal(device.isInputActive, true);
});
test("低功耗蓝牙的输入活动不套用传统蓝牙通话规则", () => {
  const [device] = assess([{...endpoint, transport: "bluetooth-le"}, {...endpoint, id: "input", flow: "eCapture", transport: "bluetooth-le"}]);
  assert.equal(device.mode, "UNKNOWN");
});
test("独立免提输出会话不冒充链路或输出运行参数", () => {
  assert.equal(assess([{...endpoint, role: "handsfree"}])[0].mode, "UNKNOWN");
});
test("独立端点名称与会话不能替代实际输出采样率", () => {
  const endpoints = [endpoint, {...endpoint, id: "handsfree", role: "handsfree" as const, sessions: []}];
  assert.equal(assess(endpoints)[0].mode, "UNKNOWN");
  assert.equal(assess([...endpoints, {...endpoint, id: "input", flow: "eCapture"}])[0].mode, "UNKNOWN");
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

test("Windows 的独立语音链路不被平台分支吞掉，按地址及时序隔离", () => {
  const initial = {devices: assess([endpoint]), routes: {input: [], output: []}};
  const low = applyBluetoothLinkSnapshot(initial, {address: "AA:BB:CC:DD:EE:FF", profile: "tsco", timestamp: "2026-09-14T01:00:00Z"});
  assert.equal(low.devices[0].mode, "HFP_HSP");
  assert.equal(low.devices[0].a2dpSupport, "UNKNOWN");
  const old = applyBluetoothLinkSnapshot(low, {address: "AA:BB:CC:DD:EE:FF", profile: "tacl", timestamp: "2026-09-14T00:00:00Z"});
  assert.equal(old.devices[0].mode, "HFP_HSP");
  const other = applyBluetoothLinkSnapshot(low, {address: "11:22:33:44:55:66", profile: "tacl", timestamp: "2026-09-14T02:00:00Z"});
  assert.equal(other.devices[0].mode, "HFP_HSP");
  const playback = applyBluetoothLinkSnapshot(low, {address: "AA:BB:CC:DD:EE:FF", profile: "tacl", timestamp: "2026-09-14T02:00:00Z"});
  assert.equal(playback.devices[0].mode, "UNKNOWN");
});

test("Windows 保留经独立采集的输出事实并走共同采样率规则", () => {
  const raw = aggregatePhysicalDevices({endpoints: [endpoint], defaults: {renderConsole: endpoint, renderComms: null, captureConsole: null}})[0];
  for (const fields of [
    {nominalSampleRateOutput: 16000, actualSampleRateOutput: null},
    {nominalSampleRateOutput: 48000, actualSampleRateOutput: 16000},
  ]) {
    const [device] = assessBluetoothDevices([{...raw, ...fields, availableSampleRateRangesOutput: [{minimum: 16000, maximum: 48000}]}]);
    assert.equal(device.mode, "HFP_HSP");
    assert.equal(device.a2dpSupport, "SUPPORTED");
    assert.equal(device.maxSupportedOutputRate, 48000);
    assert.deepEqual(device.availableSampleRateRangesOutput, [{minimum: 16000, maximum: 48000}]);
    assert.equal(device.actualSampleRateOutput, fields.actualSampleRateOutput);
  }
  const [stereo] = assessBluetoothDevices([{...raw, actualSampleRateOutput: 48000}]);
  assert.equal(stereo.mode, "A2DP");
  assert.equal(stereo.a2dpSupport, "UNKNOWN");
  const voice = applyBluetoothLinkSnapshot({devices: [stereo], routes: {input: [], output: []}}, {address: "AABBCCDDEEFF", profile: "tsco", timestamp: "2026-09-14T01:00:00Z"});
  assert.equal(voice.devices[0].mode, "HFP_HSP");
  const [unsupported] = assessBluetoothDevices([{...raw, nominalSampleRateOutput: 16000, availableSampleRateRangesOutput: [{minimum: 16000, maximum: 16000}]}]);
  assert.equal(unsupported.mode, "UNKNOWN");
  assert.equal(unsupported.a2dpSupport, "UNSUPPORTED");
});


test("Windows 实时同步连接按地址进入共同 HFP 规则，断开快照清除且不虚构采样率", () => {
  const result: WindowsProbeResult = {endpoints: [endpoint], defaults: {renderConsole: endpoint, renderComms: null, captureConsole: null}, voiceLinks: [{address: endpoint.bluetoothAddress!, timestamp: "2026-09-14T00:00:00Z"}]};
  const [active] = assessBluetoothDevices(aggregatePhysicalDevices(result));
  assert.equal(active.mode, "HFP_HSP");
  assert.equal(active.audioLinkType, "tsco");
  assert.equal(active.actualSampleRateOutput, null);
  for (const voiceLinks of [[], [{address: "112233445566", timestamp: "2026-09-14T00:00:00Z"}], [{address: endpoint.bluetoothAddress!, timestamp: "invalid"}]]) {
    const [unknown] = assessBluetoothDevices(aggregatePhysicalDevices({...result, voiceLinks}));
    assert.equal(unknown.mode, "UNKNOWN");
    assert.equal(unknown.audioLinkType, null);
  }
});
