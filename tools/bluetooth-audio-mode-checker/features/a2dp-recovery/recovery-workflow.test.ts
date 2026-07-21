import test from "node:test";
import assert from "node:assert/strict";
import { runRecovery, type RecoveryRuntime } from "./run-recovery.ts";
import { parseSystemAudioLog, type FormatRequestEvidence } from "./format-request-diagnosis.ts";
import type { RecoveryRoundState } from "./types.ts";
import type { RunningProcess } from "../../core/macos-running-apps/index.ts";
import type {
  AudioModeAssessment,
  MicrophoneUser,
  RawAudioDevice,
} from "../../shared/audio-device-types/index.ts";

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
  const sampleRateOutput = partial.sampleRateOutput === undefined ? 16_000 : partial.sampleRateOutput;
  const maxSupportedOutputRate = partial.maxSupportedOutputRate ?? 48_000;
  return {
    id: 1,
    name: "蓝牙耳机",
    uid: "50-C0-F0-F3-6A-66:output",
    manufacturer: "",
    transport: "bluetooth",
    sampleRateInput: 16_000,
    sampleRateOutput,
    availableSampleRateRangesOutput: maxSupportedOutputRate > 0
      ? [{ minimum: Math.min(16_000, maxSupportedOutputRate), maximum: maxSupportedOutputRate }]
      : [],
    nominalSampleRateOutput: sampleRateOutput,
    actualSampleRateOutput: sampleRateOutput,
    maxSupportedOutputRate,
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
  const result: RecoveryRuntime = {
    now: () => now,
    wait: async () => {},
    readDevices: () => [device({ sampleRateOutput: 16_000 })],
    readMicrophoneUsers: async () => [],
    readProcess: () => null,
    terminateProcess: () => {},
    readEvidence: () => emptyEvidence,
    readEvidenceSince: () => emptyEvidence,
    readModeAssessment: () => null,
    setDefaultDevice: () => {},
    reconnectDevice: () => {},
    ...overrides,
  };
  if (!overrides.readModeAssessment) {
    result.readModeAssessment = (name) => {
      const target = result.readDevices().find((item) => item.name === name && item.outputChannels > 0);
      if (!target) return null;
      const actualRate = target.actualSampleRateOutput ?? null;
      const supportsHighRate = target.availableSampleRateRangesOutput?.some((range) => range.maximum > 16_000) ?? false;
      const maximumAvailableRate = Math.max(
        0,
        ...(target.availableSampleRateRangesOutput ?? []).map((range) => range.maximum),
      ) || null;
      const mode = actualRate !== null && actualRate > 16_000 && target.outputChannels >= 2
        ? "A2DP"
        : supportsHighRate && actualRate !== null && actualRate <= 16_000
          ? "HFP_HSP"
          : "UNKNOWN";
      return {
        name: target.name,
        mode,
        a2dpSupport: maximumAvailableRate === null
          ? "UNKNOWN"
          : maximumAvailableRate < 44_100 ? "UNSUPPORTED" : "SUPPORTED",
        isDefaultOutput: target.isDefaultOutput,
        audioLinkType: mode === "HFP_HSP" ? "tsco" : mode === "A2DP" ? "tacl" : null,
      } as AudioModeAssessment;
    };
  }
  if (!overrides.readModeAssessments) {
    result.readModeAssessments = () => [...new Set(result.readDevices().map((item) => item.name))]
      .map((name) => result.readModeAssessment(name))
      .filter((assessment): assessment is AudioModeAssessment => assessment !== null);
  }
  return result;
}

function roundState(overrides: Partial<RecoveryRoundState> = {}): RecoveryRoundState {
  return {
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 16_000,
      targetAssessment: null,
    },
    initialOccupancyChecked: true,
    causeReviewCount: 0,
    processAttempts: [],
    linkResidualAttempted: false,
    fallbackInputAttempted: false,
    reconnectAttempted: false,
    initialEvidenceRead: false,
    evidenceSinceMs: null,
    releasedBluetoothInputPrograms: [],
    releasedPrograms: [],
    remainingPrograms: [],
    guardedPrograms: [],
    steps: [],
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

test("一键修复以模式判定结果为准而不在修复模块重算模式", async () => {
  let microphoneReads = 0;
  let evidenceReads = 0;
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [device({ actualSampleRateOutput: 16_000 })],
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode: "A2DP",
      audioLinkType: "tacl",
      isDefaultOutput: true,
    } as AudioModeAssessment),
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
  assert.match(result.diagnosis.summary, /已经退出 HFP\/HSP/);
  assert.equal(microphoneReads, 0);
  assert.equal(evidenceReads, 0);
});

test("采样率已升高但模式仍为 HFP 时不能报告完全恢复", async () => {
  let running = true;
  let rate = 16_000;
  const result = await runRecovery({
    name: "蓝牙耳机",
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 16_000,
      targetAssessment: null,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [microphoneUser],
      },
    },
  }, runtime({
    readDevices: () => [device({
      actualSampleRateOutput: rate,
      sampleRateOutput: rate,
      isDefaultInput: true,
    })],
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      isDefaultOutput: true,
    } as AudioModeAssessment),
    readProcess: () => running ? processInfo : null,
    terminateProcess: () => {
      running = false;
      rate = 48_000;
    },
  }));

  assert.equal(result.outcome, "未恢复");
  assert.notEqual(result.outcome, "完全恢复");
});

