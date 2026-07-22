import assert from "node:assert/strict";
import test from "node:test";
import { runRecovery, type RecoveryRuntime } from "./run-recovery.ts";
import type { AudioModeAssessment, MicrophoneUser, RawAudioDevice } from "../../shared/audio-device-types/index.ts";
import type { RunningProcess } from "../../core/macos-running-apps/index.ts";
import type { AudioChainService } from "../../core/macos-system-services/index.ts";

const targetName = "目标耳机";

function rawDevice(
  name: string,
  transport: string,
  options: Partial<RawAudioDevice> = {},
): RawAudioDevice {
  return {
    id: Math.floor(Math.random() * 10_000), name, uid: name, manufacturer: "",
    transport, sampleRateInput: 16_000, sampleRateOutput: 16_000,
    actualSampleRateInput: 16_000, actualSampleRateOutput: 16_000,
    inputChannels: 1, outputChannels: 2, isRunning: true,
    isDefaultInput: false, isDefaultOutput: false, isDefaultSystemOutput: false,
    ...options,
  };
}

function assessment(overrides: Partial<AudioModeAssessment> = {}): AudioModeAssessment {
  return {
    name: targetName, mode: "HFP_HSP", a2dpSupport: "SUPPORTED", label: "HFP/HSP",
    confidence: "高", isActive: true, isInputActive: true,
    inputTransport: "bluetooth", bluetoothAddress: "AA:BB:CC:DD:EE:FF",
    audioLinkType: "tsco", audioLinkTypeObservedAt: new Date().toISOString(),
    sampleRateOutput: 16_000, availableSampleRateRangesOutput: [{ minimum: 8_000, maximum: 48_000 }],
    nominalSampleRateOutput: 16_000, actualSampleRateOutput: 16_000, maxSupportedOutputRate: 48_000,
    outputChannels: 2, sampleRateInput: 16_000,
    availableSampleRateRangesInput: [{ minimum: 8_000, maximum: 16_000 }],
    nominalSampleRateInput: 16_000, actualSampleRateInput: 16_000, inputChannels: 1,
    isDefaultInput: true, isDefaultOutput: true, isDefaultSystemOutput: true,
    evidence: [], explanation: "",
    ...overrides,
  };
}

type Harness = {
  runtime: RecoveryRuntime;
  actions: string[];
  devices: RawAudioDevice[];
  setAssessment: (next: AudioModeAssessment) => void;
  setUsers: (users: MicrophoneUser[]) => void;
  addProcess: (processInfo: RunningProcess) => void;
};

function harness(): Harness {
  const actions: string[] = [];
  const devices = [
    rawDevice(targetName, "bluetooth", { isDefaultInput: true, isDefaultOutput: true, isDefaultSystemOutput: true }),
    rawDevice("内置麦克风", "built-in", { outputChannels: 0 }),
    rawDevice("内置扬声器", "built-in", { inputChannels: 0 }),
    rawDevice("USB 声卡", "usb"),
  ];
  let currentAssessment = assessment();
  let users: MicrophoneUser[] = [];
  const processes = new Map<number, RunningProcess>();
  const servicePids = new Map<AudioChainService, number>([
    ["bluetoothd", 10], ["bluetoothuserd", 20], ["coreaudiod", 30], ["audioaccessoryd", 40], ["audiomxd", 50],
  ]);
  let bluetoothPower = true;
  const runtime: RecoveryRuntime = {
    now: () => Date.parse("2026-07-22T10:00:00+08:00"),
    wait: async (milliseconds) => { actions.push(`wait:${milliseconds}`); },
    readDevices: () => devices,
    readMicrophoneUsers: async () => users,
    readProcess: (pid) => processes.get(pid) ?? null,
    readProcessesByCommand: (command) => [...processes.values()].filter((item) => item.command === command),
    terminateProcess: (processInfo) => { actions.push(`terminate:${processInfo.name}`); processes.delete(processInfo.pid); },
    readEvidenceSince: () => ({ windowMinutes: 1, events: [], rawLines: [], queryError: null }),
    readModeAssessment: (name) => name === targetName ? currentAssessment : null,
    readModeAssessments: () => [currentAssessment],
    setDefaultDevice: (direction, name) => {
      actions.push(`route:${direction}:${name}`);
      for (const device of devices) {
        if (direction === "input") device.isDefaultInput = device.name === name && device.inputChannels > 0;
        else device.isDefaultOutput = device.name === name && device.outputChannels > 0;
      }
    },
    readBluetoothPower: () => bluetoothPower,
    setBluetoothPower: (enabled) => { bluetoothPower = enabled; actions.push(`power:${enabled ? "on" : "off"}`); },
    readServicePid: (service) => servicePids.get(service) ?? null,
    restartService: (service) => {
      actions.push(`service:${service}`);
      servicePids.set(service, (servicePids.get(service) ?? 0) + 100);
    },
    connectDevice: (name) => { actions.push(`connect:${name}`); },
  };
  return {
    runtime, actions, devices,
    setAssessment: (next) => { currentAssessment = next; },
    setUsers: (next) => { users = next; },
    addProcess: (processInfo) => processes.set(processInfo.pid, processInfo),
  };
}

