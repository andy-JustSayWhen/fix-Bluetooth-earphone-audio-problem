import test from "node:test";
import assert from "node:assert/strict";
import { runRecovery, type RecoveryRuntime } from "./run-recovery.ts";
import { parseSystemAudioLog, type FormatRequestEvidence } from "./format-request-diagnosis.ts";
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
    readMultiEndpointEvidenceSince: () => emptyEvidence,
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

test("仅作为 16 kHz 输入使用的蓝牙麦克风返回无需修复而不是失败", async () => {
  let evidenceReads = 0;
  let microphoneReads = 0;
  const result = await runRecovery({ name: "DJI 麦克风" }, runtime({
    readDevices: () => [device({
      name: "DJI 麦克风",
      sampleRateInput: 16_000,
      sampleRateOutput: 16_000,
      maxSupportedOutputRate: 16_000,
      outputChannels: 1,
      isDefaultInput: true,
      isDefaultOutput: false,
    }), device({
      id: 2,
      name: "蓝牙耳机 K03S",
      sampleRateOutput: 44_100,
      maxSupportedOutputRate: 44_100,
      isDefaultOutput: true,
    })],
    readMicrophoneUsers: async () => {
      microphoneReads += 1;
      return [microphoneUser];
    },
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }));

  assert.equal(result.outcome, "无需修复");
  assert.equal(result.ok, true);
  assert.match(result.diagnosis.summary, /只作为麦克风输入使用/);
  assert.match(result.message, /16 kHz 输入可以是正常规格/);
  assert.equal(microphoneReads, 0);
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

test("目标输出与实际麦克风不同时仍必须先解除全局占用", async () => {
  let running = true;
  let rate = 16_000;
  let evidenceReads = 0;
  const crossDeviceUser: MicrophoneUser = {
    ...microphoneUser,
    devices: ["蓝牙麦克风 DJI"],
  };
  const result = await runRecovery({
    name: "蓝牙耳机 K03S",
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙麦克风 DJI",
      defaultOutput: "蓝牙耳机 K03S",
      targetSampleRate: 16_000,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [crossDeviceUser],
      },
    },
  }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机 K03S", sampleRateOutput: rate }),
      device({
        id: 2,
        name: "蓝牙麦克风 DJI",
        uid: "58-B8-58-9D-C1-E8:input",
        inputChannels: 1,
        outputChannels: 0,
        sampleRateOutput: null,
        isDefaultInput: true,
        isDefaultOutput: false,
      }),
    ],
    readProcess: () => running ? processInfo : null,
    terminateProcess: () => {
      running = false;
      rate = 44_100;
    },
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.diagnosis.kind, "麦克风占用类");
  assert.deepEqual(result.releasedPrograms, ["VoiceApp"]);
  assert.match(result.diagnosis.evidence[0], /蓝牙麦克风 DJI/);
  assert.equal(evidenceReads, 0);
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

test("非默认蓝牙设备的低采样率不得阻止当前输出命中格式请求类", async () => {
  let running = true;
  let rate = 16_000;
  const rawLines = [
    "2026-07-19 10:00:00.000000+0800 localhost coreaudiod[1]: [ 30114 ]BTUnifiedAudioDevice: kBluetoothAudioDevicePropertyFormat request 0 ->1",
    "2026-07-19 10:00:00.050000+0800 localhost coreaudiod[1]: BTUnifiedAudioDevice: Current profile tsco",
  ];
  const readDevices = () => [
    device({ sampleRateOutput: rate }),
    device({
      id: 2,
      name: "待机蓝牙设备",
      uid: "58-B8-58-9D-C1-E8:output",
      sampleRateOutput: 16_000,
      isRunning: false,
      isDefaultInput: true,
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
  ];
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    readProcess: () => running ? processInfo : null,
    terminateProcess: () => {
      running = false;
      rate = 48_000;
    },
    readEvidence: () => ({
      ...emptyEvidence,
      events: parseSystemAudioLog(rawLines.join("\n")),
      rawLines,
    }),
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.diagnosis.kind, "格式请求类");
  assert.equal(result.recoveryPath, "原因对应处理");
  assert.deepEqual(result.releasedPrograms, ["VoiceApp"]);
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

test("路由抖动后即使目标短暂恢复也只读确认多端点并点名应用", async () => {
  const rawLines = [
    "2026-07-19 10:00:00.000000+0800 localhost coreaudiod[1]: session: VoiceApp(30114)",
    "deviceUIDs:",
    "- 50-C0-F0-F3-6A-66:output",
    "- 58-B8-58-9D-C1-E8:input",
    "2026-07-19 10:00:00.100000+0800 localhost coreaudiod[1]: There was an error setting the deviceUUIDs as there are more than one BT device connected",
  ];
  let microphoneReads = 0;
  let terminated = false;
  let reconnects = 0;
  const result = await runRecovery({
    name: "蓝牙耳机",
    inspectMultiEndpoint: true,
  }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机", uid: "50-C0-F0-F3-6A-66:output", sampleRateOutput: 48_000 }),
      device({ name: "蓝牙麦克风", uid: "58-B8-58-9D-C1-E8:input", inputChannels: 1, outputChannels: 2, isDefaultInput: true, isDefaultOutput: false }),
      device({ name: "内建设备", transport: "built-in", inputChannels: 1, outputChannels: 2, isDefaultOutput: false }),
    ],
    readMicrophoneUsers: async () => {
      microphoneReads += 1;
      return [];
    },
    readProcess: () => processInfo,
    terminateProcess: () => { terminated = true; },
    reconnectDevice: () => { reconnects += 1; },
    readEvidence: () => ({ ...emptyEvidence, rawLines }),
  }));

  assert.equal(result.outcome, "等待选择");
  assert.equal(result.actionRequired?.kind, "route-choice");
  assert.match(result.diagnosis.summary, /VoiceApp/);
  assert.equal(microphoneReads, 0);
  assert.equal(terminated, false);
  assert.equal(reconnects, 0);
});

test("系统在复核前自行改成同一蓝牙设备时仍按十五秒内的前端现场确诊", async () => {
  const rawLines = [
    "2026-07-19 10:00:00.000000+0800 localhost coreaudiod[1]: session: VoiceApp(30114)",
    "deviceUIDs:",
    "- 50-C0-F0-F3-6A-66:output",
    "- 58-B8-58-9D-C1-E8:input",
    "2026-07-19 10:00:00.100000+0800 localhost coreaudiod[1]: There was an error setting the deviceUUIDs as there are more than one BT device connected",
  ];
  let evidenceStartedAt: number | null = null;
  const result = await runRecovery({
    name: "蓝牙耳机",
    inspectMultiEndpoint: true,
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 48_000,
      observedBluetoothConflict: {
        inputName: "蓝牙麦克风",
        outputName: "蓝牙耳机",
        observedAt: new Date(now - 500).toISOString(),
        lookbackSeconds: 300,
      },
    },
  }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机", uid: "50-C0-F0-F3-6A-66:output", sampleRateOutput: 48_000, isDefaultInput: true }),
      device({ name: "蓝牙麦克风", uid: "58-B8-58-9D-C1-E8:input", inputChannels: 1, outputChannels: 2, isDefaultInput: false, isDefaultOutput: false }),
      device({ name: "内建设备", transport: "built-in", inputChannels: 1, outputChannels: 2, isDefaultInput: false, isDefaultOutput: false }),
    ],
    readProcess: () => processInfo,
    readMultiEndpointEvidenceSince: (startedAt) => {
      evidenceStartedAt = startedAt;
      return { ...emptyEvidence, rawLines };
    },
  }));

  assert.equal(result.outcome, "等待选择");
  assert.equal(result.diagnosis.kind, "多端点会话类");
  assert.match(result.diagnosis.summary, /VoiceApp/);
  assert.equal(result.actionRequired?.kind, "route-choice");
  assert.ok(result.actionRequired?.kind === "route-choice" && result.actionRequired.choices.some((choice) =>
    choice.id === "input:内建设备" && choice.preserves === "输出"
  ));
  assert.match(result.steps[0].detail, /输入：蓝牙麦克风；输出：蓝牙耳机/);
  assert.equal(evidenceStartedAt, now - 300_500);
});