test("模式未判为 HFP 时不会因标称采样率低而自行启动修复", async () => {
  let evidenceReads = 0;
  let microphoneReads = 0;
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [device({
      sampleRateOutput: 16_000,
      nominalSampleRateOutput: 16_000,
      actualSampleRateOutput: null,
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
  assert.match(result.diagnosis.summary, /已经退出 HFP\/HSP/);
  assert.equal(microphoneReads, 0);
  assert.equal(evidenceReads, 0);
});

test("缺少高规格可用采样率证据时不允许仅凭旧最高值启动修复", async () => {
  let evidenceReads = 0;
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [device({
      availableSampleRateRangesOutput: [],
      actualSampleRateOutput: 16_000,
      maxSupportedOutputRate: 48_000,
    })],
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }));

  assert.equal(result.outcome, "无需修复");
  assert.match(result.diagnosis.summary, /已经退出 HFP\/HSP/);
  assert.equal(evidenceReads, 0);
});

test("不支持 A2DP 的设备本身无需修复且不会执行任何动作", async () => {
  let reconnects = 0;
  let routeChanges = 0;
  let microphoneReads = 0;
  const result = await runRecovery({ name: "DJI 麦克风" }, runtime({
    readDevices: () => [device({
      name: "DJI 麦克风",
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 16_000 }],
      maxSupportedOutputRate: 16_000,
      outputChannels: 1,
      isDefaultInput: true,
      isDefaultOutput: false,
    })],
    readModeAssessment: () => ({
      name: "DJI 麦克风",
      mode: "HFP_HSP",
      a2dpSupport: "UNSUPPORTED",
      audioLinkType: "tsco",
      isDefaultOutput: false,
      evidence: ["输出可用最高采样率：16 kHz", "A2DP 支持能力：不支持"],
    } as AudioModeAssessment),
    readMicrophoneUsers: async () => {
      microphoneReads += 1;
      return [microphoneUser];
    },
    reconnectDevice: () => { reconnects += 1; },
    setDefaultDevice: () => { routeChanges += 1; },
  }));

  assert.equal(result.outcome, "无需修复");
  assert.match(result.message, /不支持 A2DP.*无需修复/);
  assert.equal(microphoneReads, 0);
  assert.equal(reconnects, 0);
  assert.equal(routeChanges, 0);
});

test("不支持 A2DP 的输入设备仍参与受影响输出的多端点修复", async () => {
  let evidenceReads = 0;
  let microphoneReads = 0;
  const result = await runRecovery({ name: "蓝牙耳机 K03S" }, runtime({
    readDevices: () => [device({
      name: "DJI 麦克风",
      sampleRateInput: 16_000,
      sampleRateOutput: 16_000,
      actualSampleRateOutput: null,
      maxSupportedOutputRate: 16_000,
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 16_000 }],
      outputChannels: 1,
      isDefaultInput: true,
      isDefaultOutput: false,
    }), device({
      id: 2,
      name: "蓝牙耳机 K03S",
      sampleRateOutput: 16_000,
      actualSampleRateOutput: 16_000,
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
      maxSupportedOutputRate: 44_100,
      isDefaultOutput: true,
    })],
    readMicrophoneUsers: async () => {
      microphoneReads += 1;
      return [{ ...microphoneUser, devices: ["DJI 麦克风"] }];
    },
    readModeAssessment: (name) => ({
      name,
      mode: "HFP_HSP",
      a2dpSupport: name === "DJI 麦克风" ? "UNSUPPORTED" : "SUPPORTED",
      audioLinkType: "tsco",
      isDefaultInput: name === "DJI 麦克风",
      isDefaultOutput: name === "蓝牙耳机 K03S",
    } as AudioModeAssessment),
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }));

  assert.equal(result.outcome, "等待选择");
  assert.equal(result.diagnosis.kind, "多端点会话类");
  assert.equal(result.actionRequired?.kind, "route-choice");
  assert.deepEqual(result.releasedPrograms, []);
  assert.equal(microphoneReads, 1);
  assert.equal(evidenceReads, 0);
});