function request(h: Harness) {
  return {
    name: targetName,
    context: {
      clickedAt: "2026-07-22T10:00:00+08:00",
      defaultInput: targetName,
      defaultOutput: targetName,
      targetSampleRate: 16_000,
      targetAssessment: assessment(),
      deviceAssessments: [assessment()],
    },
  };
}

test("目标不在 HFP/HSP 时不执行任何修复动作", async () => {
  const h = harness();
  h.setAssessment(assessment({ mode: "A2DP", actualSampleRateOutput: 48_000 }));
  const result = await runRecovery(request(h), h.runtime);
  assert.equal(result.outcome, "无需修复");
  assert.deepEqual(h.actions, []);
});

test("第一步先结束实时蓝牙麦克风占用，恢复后立即停止", async () => {
  const h = harness();
  const processInfo = { pid: 88, name: "会议软件", command: "/Applications/Meeting", startedAt: "Tue Jul 22 09:00:00 2026" };
  h.addProcess(processInfo);
  h.setUsers([{ pid: 88, name: "会议软件", bundleId: "", devices: [targetName], inputActivityKind: "已确认实体麦克风占用" }]);
  let active = true;
  h.runtime.terminateProcess = (item) => {
    h.actions.push(`terminate:${item.name}`);
    active = false;
    h.setAssessment(assessment({ mode: "A2DP", actualSampleRateOutput: 48_000 }));
  };
  h.runtime.readProcess = (pid) => active && pid === processInfo.pid ? processInfo : null;
  h.runtime.readProcessesByCommand = () => [];
  const result = await runRecovery(request(h), h.runtime);
  assert.equal(result.outcome, "完全恢复");
  assert.equal(h.actions[0], "terminate:会议软件");
  assert.equal(h.actions.some((item) => item.startsWith("route:")), false);
});

test("任何后续动作前发现目标自行恢复时立即停止", async () => {
  const h = harness();
  h.runtime.readMicrophoneUsers = async () => {
    h.setAssessment(assessment({ mode: "A2DP", actualSampleRateOutput: 48_000 }));
    return [];
  };
  const result = await runRecovery(request(h), h.runtime);
  assert.equal(result.outcome, "完全恢复");
  assert.equal(h.actions.some((item) => item.startsWith("route:") || item.startsWith("service:")), false);
});

test("第二步严格执行输入 A 到非蓝牙 C 再回 A", async () => {
  const h = harness();
  const originalSet = h.runtime.setDefaultDevice;
  h.runtime.setDefaultDevice = (direction, name) => {
    originalSet(direction, name);
    if (direction === "input" && name === targetName && h.actions.includes("route:input:内置麦克风")) {
      h.setAssessment(assessment({ mode: "A2DP", actualSampleRateOutput: 48_000 }));
    }
  };
  const result = await runRecovery(request(h), h.runtime);
  assert.equal(result.outcome, "完全恢复");
  assert.deepEqual(h.actions.filter((item) => item.startsWith("route:")), [
    "route:input:内置麦克风", `route:input:${targetName}`,
  ]);
  assert.equal(h.actions.some((item) => item.startsWith("service:")), false);
});

