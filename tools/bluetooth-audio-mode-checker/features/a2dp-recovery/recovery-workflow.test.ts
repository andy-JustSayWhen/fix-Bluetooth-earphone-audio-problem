import test from "node:test";
import assert from "node:assert/strict";
import { runRecovery, type RecoveryRuntime } from "./run-recovery.ts";
import type { FormatRequestEvidence } from "./format-request-diagnosis.ts";
import type { RunningProcess } from "../../core/macos-running-apps/index.ts";
import type { MicrophoneUser, RawAudioDevice } from "../../shared/audio-device-types/index.ts";

const now = Date.parse("2026-07-19T10:00:00+08:00");
const emptyEvidence: FormatRequestEvidence = {
  windowMinutes: 10,
  events: [],
  rawLines: [],
  queryError: null,
};
const processInfo: RunningProcess = {
  pid: 30114,
  name: "VoiceApp",
  command: "/Applications/VoiceApp.app/Contents/MacOS/VoiceApp",
  startedAt: "Sun Jul 19 09:50:00 2026",
};
const microphoneUser: MicrophoneUser = {
  pid: processInfo.pid,
  name: processInfo.name,
  bundleId: "example.voice",
  devices: ["蓝牙耳机"],
};

function device(partial: Partial<RawAudioDevice>): RawAudioDevice {
  return {
    id: 1,
    name: "蓝牙耳机",
    uid: "50-C0-F0-F3-6A-66:output",
    manufacturer: "",
    transport: "bluetooth",
    sampleRateInput: 16_000,
    sampleRateOutput: 16_000,
    maxSupportedOutputRate: 48_000,
    inputChannels: 1,
    outputChannels: 2,
    isRunning: true,
    isDefaultInput: false,
    isDefaultOutput: true,
    isDefaultSystemOutput: true,
    ...partial,
  };
}

function runtime(overrides: Partial<RecoveryRuntime> = {}): RecoveryRuntime {
  return {
    now: () => now,
    wait: async () => {},
    readDevices: () => [device({ sampleRateOutput: 16_000 })],
    readMicrophoneUsers: async () => [],
    readProcess: () => null,
    terminateProcess: () => {},
    readEvidence: () => emptyEvidence,
    readEvidenceSince: () => emptyEvidence,
    setDefaultDevice: () => {},
    reconnectDevice: () => {},
    ...overrides,
  };
}

test("点击后发现目标已恢复时立即结束且不查原因日志", async () => {
  let evidenceReads = 0;
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [device({ sampleRateOutput: 48_000 })],
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }));

  assert.equal(result.outcome, "无需修复");
  assert.equal(result.ok, true);
  assert.equal(evidenceReads, 0);
});

test("新鲜占用快照直接路由到占用处理并三次确认完全恢复", async () => {
  let running = true;
  let rate = 16_000;
  let microphoneReads = 0;
  let evidenceReads = 0;
  const progress: string[] = [];
  const result = await runRecovery({
    name: "蓝牙耳机",
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 16_000,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [microphoneUser],
      },
    },
  }, runtime({
    readDevices: () => [device({
      sampleRateOutput: rate,
      isDefaultInput: true,
    })],
    readMicrophoneUsers: async () => {
      microphoneReads += 1;
      return [];
    },
    readProcess: () => running ? processInfo : null,
    terminateProcess: () => {
      running = false;
      rate = 48_000;
    },
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }), (item) => progress.push(item.stage));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.diagnosis.kind, "麦克风占用类");
  assert.equal(microphoneReads, 0);
  assert.equal(evidenceReads, 0);
  assert.ok(progress.includes("正在确认稳定"));
});

