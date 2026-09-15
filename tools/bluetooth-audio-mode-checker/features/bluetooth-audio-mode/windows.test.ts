import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePhysicalDevices, type WindowsEndpointFacts, type WindowsProbeResult } from "../../core/windows-audio-probe/index.ts";
import { assessBluetoothDevices, applyActiveOutputSnapshot, applyActiveInputSnapshot, applyBluetoothLinkSnapshot } from "./index.ts";
import { deviceModePresentation, audioEndpointMetrics, negotiatedA2dpFields } from "./web/client.js";

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
  assert.deepEqual(audioEndpointMetrics(device, "output"), [["被占用情况", "正在被占用"], ["播放程序", "未识别到"]]);
  assert.deepEqual(negotiatedA2dpFields(device.windowsEvidence?.a2dpStream, false), [["格　式", "尚未取得"], ["编　码", "尚未取得"], ["采样率", "尚未取得"], ["声道数", "尚未取得"]]);
  assert.equal(audioEndpointMetrics(device, "input")[0][1], "未被占用");
  assert.equal(audioEndpointMetrics({...device, windowsEvidence: {...device.windowsEvidence, activeCapture: true}, microphoneOccupancy: {users: [{name: "wetype_update"}]}}, "input")[1][1], "wetype_update");
  assert.equal(device.mode, "UNKNOWN");
  assert.equal(device.a2dpSupport, "UNKNOWN");
  assert.equal(device.actualSampleRateOutput, null);
  assert.deepEqual(device.availableSampleRateRangesOutput, []);
});

test("协商格式卡片按字段分行展示，语音链路优先于过时记录", () => {
  const voiceResult: WindowsProbeResult = {endpoints: [endpoint], defaults: {renderConsole: endpoint, renderComms: null, captureConsole: null},
    voiceLinks: [{address: "AABBCCDDEEFF", timestamp: "2026-09-14T11:44:12Z"}],
    a2dpStreams: [{address: "AABBCCDDEEFF", streaming: false, startedAt: "2026-09-14T11:43:49Z", codec: 2, vendorId: 0, sampleRate: 48000, channels: 2, negotiatedAt: "2026-09-14T11:43:47Z"}]};
  const [voice] = assessBluetoothDevices(aggregatePhysicalDevices(voiceResult));
  assert.deepEqual(negotiatedA2dpFields(voice.windowsEvidence?.a2dpStream, true), [["格　式", "低音质通话"], ["编　码", "尚未取得"], ["采样率", "尚未取得"], ["声道数", "尚未取得"]]);
  assert.equal(voice.mode, "HFP_HSP");
  const [recovered] = assessBluetoothDevices(aggregatePhysicalDevices({...voiceResult, voiceLinks: []}));
  assert.equal(recovered.mode, "UNKNOWN");
  assert.deepEqual(negotiatedA2dpFields(recovered.windowsEvidence?.a2dpStream, false), [["格　式", "高音质播放（未在传输）"], ["编　码", "AAC"], ["采样率", "48 kHz"], ["声道数", "2 声道"]]);
  const [streaming] = assessBluetoothDevices(aggregatePhysicalDevices({...voiceResult, voiceLinks: [], a2dpStreams: [{...voiceResult.a2dpStreams![0], streaming: true}]}));
  assert.equal(streaming.mode, "A2DP");
  assert.deepEqual(negotiatedA2dpFields(streaming.windowsEvidence?.a2dpStream, false), [["格　式", "高音质播放"], ["编　码", "AAC"], ["采样率", "48 kHz"], ["声道数", "2 声道"]]);
});

test("协商格式字段区分编码、厂商编码与缺失状态", () => {
  const stream = {streaming: true, startedAt: null, codec: 2, vendorId: 0, sampleRate: 48000, channels: 2, negotiatedAt: "2026-09-14T11:43:47Z"};
  assert.deepEqual(negotiatedA2dpFields({...stream, codec: 0, sampleRate: 44100, channels: 1}, false), [["格　式", "高音质播放"], ["编　码", "SBC"], ["采样率", "44.1 kHz"], ["声道数", "单声道"]]);
  assert.deepEqual(negotiatedA2dpFields({...stream, codec: 4, vendorId: 0x0000000f}, false), [["格　式", "高音质播放"], ["编　码", "厂商编码 0x0000000F"], ["采样率", "48 kHz"], ["声道数", "2 声道"]]);
  assert.deepEqual(negotiatedA2dpFields({...stream, codec: null, sampleRate: null, channels: null}, false), [["格　式", "高音质播放"], ["编　码", "尚未取得"], ["采样率", "尚未取得"], ["声道数", "尚未取得"]]);
});