test("超过十五秒的前端双蓝牙现场不得绕过当前路由复核", async () => {
  let evidenceReads = 0;
  const result = await runRecovery({
    name: "蓝牙耳机",
    inspectMultiEndpoint: true,
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 48_000,
      observedBluetoothConflict: {
        inputName: "蓝牙麦克风",
        outputName: "蓝牙耳机",
        observedAt: new Date(now - 15_001).toISOString(),
      },
    },
  }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机", sampleRateOutput: 48_000, isDefaultInput: true }),
      device({ name: "蓝牙麦克风", inputChannels: 1, outputChannels: 2, isDefaultInput: false, isDefaultOutput: false }),
    ],
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }));

  assert.equal(result.outcome, "无需修复");
  assert.equal(evidenceReads, 0);
});

test("路由抖动复核证据不足时不切换设备也不走重连兜底", async () => {
  let routeChanges = 0;
  let reconnects = 0;
  const result = await runRecovery({
    name: "蓝牙耳机",
    inspectMultiEndpoint: true,
  }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机", sampleRateOutput: 48_000 }),
      device({ name: "蓝牙麦克风", inputChannels: 1, outputChannels: 2, isDefaultInput: true, isDefaultOutput: false }),
    ],
    setDefaultDevice: () => { routeChanges += 1; },
    reconnectDevice: () => { reconnects += 1; },
  }));

  assert.equal(result.outcome, "未恢复");
  assert.equal(result.diagnosis.kind, "证据不足");
  assert.match(result.message, /没有结束进程或切换设备/);
  assert.equal(routeChanges, 0);
  assert.equal(reconnects, 0);
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