test("同名输入和输出记录并存时优先选择默认输出记录", async () => {
  let rate = 16_000;
  let mode: AudioModeAssessment["mode"] = "HFP_HSP";
  const readDevices = () => [
    device({
      id: 2,
      name: "XIBERIA K03S",
      uid: "XIBERIA K03S-2",
      outputChannels: 1,
      isDefaultInput: true,
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
    device({
      id: 3,
      name: "XIBERIA K03S",
      uid: "XIBERIA K03S-3",
      sampleRateOutput: rate,
      actualSampleRateOutput: rate,
      outputChannels: mode === "A2DP" ? 2 : 1,
      isDefaultInput: false,
      isDefaultOutput: true,
      isDefaultSystemOutput: true,
    }),
  ];
  const result = await runRecovery({ name: "XIBERIA K03S" }, runtime({
    readDevices,
    readModeAssessment: () => ({
      name: "XIBERIA K03S",
      mode,
      audioLinkType: mode === "HFP_HSP" ? "tsco" : "tacl",
      isDefaultOutput: true,
    } as AudioModeAssessment),
    reconnectDevice: () => {
      rate = 44_100;
      mode = "A2DP";
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.sampleRate, 44_100);
  assert.equal(result.usedReconnect, true);
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
      targetAssessment: null,
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
  assert.equal(result.steps.some((step) => step.stage.includes("恢复点击前")), false);
  assert.ok(progress.includes("正在确认稳定"));
});

test("解除占用后重新匹配链路残留，观察到tacl后保持中转输入1秒", async () => {
  let running = true;
  let defaultInput = "蓝牙耳机";
  let rate = 16_000;
  let mode: AudioModeAssessment["mode"] = "HFP_HSP";
  let intermediateElapsedMs = 0;
  let recoveryHolds = 0;
  let reconnects = 0;
  const routeChanges: string[] = [];
  const readDevices = () => [
    device({
      sampleRateOutput: rate,
      actualSampleRateOutput: rate,
      nominalSampleRateOutput: rate,
      isDefaultInput: defaultInput === "蓝牙耳机",
    }),
    device({
      id: 2,
      name: "内置麦克风",
      uid: "built-in-input",
      transport: "built-in",
      inputChannels: 1,
      outputChannels: 0,
      sampleRateInput: 48_000,
      sampleRateOutput: null,
      actualSampleRateOutput: null,
      isDefaultInput: defaultInput === "内置麦克风",
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
  ];
  const result = await runRecovery({
    name: "蓝牙耳机",
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 16_000,
      targetAssessment: null,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [microphoneUser],
      },
    },
  }, runtime({
    readDevices,
    readMicrophoneUsers: async () => [],
    readProcess: () => running ? processInfo : null,
    terminateProcess: () => { running = false; },
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode,
      audioLinkType: mode === "HFP_HSP" ? "tsco" : "tacl",
      isDefaultOutput: true,
    } as AudioModeAssessment),
    wait: async (milliseconds) => {
      if (defaultInput !== "内置麦克风") return;
      if (milliseconds === 50) {
        intermediateElapsedMs += milliseconds;
        if (intermediateElapsedMs >= 450) {
          mode = "A2DP";
          rate = 44_100;
        }
      }
      if (milliseconds === 1_000) recoveryHolds += 1;
    },
    setDefaultDevice: (direction, name) => {
      if (direction !== "input") return;
      routeChanges.push(name);
      if (name === "内置麦克风") {
        defaultInput = name;
        return;
      }
      assert.equal(intermediateElapsedMs, 450);
      assert.equal(recoveryHolds, 1);
      defaultInput = name;
    },
    reconnectDevice: () => { reconnects += 1; },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.diagnosis.kind, "链路残留类");
  assert.equal(result.diagnosis.confidence, "已确认");
  assert.equal(result.recoveryPath, "原因对应处理");
  assert.equal(result.usedReconnect, false);
  assert.equal(reconnects, 0);
  assert.deepEqual(routeChanges, ["内置麦克风", "蓝牙耳机"]);
  assert.equal(intermediateElapsedMs, 450);
  assert.equal(recoveryHolds, 1);
  assert.equal(
    result.steps.find((step) => step.stage === "等待中转期间链路释放")?.status,
    "成功",
  );
  assert.ok(
    result.steps.findIndex((step) => step.stage === "重新匹配当前原因") <
      result.steps.findIndex((step) => step.stage === "临时切换到非蓝牙输入"),
  );
});

test("中转输入500毫秒内未出现tacl时立即切回并继续蓝牙重连", async () => {
  let defaultInput = "蓝牙耳机";
  let rate = 16_000;
  let mode: AudioModeAssessment["mode"] = "HFP_HSP";
  let intermediateElapsedMs = 0;
  let recoveryHolds = 0;
  let reconnects = 0;
  const routeChanges: string[] = [];
  const readDevices = () => [
    device({
      sampleRateOutput: rate,
      actualSampleRateOutput: rate,
      nominalSampleRateOutput: rate,
      isDefaultInput: defaultInput === "蓝牙耳机",
    }),
    device({
      id: 2,
      name: "内置麦克风",
      uid: "built-in-input",
      transport: "built-in",
      inputChannels: 1,
      outputChannels: 0,
      sampleRateInput: 48_000,
      sampleRateOutput: null,
      actualSampleRateOutput: null,
      isDefaultInput: defaultInput === "内置麦克风",
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
  ];

  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode,
      audioLinkType: mode === "HFP_HSP" ? "tsco" : "tacl",
      isDefaultOutput: true,
    } as AudioModeAssessment),
    wait: async (milliseconds) => {
      if (defaultInput !== "内置麦克风") return;
      if (milliseconds === 50) intermediateElapsedMs += milliseconds;
      if (milliseconds === 1_000) recoveryHolds += 1;
    },
    setDefaultDevice: (direction, name) => {
      if (direction !== "input") return;
      routeChanges.push(name);
      defaultInput = name;
    },
    reconnectDevice: () => {
      reconnects += 1;
      mode = "A2DP";
      rate = 44_100;
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.diagnosis.kind, "链路残留类");
  assert.equal(result.usedReconnect, true);
  assert.equal(reconnects, 1);
  assert.deepEqual(routeChanges, ["内置麦克风", "蓝牙耳机"]);
  assert.equal(intermediateElapsedMs, 500);
  assert.equal(recoveryHolds, 0);
  assert.equal(
    result.steps.find((step) => step.stage === "等待中转期间链路释放")?.status,
    "失败",
  );
});

test("点击时没有占用且目标最新链路为 tsco 时直接确认链路残留", async () => {
  let defaultInput = "蓝牙耳机";
  let rate = 16_000;
  let mode: AudioModeAssessment["mode"] = "HFP_HSP";
  const routeChanges: string[] = [];
  const rawLines = [
    "2026-07-19 09:59:59.000000+0800 localhost coreaudiod[1]: BluetoothHALPlugIn_StartIO PID=30114",
    "2026-07-19 09:59:59.050000+0800 localhost coreaudiod[1]: BTUnifiedAudioDevice: Current profile tsco",
  ];
  const readDevices = () => [
    device({
      sampleRateOutput: rate,
      actualSampleRateOutput: rate,
      nominalSampleRateOutput: rate,
      isDefaultInput: defaultInput === "蓝牙耳机",
    }),
    device({
      id: 2,
      name: "内置麦克风",
      uid: "built-in-input",
      transport: "built-in",
      inputChannels: 1,
      outputChannels: 0,
      sampleRateInput: 48_000,
      sampleRateOutput: null,
      actualSampleRateOutput: null,
      isDefaultInput: defaultInput === "内置麦克风",
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
  ];
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    readMicrophoneUsers: async () => [],
    readEvidence: () => ({
      ...emptyEvidence,
      events: parseSystemAudioLog(rawLines.join("\n")),
      rawLines,
    }),
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode,
      audioLinkType: mode === "HFP_HSP" ? "tsco" : "tacl",
      isDefaultOutput: true,
    } as AudioModeAssessment),
    setDefaultDevice: (direction, name) => {
      if (direction !== "input") return;
      routeChanges.push(name);
      defaultInput = name;
      if (name === "内置麦克风") rate = 44_100;
      if (name === "蓝牙耳机") mode = "A2DP";
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.diagnosis.kind, "链路残留类");
  assert.equal(result.diagnosis.confidence, "已确认");
  assert.equal(result.recoveryPath, "原因对应处理");
  assert.deepEqual(routeChanges, ["内置麦克风", "蓝牙耳机"]);
  assert.equal(result.steps.some((step) => step.stage === "确认中转期间链路释放"), false);
});

test("未归属输入活动与目标 tsco 并存时只能归为链路残留", async () => {
  let defaultInput = "蓝牙耳机";
  let rate = 16_000;
  let mode: AudioModeAssessment["mode"] = "HFP_HSP";
  let terminations = 0;
  const unassignedUser: MicrophoneUser = {
    pid: processInfo.pid,
    name: "replayd",
    bundleId: "",
    devices: [],
  };
  const readDevices = () => [
    device({
      sampleRateOutput: rate,
      actualSampleRateOutput: rate,
      nominalSampleRateOutput: rate,
      isDefaultInput: defaultInput === "蓝牙耳机",
    }),
    device({
      id: 2,
      name: "内置麦克风",
      uid: "built-in-input",
      transport: "built-in",
      inputChannels: 1,
      outputChannels: 0,
      sampleRateOutput: null,
      actualSampleRateOutput: null,
      isDefaultInput: defaultInput === "内置麦克风",
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
  ];
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    readMicrophoneUsers: async () => [unassignedUser],
    readProcess: () => processInfo,
    terminateProcess: () => { terminations += 1; },
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode,
      audioLinkType: mode === "HFP_HSP" ? "tsco" : "tacl",
      isDefaultOutput: true,
    } as AudioModeAssessment),
    setDefaultDevice: (direction, name) => {
      if (direction !== "input") return;
      defaultInput = name;
      if (name === "蓝牙耳机") {
        rate = 48_000;
        mode = "A2DP";
      }
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(result.diagnosis.kind, "链路残留类");
  assert.match(result.diagnosis.evidence.at(-1) ?? "", /没有形成.*完整占用证据/);
  assert.deepEqual(result.releasedPrograms, []);
  assert.equal(terminations, 0);
});

test("传输类型未知的输入端点即使标有 tsco 也不得确认占用", async () => {
  let terminations = 0;
  const unknownInputUser: MicrophoneUser = {
    ...microphoneUser,
    devices: ["未知输入端点"],
  };
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [
      device({ isDefaultInput: true }),
      device({
        id: 2,
        name: "未知输入端点",
        uid: "unknown-input",
        transport: null,
        inputChannels: 1,
        outputChannels: 0,
        sampleRateOutput: null,
        actualSampleRateOutput: null,
        isDefaultInput: false,
        isDefaultOutput: false,
        isDefaultSystemOutput: false,
      }),
    ],
    readMicrophoneUsers: async () => [unknownInputUser],
    readProcess: () => processInfo,
    terminateProcess: () => { terminations += 1; },
    readModeAssessments: () => [{
      name: "蓝牙耳机",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      isDefaultOutput: true,
    } as AudioModeAssessment, {
      name: "未知输入端点",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      isDefaultOutput: false,
    } as AudioModeAssessment],
  }));

  assert.equal(result.diagnosis.kind, "链路残留类");
  assert.deepEqual(result.releasedPrograms, []);
  assert.equal(terminations, 0);
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
      targetAssessment: null,
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
    readModeAssessments: () => [{
      name: "蓝牙耳机 K03S",
      mode: rate > 16_000 ? "A2DP" : "HFP_HSP",
      audioLinkType: "tacl",
      isDefaultOutput: true,
    } as AudioModeAssessment, {
      name: "蓝牙麦克风 DJI",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      isDefaultOutput: false,
    } as AudioModeAssessment],
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

test("多端点与目标 tsco 优先于同时存在的实体麦克风占用", async () => {
  let running = true;
  let evidenceReads = 0;
  const routeChanges: Array<{ direction: "input" | "output"; name: string }> = [];
  const result = await runRecovery({
    name: "蓝牙耳机 K03S",
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙麦克风 DJI",
      defaultOutput: "蓝牙耳机 K03S",
      targetSampleRate: 16_000,
      targetAssessment: null,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [{ ...microphoneUser, devices: ["蓝牙麦克风 DJI"] }],
      },
    },
  }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机 K03S", sampleRateOutput: 16_000 }),
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
      device({
        id: 3,
        name: "内置麦克风",
        transport: "built-in",
        inputChannels: 1,
        outputChannels: 0,
        sampleRateOutput: null,
        isDefaultInput: false,
        isDefaultOutput: false,
      }),
    ],
    readMicrophoneUsers: async () => [],
    readProcess: () => running ? processInfo : null,
    terminateProcess: () => { running = false; },
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
    readEvidenceSince: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
    setDefaultDevice: (direction, name) => {
      routeChanges.push({ direction, name });
    },
  }));

  assert.equal(result.outcome, "等待选择");
  assert.equal(result.diagnosis.kind, "多端点会话类");
  assert.deepEqual(result.releasedPrograms, []);
  assert.equal(evidenceReads, 0);
  assert.deepEqual(routeChanges, []);
  assert.equal(result.steps.find((step) => step.stage === "重新匹配当前原因")?.status, "成功");
  assert.equal(result.steps.some((step) => step.stage === "临时切换到非蓝牙输入"), false);
});