test("第三步先切输入输出，再先恢复输出 B、最后恢复输入 A", async () => {
  const h = harness();
  const originalSet = h.runtime.setDefaultDevice;
  h.runtime.setDefaultDevice = (direction, name) => {
    originalSet(direction, name);
    const routes = h.actions.filter((item) => item.startsWith("route:"));
    if (routes.slice(-4).join("|") === [
      "route:input:内置麦克风", "route:output:内置扬声器",
      `route:output:${targetName}`, `route:input:${targetName}`,
    ].join("|")) h.setAssessment(assessment({ mode: "A2DP", actualSampleRateOutput: 48_000 }));
  };
  const result = await runRecovery(request(h), h.runtime);
  assert.equal(result.outcome, "完全恢复");
  const routes = h.actions.filter((item) => item.startsWith("route:"));
  assert.deepEqual(routes.slice(-4), [
    "route:input:内置麦克风", "route:output:内置扬声器",
    `route:output:${targetName}`, `route:input:${targetName}`,
  ]);
});

test("第四步在两次路由复位之后才处理已确认格式请求", async () => {
  const h = harness();
  const progressMessages: string[] = [];
  const processInfo = { pid: 77, name: "格式请求软件", command: "/Applications/FormatApp", startedAt: "Tue Jul 22 09:00:00 2026" };
  h.addProcess(processInfo);
  h.runtime.readEvidenceSince = () => {
    h.actions.push("evidence:format");
    return {
      windowMinutes: 1,
      queryError: null,
      rawLines: [],
      events: [
        { kind: "format-request", timestamp: "2026-07-22 10:00:00.000000+0800", timestampMs: Date.parse("2026-07-22T10:00:00+08:00"), requesterPid: 77, from: 0, to: 1, raw: "format 0 -> 1" },
        { kind: "profile", timestamp: "2026-07-22 10:00:00.100000+0800", timestampMs: Date.parse("2026-07-22T10:00:00.100+08:00"), profile: "tsco", raw: "Current profile tsco" },
      ],
    };
  };
  const terminate = h.runtime.terminateProcess;
  h.runtime.terminateProcess = (item) => {
    terminate(item);
    h.setAssessment(assessment({ mode: "A2DP", actualSampleRateOutput: 48_000 }));
  };
  const result = await runRecovery(request(h), h.runtime, (progress) => progressMessages.push(progress.message));
  assert.equal(result.outcome, "完全恢复");
  assert.ok(progressMessages.some((message) => message.includes("格式请求软件（格式请求）")));
  assert.ok(result.diagnosis.evidence.some((item) => item.includes("格式请求软件（格式请求）")));
  const evidenceIndex = h.actions.indexOf("evidence:format");
  const routeActions = h.actions.filter((item) => item.startsWith("route:"));
  assert.equal(routeActions.length, 6);
  assert.ok(evidenceIndex > h.actions.lastIndexOf(`route:input:${targetName}`));
  assert.ok(h.actions.indexOf("terminate:格式请求软件") > evidenceIndex);
});

test("第四步按蓝牙地址去重同一物理设备的重复端点", async () => {
  const h = harness();
  const processInfo = { pid: 77, name: "格式请求软件", command: "/Applications/FormatApp", startedAt: "Tue Jul 22 09:00:00 2026" };
  h.addProcess(processInfo);
  h.devices[0].bluetoothAddress = "50:88:11:07:63:DA";
  h.devices.push(rawDevice(targetName, "bluetooth", {
    uid: `${targetName}-duplicate`,
    bluetoothAddress: "50-88-11-07-63-DA",
    isDefaultInput: false,
    isDefaultOutput: false,
  }));
  h.runtime.readEvidenceSince = () => ({
    windowMinutes: 1,
    queryError: null,
    rawLines: [],
    events: [
      { kind: "format-request", timestamp: "2026-07-22 10:00:00.000000+0800", timestampMs: Date.parse("2026-07-22T10:00:00+08:00"), requesterPid: 77, from: 0, to: 1, raw: "format 0 -> 1" },
      { kind: "profile", timestamp: "2026-07-22 10:00:00.100000+0800", timestampMs: Date.parse("2026-07-22T10:00:00.100+08:00"), profile: "tsco", raw: "Current profile tsco" },
    ],
  });
  const terminate = h.runtime.terminateProcess;
  h.runtime.terminateProcess = (item) => {
    terminate(item);
    h.setAssessment(assessment({ mode: "A2DP", actualSampleRateOutput: 48_000 }));
  };

  const result = await runRecovery(request(h), h.runtime);

  assert.equal(result.outcome, "完全恢复");
  assert.equal(h.actions.includes("terminate:格式请求软件"), true);
});

