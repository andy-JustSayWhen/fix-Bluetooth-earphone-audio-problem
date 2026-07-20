import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  attachSpeakerOccupancy,
  parseSpeakerSessionLine,
  reduceSpeakerSessions,
  flattenSpeakerSessions,
} from "./index.ts";
import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";

const activeLine = '2026-07-21 05:42:30.714 Df audiomxd[65055:6a0654] [com.apple.coreaudio:as_server] AVAudioSessionXPCServer.mm:2517  { "action":"update_running_state", "session":{"ID":"0xfe1f00a","name":"QQMusic(4206)"}, "details":{"deviceUIDs":["50-C0-F0-F3-6A-66:output"],"implicit_category":"MediaPlayback","input_running":false,"output_running":true} }';

test("解析正在向蓝牙输出端点送出声音的应用会话", () => {
  const event = parseSpeakerSessionLine(activeLine);
  assert.equal(event?.name, "QQMusic");
  assert.equal(event?.pid, 4206);
  assert.deepEqual(event?.outputDeviceUids, ["50-C0-F0-F3-6A-66:output"]);
});

test("停止输出或空设备列表会清除同一会话的旧归属", () => {
  const sessions = new Map();
  const active = parseSpeakerSessionLine(activeLine)!;
  reduceSpeakerSessions(sessions, active);
  assert.equal(flattenSpeakerSessions(sessions).length, 1);
  reduceSpeakerSessions(sessions, {
    ...active,
    outputRunning: false,
    outputDeviceUids: [],
    observedAt: "2026-07-21T05:43:37.434+08:00",
  });
  assert.equal(flattenSpeakerSessions(sessions).length, 0);
});

test("输入端点不能进入扬声器占用", () => {
  const line = activeLine.replace("50-C0-F0-F3-6A-66:output", "50-C0-F0-F3-6A-66:input");
  const sessions = new Map();
  reduceSpeakerSessions(sessions, parseSpeakerSessionLine(line)!);
  assert.equal(flattenSpeakerSessions(sessions).length, 0);
});

test("按蓝牙地址只归属到对应设备", () => {
  const event = parseSpeakerSessionLine(activeLine)!;
  const sessions = new Map();
  reduceSpeakerSessions(sessions, event);
  const base = {
    name: "K03S",
    bluetoothAddress: "50:C0:F0:F3:6A:66",
  } as AudioModeAssessment;
  const devices = attachSpeakerOccupancy([
    base,
    { ...base, name: "其他耳机", bluetoothAddress: "AA:BB:CC:DD:EE:FF" },
  ], flattenSpeakerSessions(sessions));
  assert.equal(devices[0].speakerOccupancy?.users[0]?.name, "QQMusic");
  assert.equal(devices[1].speakerOccupancy?.isInUse, false);
});

test("进程身份不再有效时不保留历史占用", () => {
  const sessions = new Map();
  reduceSpeakerSessions(sessions, parseSpeakerSessionLine(activeLine)!, false);
  assert.equal(flattenSpeakerSessions(sessions).length, 0);
});

test("页面无论是否识别到输出占用都提供一键断开重连", () => {
  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");
  assert.match(source, /if \(inUse\)[\s\S]*?\} else \{[\s\S]*?\}\s+const button = createElement\(/);
  assert.match(source, /busyDevices\.has\(device\.name\) \? "正在断开重连…" : "一键断开重连"/);
  assert.match(source, /若当前设备处于A2DP，音频能正常播放但设备端没有声音，可以点击“一键断开重连”尝试修复/);
  assert.match(source, /仅设为系统默认输出不算应用级占用/);
});

test("服务端只复核目标设备并允许占用证据为空", () => {
  const source = readFileSync(new URL("../../app/index.ts", import.meta.url), "utf8");
  assert.match(source, /filterCurrentSpeakerUsers\(latestSpeakerUsers\)/);
  assert.match(source, /speakerOccupancy\?\.users \?\? \[\]/);
  assert.match(source, /reconnectSpeakerDevice\(body\.name\)/);
  assert.doesNotMatch(source, /当前没有应用正在向该设备输出声音，未执行断开重连/);
});

test("断开确认后立即重连且不保留固定等待", () => {
  const source = readFileSync(new URL("../../core/macos-bluetooth-link/reconnect-device.m", import.meta.url), "utf8");
  const disconnectConfirmedAt = source.indexOf("if ([target isConnected]) return 4;");
  const reconnectStartedAt = source.indexOf("dispatch_async", disconnectConfirmedAt);
  assert.doesNotMatch(source.slice(disconnectConfirmedAt, reconnectStartedAt), /sleepForTimeInterval/);
  assert.match(source.slice(reconnectStartedAt), /\[target openConnection\]/);
});