test("等待授权结果必须明确列出未退出或再次触发的进程", async () => {
  const result = await runRecovery({
    name: "蓝牙耳机",
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 16_000,
      targetAssessment: null,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [microphoneUser],
      },
    },
  }, runtime({
    readDevices: () => [device({ sampleRateOutput: 16_000, isDefaultInput: true })],
    readMicrophoneUsers: async () => [microphoneUser],
    readProcess: () => processInfo,
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode: "HFP_HSP",
      audioLinkType: "tsco",
      isDefaultOutput: true,
    } as AudioModeAssessment),
    terminateProcess: () => {},
  }));

  assert.equal(result.outcome, "等待授权");
  assert.equal(result.actionRequired?.kind, "relaunch-authorization");
  assert.deepEqual(result.actionRequired?.kind === "relaunch-authorization"
    ? result.actionRequired.processNames
    : [], ["VoiceApp"]);
  assert.equal(result.actionRequired?.kind === "relaunch-authorization"
    ? result.actionRequired.cause
    : null, "麦克风占用类");
  assert.equal(result.actionRequired?.kind === "relaunch-authorization"
    ? result.actionRequired.triggerState
    : null, "still-running");
  assert.match(result.actionRequired?.prompt ?? "", /VoiceApp/);
  assert.match(result.actionRequired?.prompt ?? "", /未能退出且仍在读取麦克风/);
  assert.doesNotMatch(result.actionRequired?.prompt ?? "", /再次读取麦克风/);
  assert.doesNotMatch(result.actionRequired?.prompt ?? "", /自动拉起/);
  assert.ok(result._continuation);
});