test("用户授权后返回仅限本次开机的自动拉起阻止任务", async () => {
  let running = true;
  let rate = 16_000;
  const result = await runRecovery({
    name: "蓝牙耳机",
    authorizeRelaunchBlock: true,
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 16_000,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [microphoneUser],
      },
    },
  }, runtime({
    readDevices: () => [device({ sampleRateOutput: rate, isDefaultInput: true })],
    readProcess: () => running ? processInfo : null,
    terminateProcess: () => {
      running = false;
      rate = 48_000;
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result._relaunchGuard?.command, processInfo.command);
});

test("证据不足时先切换非蓝牙输入再恢复原输入", async () => {
  let defaultInput = "蓝牙耳机";
  let rate = 16_000;
  let reconnects = 0;
  const readDevices = () => [
    device({ name: "蓝牙耳机", sampleRateOutput: rate, isDefaultInput: defaultInput === "蓝牙耳机" }),
    device({
      id: 2,
      name: "内置麦克风",
      uid: "built-in-input",
      transport: "built-in",
      inputChannels: 1,
      outputChannels: 0,
      sampleRateInput: 48_000,
      sampleRateOutput: null,
      isDefaultInput: defaultInput === "内置麦克风",
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
  ];
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    setDefaultDevice: (direction, name) => {
      if (direction !== "input") return;
      defaultInput = name;
      if (name === "蓝牙耳机") rate = 48_000;
    },
    reconnectDevice: () => { reconnects += 1; },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.recoveryPath, "声音链路重建兜底");
  assert.equal(reconnects, 0);
});

test("完整多端点证据先返回组合选择，不结束会话进程", async () => {
  const rawLines = [
    "2026-07-19 10:00:00.000000+0800 localhost coreaudiod[1]: session: VoiceApp(30114)",
    "deviceUIDs:",
    "- 50-C0-F0-F3-6A-66:output",
    "- 58-B8-58-9D-C1-E8:input",
    "2026-07-19 10:00:00.100000+0800 localhost coreaudiod[1]: There was an error setting the deviceUUIDs as there are more than one BT device connected",
  ];
  let terminated = false;
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机", uid: "50-C0-F0-F3-6A-66:output" }),
      device({ name: "蓝牙麦克风", uid: "58-B8-58-9D-C1-E8:input", inputChannels: 1, outputChannels: 2, isDefaultInput: true, isDefaultOutput: false }),
      device({ name: "内建设备", transport: "built-in", inputChannels: 1, outputChannels: 2, isDefaultOutput: false }),
    ],
    readProcess: () => processInfo,
    terminateProcess: () => { terminated = true; },
    readEvidence: () => ({ ...emptyEvidence, rawLines }),
  }));

  assert.equal(result.outcome, "等待选择");
  assert.equal(result.diagnosis.kind, "多端点会话类");
  assert.equal(result.actionRequired?.kind, "route-choice");
  assert.equal(terminated, false);
});

test("用户选定多端点替代组合后只报告绕过成功", async () => {
  let defaultInput = "蓝牙麦克风";
  const rawLines = [
    "2026-07-19 10:00:00.000000+0800 localhost coreaudiod[1]: session: VoiceApp(30114)",
    "deviceUIDs:",
    "- 50-C0-F0-F3-6A-66:output",
    "- 58-B8-58-9D-C1-E8:input",
    "2026-07-19 10:00:00.100000+0800 localhost coreaudiod[1]: There was an error setting the deviceUUIDs as there are more than one BT device connected",
  ];
  const readDevices = () => [
    device({ name: "蓝牙耳机", uid: "50-C0-F0-F3-6A-66:output" }),
    device({ name: "蓝牙麦克风", uid: "58-B8-58-9D-C1-E8:input", inputChannels: 1, outputChannels: 2, isDefaultInput: defaultInput === "蓝牙麦克风", isDefaultOutput: false }),
    device({ name: "内建设备", transport: "built-in", inputChannels: 1, outputChannels: 2, isDefaultInput: defaultInput === "内建设备", isDefaultOutput: false }),
  ];
  const result = await runRecovery({
    name: "蓝牙耳机",
    routeChoiceId: "input:内建设备",
  }, runtime({
    readDevices,
    readProcess: () => processInfo,
    readEvidence: () => ({ ...emptyEvidence, rawLines }),
    setDefaultDevice: (direction, name) => {
      if (direction === "input") defaultInput = name;
    },
  }));

  assert.equal(result.outcome, "绕过成功");
  assert.equal(result.ok, true);
  assert.match(result.message, /不代表原组合已完全修复/);
});