test("进程不退出时暂停在线性步骤上，且只返回进程阻止授权", async () => {
  const h = harness();
  const processInfo = { pid: 66, name: "占用软件", command: "/Applications/BusyApp", startedAt: "Tue Jul 22 09:00:00 2026" };
  h.addProcess(processInfo);
  h.setUsers([{ pid: 66, name: "占用软件", bundleId: "", devices: [targetName], inputActivityKind: "已确认实体麦克风占用" }]);
  h.runtime.terminateProcess = (item) => { h.actions.push(`terminate:${item.name}`); };
  const result = await runRecovery(request(h), h.runtime);
  assert.equal(result.outcome, "等待授权");
  assert.equal(result.actionRequired?.kind, "relaunch-authorization");
  assert.equal(result._continuation?.roundState.nextStep, 2);
  assert.equal(h.actions.some((item) => item.startsWith("route:")), false);
});

test("第五步只有双蓝牙拒绝证据完整时才结束唯一会话进程", async () => {
  const h = harness();
  h.devices[0].bluetoothAddress = "AA:BB:CC:DD:EE:FF";
  h.devices[0].isDefaultInput = false;
  h.devices.unshift(rawDevice("蓝牙麦克风", "bluetooth", {
    bluetoothAddress: "11:22:33:44:55:66", isDefaultInput: true, isDefaultOutput: false,
  }));
  const processInfo = { pid: 55, name: "双蓝牙软件", command: "/Applications/DualBtApp", startedAt: "Tue Jul 22 09:00:00 2026" };
  h.addProcess(processInfo);
  h.runtime.readEvidenceSince = () => ({
    windowMinutes: 1,
    events: [],
    queryError: null,
    rawLines: [
      "2026-07-22 10:00:00.000000+0800 localhost coreaudiod[100]: session: 双蓝牙软件(55)",
      "2026-07-22 10:00:00.010000+0800 localhost coreaudiod[100]: deviceUIDs 11:22:33:44:55:66:input AA:BB:CC:DD:EE:FF:output",
      "2026-07-22 10:00:00.020000+0800 localhost coreaudiod[100]: There was an error setting the deviceUUIDs as there are more than one BT device connected",
    ],
  });
  const req = request(h);
  req.context.defaultInput = "蓝牙麦克风";
  await runRecovery(req, h.runtime);
  assert.equal(h.actions.filter((item) => item === "terminate:双蓝牙软件").length, 1);
  assert.ok(h.actions.indexOf("terminate:双蓝牙软件") < h.actions.indexOf("power:off"));
});

test("前五步未恢复时按固定服务顺序重建，并保证最终打开蓝牙", async () => {
  const h = harness();
  const result = await runRecovery(request(h), h.runtime);
  assert.equal(result.outcome, "未恢复");
  assert.equal(result.rebuiltAudioChain, true);
  assert.deepEqual(h.actions.filter((item) => item.startsWith("power:") || item.startsWith("service:")), [
    "power:off",
    "service:bluetoothd",
    "service:bluetoothuserd",
    "service:coreaudiod",
    "service:audioaccessoryd",
    "service:audiomxd",
    "power:on",
  ]);
  assert.equal(h.actions.includes(`connect:${targetName}`), false, "目标端点已自动出现时不得再次连接");
});

test("目标没有自动出现时只发起连接，不执行断开重连", async () => {
  const h = harness();
  let powerWasOff = false;
  h.runtime.setBluetoothPower = (enabled) => {
    h.actions.push(`power:${enabled ? "on" : "off"}`);
    powerWasOff = !enabled;
    if (!enabled) h.devices.splice(0, 1);
  };
  h.runtime.readBluetoothPower = () => !powerWasOff;
  h.runtime.connectDevice = (name) => {
    h.actions.push(`connect:${name}`);
    h.devices.unshift(rawDevice(targetName, "bluetooth"));
  };
  await runRecovery(request(h), h.runtime);
  assert.equal(h.actions.filter((item) => item === `connect:${targetName}`).length, 1);
  assert.equal(h.actions.some((item) => item.includes("disconnect")), false);
});