test("用户授权后沿用原回合并记录本次开机阻止任务", async () => {
  const waiting = await runRecovery({
    name: "蓝牙耳机",
    context: {
      clickedAt: new Date(now).toISOString(),
      defaultInput: "蓝牙耳机",
      defaultOutput: "蓝牙耳机",
      targetSampleRate: 16_000,
      targetAssessment: null,
      occupancySnapshot: {
        capturedAt: new Date(now - 500).toISOString(),
        users: [microphoneUser],
      },
    },
  }, runtime({
    readDevices: () => [device({ sampleRateOutput: 16_000, isDefaultInput: true })],
    readMicrophoneUsers: async () => [microphoneUser],
    readProcess: () => processInfo,
    terminateProcess: () => {},
  }));
  assert.equal(waiting.outcome, "等待授权");
  assert.ok(waiting._continuation);

  let rate = 16_000;
  const result = await runRecovery({
    name: "蓝牙耳机",
    authorizeRelaunchBlock: true,
    _roundState: waiting._continuation?.roundState,
    _approvedRelaunchGuards: waiting._continuation?.pendingGuards,
  }, runtime({
    readDevices: () => [device({ sampleRateOutput: rate, isDefaultInput: true })],
    wait: async (milliseconds) => {
      if (milliseconds === 100) rate = 48_000;
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.deepEqual(result.guardedPrograms, ["VoiceApp"]);
  assert.equal(result.steps.filter((step) => step.stage === "保存现场").length, 1);
  assert.equal(result.steps.some((step) => step.stage === "启用本次开机阻止自动拉起"), true);
});

test("格式请求进程二次命中时升级授权且不冒充麦克风占用", async () => {
  let terminations = 0;
  const rawLines = [
    "2026-07-19 10:00:00.000000+0800 localhost coreaudiod[1]: [ 30114 ]BTUnifiedAudioDevice: kBluetoothAudioDevicePropertyFormat request 0 ->1",
    "2026-07-19 10:00:00.050000+0800 localhost coreaudiod[1]: BTUnifiedAudioDevice: Current profile tsco",
  ];
  const result = await runRecovery({
    name: "蓝牙耳机",
    _roundState: roundState({
      causeReviewCount: 1,
      initialEvidenceRead: true,
      evidenceSinceMs: now - 1_000,
      processAttempts: [{
        cause: "格式请求类",
        command: processInfo.command,
        processName: processInfo.name,
        automaticProcessPid: processInfo.pid,
        automaticProcessStartedAt: processInfo.startedAt,
        automaticAttempted: true,
        automaticExitConfirmed: true,
        authorizedAttempted: false,
      }],
    }),
  }, runtime({
    readDevices: () => [
      device({ sampleRateOutput: 16_000 }),
      device({
        id: 2,
        name: "内置麦克风",
        uid: "built-in-input",
        transport: "built-in",
        inputChannels: 1,
        outputChannels: 0,
        sampleRateOutput: null,
        actualSampleRateOutput: null,
        isDefaultInput: true,
        isDefaultOutput: false,
        isDefaultSystemOutput: false,
      }),
    ],
    readProcess: () => processInfo,
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode: "HFP_HSP",
      audioLinkType: null,
      isDefaultOutput: true,
    } as AudioModeAssessment),
    readEvidenceSince: () => ({
      ...emptyEvidence,
      events: parseSystemAudioLog(rawLines.join("\n")),
      rawLines,
    }),
    terminateProcess: () => { terminations += 1; },
  }));

  assert.equal(result.outcome, "等待授权");
  assert.equal(result.actionRequired?.kind === "relaunch-authorization"
    ? result.actionRequired.cause
    : null, "格式请求类");
  assert.equal(result.actionRequired?.kind === "relaunch-authorization"
    ? result.actionRequired.triggerState
    : null, "restarted");
  assert.match(result.actionRequired?.prompt ?? "", /退出后再次触发声音格式请求/);
  assert.doesNotMatch(result.actionRequired?.prompt ?? "", /读取麦克风/);
  assert.equal(terminations, 0);
});

test("已授权进程仍命中时本轮终止且不会再次授权或执行动作", async () => {
  let terminations = 0;
  let reconnects = 0;
  const result = await runRecovery({
    name: "蓝牙耳机",
    _roundState: roundState({
      causeReviewCount: 2,
      processAttempts: [{
        cause: "麦克风占用类",
        command: processInfo.command,
        processName: processInfo.name,
        automaticAttempted: true,
        authorizedAttempted: true,
      }],
      guardedPrograms: [processInfo.name],
    }),
  }, runtime({
    readDevices: () => [device({ sampleRateOutput: 16_000, isDefaultInput: true })],
    readMicrophoneUsers: async () => [microphoneUser],
    readProcess: () => processInfo,
    terminateProcess: () => { terminations += 1; },
    reconnectDevice: () => { reconnects += 1; },
  }));

  assert.equal(result.outcome, "未恢复");
  assert.equal(result.actionRequired, undefined);
  assert.match(result.message, /仍再次触发问题，本轮已停止/);
  assert.equal(terminations, 0);
  assert.equal(reconnects, 0);
});

test("链路残留处理已经执行过时直接进入单次重连而不重复切换输入", async () => {
  let reconnects = 0;
  const routeChanges: string[] = [];
  const result = await runRecovery({
    name: "蓝牙耳机",
    _roundState: roundState({
      causeReviewCount: 2,
      linkResidualAttempted: true,
      releasedBluetoothInputPrograms: [processInfo.name],
      releasedPrograms: [processInfo.name],
    }),
  }, runtime({
    readDevices: () => [device({ sampleRateOutput: 16_000, isDefaultInput: true })],
    readMicrophoneUsers: async () => [],
    setDefaultDevice: (_direction, name) => { routeChanges.push(name); },
    reconnectDevice: () => { reconnects += 1; },
  }));

  assert.equal(result.outcome, "未恢复");
  assert.equal(reconnects, 1);
  assert.deepEqual(routeChanges, []);
  assert.equal(result.steps.filter((step) => step.stage === "临时切换到非蓝牙输入").length, 0);
});

test("达到四次原因复查且已重连时立即停止所有后续动作", async () => {
  let microphoneReads = 0;
  let reconnects = 0;
  let routeChanges = 0;
  const result = await runRecovery({
    name: "蓝牙耳机",
    _roundState: roundState({ causeReviewCount: 4, reconnectAttempted: true }),
  }, runtime({
    readMicrophoneUsers: async () => {
      microphoneReads += 1;
      return [microphoneUser];
    },
    reconnectDevice: () => { reconnects += 1; },
    setDefaultDevice: () => { routeChanges += 1; },
  }));

  assert.equal(result.outcome, "未恢复");
  assert.equal(microphoneReads, 0);
  assert.equal(reconnects, 0);
  assert.equal(routeChanges, 0);
  assert.equal(result.steps.some((step) => step.stage === "原因复查上限"), true);
  assert.equal(result.steps.some((step) => step.stage === "断开并重连目标设备" && step.status === "跳过"), true);
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
      isDefaultInput: false,
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
    device({
      id: 3,
      name: "内置麦克风",
      transport: "built-in",
      inputChannels: 1,
      outputChannels: 0,
      sampleRateOutput: null,
      isDefaultInput: true,
      isDefaultOutput: false,
    }),
  ];
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    readProcess: () => running ? processInfo : null,
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode: rate > 16_000 ? "A2DP" : "HFP_HSP",
      audioLinkType: rate > 16_000 ? "tacl" : null,
      isDefaultOutput: true,
    } as AudioModeAssessment),
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
    readModeAssessment: () => ({
      name: "蓝牙耳机",
      mode: rate > 16_000 ? "A2DP" : "HFP_HSP",
      audioLinkType: rate > 16_000 ? "tacl" : null,
      isDefaultOutput: true,
    } as AudioModeAssessment),
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

test("重连命令超时但设备已经恢复时仍恢复原路由并按实际结果成功", async () => {
  let defaultInput = "蓝牙耳机";
  let defaultOutput = "蓝牙耳机";
  let rate = 16_000;
  const readDevices = () => [
    device({
      sampleRateOutput: rate,
      isDefaultInput: defaultInput === "蓝牙耳机",
      isDefaultOutput: defaultOutput === "蓝牙耳机",
    }),
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
    device({
      id: 3,
      name: "内置扬声器",
      uid: "built-in-output",
      transport: "built-in",
      inputChannels: 0,
      outputChannels: 2,
      sampleRateInput: null,
      sampleRateOutput: 48_000,
      isDefaultInput: false,
      isDefaultOutput: defaultOutput === "内置扬声器",
      isDefaultSystemOutput: defaultOutput === "内置扬声器",
    }),
  ];
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    setDefaultDevice: (direction, name) => {
      if (direction === "input") defaultInput = name;
      if (direction === "output") defaultOutput = name;
    },
    reconnectDevice: () => {
      rate = 48_000;
      defaultInput = "内置麦克风";
      defaultOutput = "内置扬声器";
      throw new Error("spawnSync reconnect-device ETIMEDOUT");
    },
  }));

  assert.equal(result.outcome, "完全恢复");
  assert.equal(defaultInput, "蓝牙耳机");
  assert.equal(defaultOutput, "蓝牙耳机");
  assert.equal(result.steps.find((step) => step.stage === "断开并重连目标设备")?.status, "成功");
  assert.doesNotMatch(JSON.stringify(result), /ETIMEDOUT|spawnSync/);
});