test("格式查询失败或不支持不影响独立活动展示及模式边界", () => {
  const [device] = assess([{...endpoint, configuredRate: 16000, configuredStatus: "error:80070490", supportedStatus: "partial", supportedRates: []}]);
  assert.equal(audioEndpointMetrics(device, "output")[0][1], "正在被占用");
  assert.equal(audioEndpointMetrics(device, "output")[1][1], "未识别到");
  const [unsupported] = assess([{...endpoint, supportedRates: [], supportedStatus: "ok"}]);
  assert.equal(audioEndpointMetrics(unsupported, "output")[0][1], "正在被占用");
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

test("高音质流传输事实正面判定 A2DP，流停止只保留协商展示", () => {
  const stream = {address: "AABBCCDDEEFF", streaming: true, startedAt: "2026-09-14T11:43:49Z", codec: 2, vendorId: 0, sampleRate: 48000, channels: 2, negotiatedAt: "2026-09-14T11:43:47Z"};
  const result: WindowsProbeResult = {endpoints: [endpoint], defaults: {renderConsole: endpoint, renderComms: null, captureConsole: null}, a2dpStreams: [stream]};
  const [device] = assessBluetoothDevices(aggregatePhysicalDevices(result));
  assert.equal(device.mode, "A2DP");
  assert.equal(device.confidence, "高");
  assert.equal(device.a2dpSupport, "SUPPORTED");
  assert.match(device.explanation, /48 kHz/);
  assert.equal(device.windowsEvidence?.a2dpStream?.codec, 2);
  const [stopped] = assessBluetoothDevices(aggregatePhysicalDevices({...result, a2dpStreams: [{...stream, streaming: false}]}));
  assert.equal(stopped.mode, "UNKNOWN");
  const [other] = assessBluetoothDevices(aggregatePhysicalDevices({...result, a2dpStreams: [{...stream, address: "112233445566"}]}));
  assert.equal(other.mode, "UNKNOWN");
  const [voice] = assessBluetoothDevices(aggregatePhysicalDevices({...result, voiceLinks: [{address: "AABBCCDDEEFF", timestamp: "2026-09-14T11:44:12Z"}]}));
  assert.equal(voice.mode, "HFP_HSP");
});

test("协商格式字段保留语音链路优先与证据边界语义", () => {
  const stream = {streaming: true, startedAt: null, codec: 2, vendorId: 0, sampleRate: 48000, channels: 2, negotiatedAt: "2026-09-14T11:43:47Z"};
  assert.deepEqual(negotiatedA2dpFields({...stream, streaming: false}, false), [["格　式", "高音质播放（未在传输）"], ["编　码", "AAC"], ["采样率", "48 kHz"], ["声道数", "2 声道"]]);
  assert.deepEqual(negotiatedA2dpFields(null, false), [["格　式", "尚未取得"], ["编　码", "尚未取得"], ["采样率", "尚未取得"], ["声道数", "尚未取得"]]);
  assert.deepEqual(negotiatedA2dpFields({...stream, streaming: false, negotiatedAt: null}, false), [["格　式", "尚未取得"], ["编　码", "尚未取得"], ["采样率", "尚未取得"], ["声道数", "尚未取得"]]);
  // 语音链路活跃时显示当前真实传输路径，不再堆砌过时的高音质协商记录。
  assert.deepEqual(negotiatedA2dpFields({...stream, streaming: false}, true), [["格　式", "低音质通话"], ["编　码", "尚未取得"], ["采样率", "尚未取得"], ["声道数", "尚未取得"]]);
  assert.deepEqual(negotiatedA2dpFields(null, true), [["格　式", "低音质通话"], ["编　码", "尚未取得"], ["采样率", "尚未取得"], ["声道数", "尚未取得"]]);
});
