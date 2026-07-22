import test from "node:test";
import assert from "node:assert/strict";

import type { AudioModeAssessment, MicrophoneUser } from "../../shared/audio-device-types/index.ts";
import {
  attachEmptyMicrophoneOccupancy,
  attachMicrophoneOccupancyFromUsers,
  classifyInputActivities,
  confirmAndReleaseMicrophoneOccupancy,
  mergeMicrophoneOccupancy,
  mergeMicrophoneUsers,
  releaseMicrophoneUsers,
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

test("进程关联实体蓝牙麦克风端点即可确认占用且不要求 tsco", () => {
  const user = [{ pid: 42, name: "语音程序", bundleId: "test.voice", devices: ["REDMI"] }];
  const [occupiedWithTsco] = attachMicrophoneOccupancyFromUsers([
    device({ mode: "HFP_HSP", audioLinkType: "tsco" }),
  ], user);
  const [occupiedWithTacl] = attachMicrophoneOccupancyFromUsers([
    device({ mode: "HFP_HSP", audioLinkType: "tacl" }),
  ], user);

  assert.equal(occupiedWithTsco.microphoneOccupancy?.isInUse, true);
  assert.equal(occupiedWithTacl.microphoneOccupancy?.isInUse, true);
});

test("内置输入即使有进程读取也不得归为蓝牙麦克风占用", () => {
  const [notOccupied] = attachMicrophoneOccupancyFromUsers([
    device({ inputTransport: "built-in", audioLinkType: "tsco" }),
  ], [{ pid: 42, name: "语音程序", bundleId: "test.voice", devices: ["REDMI"] }]);

  assert.equal(notOccupied.microphoneOccupancy?.isInUse, false);
});

test("系统声音采集和空设备列表不得归为麦克风占用", () => {
  const activities = classifyInputActivities([
    device({ mode: "HFP_HSP", audioLinkType: "tsco" }),
  ], [{ pid: 1, name: "replayd", bundleId: "", devices: ["AudioTap"] }, {
    pid: 2,
    name: "其他程序",
    bundleId: "",
    devices: [],
  }]);

  assert.equal(activities[0].inputActivityKind, "系统声音采集");
  assert.equal(activities[1].inputActivityKind, "未确认麦克风占用的输入活动");
  assert.deepEqual(activities.flatMap((activity) => activity.confirmedDeviceNames ?? []), []);
});

test("同一存活进程最后一次未闭合 0→1 必须计入麦克风占用", () => {
  const [activity] = classifyInputActivities([
    device({ mode: "HFP_HSP", audioLinkType: "tsco" }),
  ], [{
    pid: 49268,
    name: "WeType",
    bundleId: "",
    devices: [],
    occupancyEvidenceKinds: ["unclosed-format-request"],
    unclosedFormatRequestAt: "2026-07-22 14:10:50.381000+0800",
  }]);

  assert.equal(activity.inputActivityKind, "已确认实体麦克风占用");
  assert.deepEqual(activity.confirmedDeviceNames, ["REDMI"]);
});

test("未闭合 0→1 前后两秒内只有一台设备进入 tsco 时归入该设备卡片", () => {
  const requestAt = "2026-07-22 14:30:51.382631+0800";
  const users = [{
    pid: 49268,
    name: "WeType",
    bundleId: "",
    devices: [],
    occupancyEvidenceKinds: ["unclosed-format-request" as const],
    unclosedFormatRequestAt: requestAt,
  }];
  const devices = [
    device({
      name: "REDMI Buds 6 Pro 电竞版",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      audioLinkTypeObservedAt: "2026-07-22T06:30:51.452Z",
    }),
    device({
      name: "Redmi电脑音箱-3899",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      audioLinkTypeObservedAt: "2026-07-22T06:30:49.185Z",
    }),
  ];

  const activities = classifyInputActivities(devices, users);
  const occupied = attachMicrophoneOccupancyFromUsers(devices, users);

  assert.deepEqual(activities[0].confirmedDeviceNames, ["REDMI Buds 6 Pro 电竞版"]);
  assert.equal(occupied[0].microphoneOccupancy?.isInUse, true);
  assert.equal(occupied[1].microphoneOccupancy?.isInUse, false);
});

test("无法唯一确认格式请求设备时归入当前默认输入设备卡片", () => {
  const users = [{
    pid: 49268,
    name: "WeType",
    bundleId: "",
    devices: [],
    occupancyEvidenceKinds: ["unclosed-format-request" as const],
    unclosedFormatRequestAt: "2026-07-22 14:30:51.382631+0800",
  }];
  const devices = [
    device({
      name: "设备 A",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      audioLinkTypeObservedAt: "2026-07-22T06:30:51.300Z",
    }),
    device({
      name: "设备 B",
      isDefaultInput: false,
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      audioLinkTypeObservedAt: "2026-07-22T06:30:51.500Z",
    }),
  ];

  const [activity] = classifyInputActivities(devices, users);
  const occupied = attachMicrophoneOccupancyFromUsers(devices, users);

  assert.deepEqual(activity.confirmedDeviceNames, ["设备 A"]);
  assert.equal(occupied[0].microphoneOccupancy?.isInUse, true);
  assert.equal(occupied[1].microphoneOccupancy?.isInUse, false);
});

test("实体端点和未闭合格式请求属于同一进程时合并为一条占用", () => {
  const [user] = mergeMicrophoneUsers(
    [{ pid: 42, name: "语音程序", bundleId: "test.voice", devices: ["REDMI"] }],
    [{
      pid: 42,
      name: "语音程序",
      bundleId: "",
      devices: [],
      occupancyEvidenceKinds: ["unclosed-format-request"],
      unclosedFormatRequestAt: "2026-07-22 14:10:50.381000+0800",
    }],
  );

  assert.equal(user.bundleId, "test.voice");
  assert.deepEqual(user.devices, ["REDMI"]);
  assert.deepEqual(user.occupancyEvidenceKinds, ["unclosed-format-request"]);
});

test("未闭合格式请求没有实体麦克风端点时仍可结束对应进程", async () => {
  const formatUser: MicrophoneUser = {
    pid: 42,
    name: "WeType",
    bundleId: "",
    devices: [],
    inputActivityKind: "已确认实体麦克风占用",
    physicalDeviceNames: [],
    confirmedDeviceNames: [],
    occupancyEvidenceKinds: ["unclosed-format-request"],
    unclosedFormatRequestAt: "2026-07-22 18:15:25.975704+0800",
  };
  const processInfo = {
    pid: 42,
    name: "WeType",
    command: "/Library/Input Methods/WeType.app/Contents/MacOS/WeType",
    startedAt: "Wed Jul 22 16:45:26 2026",
  };
  let running = true;
  const terminated: number[] = [];

  const result = await releaseMicrophoneUsers([formatUser], [42], {
    readProcess: (pid) => running && pid === 42 ? processInfo : null,
    terminateProcess: (current) => {
      terminated.push(current.pid);
      running = false;
    },
    wait: async () => {},
  });

  assert.deepEqual(terminated, [42]);
  assert.deepEqual(result, { requestedPids: [42], releasedPids: [42], remainingPids: [] });
});

test("一键修复第一步复用统一解除能力但只处理实体端点占用", async () => {
  const users: MicrophoneUser[] = [
    { pid: 42, name: "语音程序", bundleId: "test.voice", devices: ["REDMI"] },
    {
      pid: 43,
      name: "格式请求程序",
      bundleId: "test.format",
      devices: [],
      occupancyEvidenceKinds: ["unclosed-format-request"],
      unclosedFormatRequestAt: "2026-07-22 18:15:25.975704+0800",
    },
  ];
  const processes = new Map([
    [42, { pid: 42, name: "语音程序", command: "/Applications/Voice", startedAt: "Wed Jul 22 16:00:00 2026" }],
    [43, { pid: 43, name: "格式请求程序", command: "/Applications/Format", startedAt: "Wed Jul 22 16:00:00 2026" }],
  ]);
  const terminated: number[] = [];
  const result = await confirmAndReleaseMicrophoneOccupancy(
    [device({ mode: "HFP_HSP", audioLinkType: "tsco" })],
    users,
    "REDMI",
    null,
    "实体端点占用",
    {
      readProcess: (pid) => processes.get(pid) ?? null,
      terminateProcess: (processInfo) => { terminated.push(processInfo.pid); processes.delete(processInfo.pid); },
      wait: async () => {},
    },
  );

  assert.deepEqual(terminated, [42]);
  assert.deepEqual(result.requestedPids, [42]);
  assert.deepEqual(result.users.map((user) => user.pid), [42]);
});

test("页面单独解除通过同一能力处理格式请求占用", async () => {
  const formatUser: MicrophoneUser = {
    pid: 43,
    name: "格式请求程序",
    bundleId: "test.format",
    devices: [],
    occupancyEvidenceKinds: ["unclosed-format-request"],
    unclosedFormatRequestAt: "2026-07-22 18:15:25.975704+0800",
  };
  const processInfo = {
    pid: 43,
    name: "格式请求程序",
    command: "/Applications/Format",
    startedAt: "Wed Jul 22 16:00:00 2026",
  };
  let running = true;
  const result = await confirmAndReleaseMicrophoneOccupancy(
    [device({ mode: "HFP_HSP", audioLinkType: "tsco" })],
    [formatUser],
    "REDMI",
    [43],
    "全部已确认占用",
    {
      readProcess: (pid) => running && pid === 43 ? processInfo : null,
      terminateProcess: () => { running = false; },
      wait: async () => {},
    },
  );

  assert.deepEqual(result.releasedPids, [43]);
  assert.deepEqual(result.users.map((user) => user.pid), [43]);
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