test("重连失败且目标仍断开时恢复可用原路由并提示手动重连", async () => {
  let targetVisible = true;
  let defaultInput = "USB 麦克风";
  let defaultOutput = "蓝牙耳机";
  const readDevices = () => [
    ...(targetVisible ? [device({
      isDefaultInput: false,
      isDefaultOutput: defaultOutput === "蓝牙耳机",
    })] : []),
    device({
      id: 2,
      name: "USB 麦克风",
      uid: "usb-input",
      transport: "usb",
      inputChannels: 1,
      outputChannels: 0,
      sampleRateInput: 48_000,
      sampleRateOutput: null,
      isDefaultInput: defaultInput === "USB 麦克风",
      isDefaultOutput: false,
      isDefaultSystemOutput: false,
    }),
    device({
      id: 3,
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
    device({
      id: 4,
      name: "内置扬声器",
      uid: "built-in-output",
      transport: "built-in",
      inputChannels: 0,
      outputChannels: 2,
      sampleRateInput: null,
      sampleRateOutput: 48_000,
      isDefaultInput: false,
      isDefaultOutput: defaultOutput === "内置扬声器",
      isDefaultSystemOutput: defaultOutput === "内置扬声器",
    }),
  ];
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices,
    setDefaultDevice: (direction, name) => {
      if (direction === "input") defaultInput = name;
      if (direction === "output") defaultOutput = name;
    },
    reconnectDevice: () => {
      targetVisible = false;
      defaultInput = "内置麦克风";
      defaultOutput = "内置扬声器";
      throw new Error("spawnSync reconnect-device ETIMEDOUT");
    },
  }));

  assert.equal(result.outcome, "未恢复");
  assert.equal(defaultInput, "USB 麦克风");
  assert.equal(defaultOutput, "内置扬声器");
  assert.match(result.message, /仍断开，需要手动重新连接/);
  assert.doesNotMatch(JSON.stringify(result), /ETIMEDOUT|spawnSync/);
});

test("当前双蓝牙组合仍使目标处于 HFP 时直接返回组合选择", async () => {
  let evidenceReads = 0;
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机", uid: "50-C0-F0-F3-6A-66:output" }),
      device({ name: "蓝牙麦克风", uid: "58-B8-58-9D-C1-E8:input", inputChannels: 1, outputChannels: 2, isDefaultInput: true, isDefaultOutput: false }),
      device({ name: "内建设备", transport: "built-in", inputChannels: 1, outputChannels: 2, isDefaultOutput: false }),
    ],
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
  }));

  assert.equal(result.outcome, "等待选择");
  assert.equal(result.diagnosis.kind, "多端点会话类");
  assert.equal(result.actionRequired?.kind, "route-choice");
  assert.equal(evidenceReads, 0);
  assert.doesNotMatch(result.diagnosis.summary, /应用|进程|微信/);
});

test("目标已经自行退出 HFP 时立即结束且不追查历史会话", async () => {
  let microphoneReads = 0;
  let evidenceReads = 0;
  let routeChanges = 0;
  const result = await runRecovery({ name: "蓝牙耳机" }, runtime({
    readDevices: () => [
      device({ name: "蓝牙耳机", uid: "50-C0-F0-F3-6A-66:output", sampleRateOutput: 48_000 }),
      device({ name: "蓝牙麦克风", uid: "58-B8-58-9D-C1-E8:input", inputChannels: 1, outputChannels: 2, isDefaultInput: true, isDefaultOutput: false }),
    ],
    readMicrophoneUsers: async () => {
      microphoneReads += 1;
      return [];
    },
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
    setDefaultDevice: () => { routeChanges += 1; },
  }));

  assert.equal(result.outcome, "无需修复");
  assert.equal(microphoneReads, 0);
  assert.equal(evidenceReads, 0);
  assert.equal(routeChanges, 0);
});

test("服务端已确认的多端点选择直接复核路由并执行而不重复查日志", async () => {
  let defaultInput = "蓝牙麦克风";
  let rate = 16_000;
  let evidenceReads = 0;
  const readDevices = () => [
    device({ name: "蓝牙耳机", sampleRateOutput: rate, actualSampleRateOutput: rate }),
    device({
      name: "蓝牙麦克风",
      uid: "58-B8-58-9D-C1-E8:input",
      inputChannels: 1,
      outputChannels: 2,
      isDefaultInput: defaultInput === "蓝牙麦克风",
      isDefaultOutput: false,
    }),
    device({
      name: "内建设备",
      transport: "built-in",
      inputChannels: 1,
      outputChannels: 2,
      isDefaultInput: defaultInput === "内建设备",
      isDefaultOutput: false,
    }),
  ];
  const result = await runRecovery({
    name: "蓝牙耳机",
    _confirmedRouteChoice: {
      choice: {
        id: "input:内建设备",
        direction: "input",
        deviceName: "内建设备",
        label: "保留当前扬声器，麦克风改为内建设备",
        preserves: "输出",
      },
      diagnosis: {
        kind: "多端点会话类",
        confidence: "已确认",
        summary: "VoiceApp 提交的双蓝牙组合被系统拒绝",
        evidence: ["已保存的完整系统证据"],
      },
    },
  }, runtime({
    readDevices,
    readEvidence: () => {
      evidenceReads += 1;
      return emptyEvidence;
    },
    setDefaultDevice: (direction, name) => {
      if (direction === "input") {
        defaultInput = name;
        rate = 48_000;
      }
    },
  }));

  assert.equal(result.outcome, "绕过成功");
  assert.equal(defaultInput, "内建设备");
  assert.equal(evidenceReads, 0);
  assert.equal(result.diagnosis.kind, "多端点会话类");
  assert.match(result.message, /不代表原组合已完全修复/);
});

test("等待选择期间目标自行退出 HFP 后不得再执行切换", async () => {
  let routeChanges = 0;
  const result = await runRecovery({
    name: "蓝牙耳机",
    _confirmedRouteChoice: {
      choice: {
        id: "input:内建设备",
        direction: "input",
        deviceName: "内建设备",
        label: "保留当前扬声器，麦克风改为内建设备",
        preserves: "输出",
      },
      diagnosis: {
        kind: "多端点会话类",
        confidence: "已确认",
        summary: "当前双蓝牙组合仍使目标处于 HFP",
        evidence: [],
      },
    },
  }, runtime({
    readDevices: () => [device({ sampleRateOutput: 48_000 })],
    setDefaultDevice: () => { routeChanges += 1; },
  }));

  assert.equal(result.outcome, "无需修复");
  assert.equal(routeChanges, 0);
  assert.match(result.diagnosis.summary, /未执行输入输出切换/);
  assert.match(result.message, /没有修改系统默认输入输出/);
});
