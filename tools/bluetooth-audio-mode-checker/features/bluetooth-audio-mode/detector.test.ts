import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyActiveInputSnapshot,
  applyActiveOutputSnapshot,
  applyBluetoothLinkSnapshot,
  assessBluetoothDevices,
} from "./index.ts";
import {
  audioLinkTypePresentation,
  deviceModePresentation,
  describeBluetoothRouteRisk,
  isRecoverableOutputDevice,
  observeBluetoothRouteInstability,
} from "./web/client.js";
import {
  isA2dpRecoveryTarget,
  shouldContinueAfterOccupancyEnded,
  successfulRecoverySummary,
} from "../a2dp-recovery/web/client.js";

import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";

function device(overrides: Partial<RawAudioDevice>): RawAudioDevice {
  return {
    id: 1,
    name: "测试耳机",
    uid: "test-device",
    manufacturer: "测试厂商",
    transport: "bluetooth",
    bluetoothAddress: "50-C0-F0-F3-6A-66",
    sampleRateInput: null,
    sampleRateOutput: null,
    availableSampleRateRangesInput: [],
    availableSampleRateRangesOutput: [],
    nominalSampleRateInput: null,
    nominalSampleRateOutput: null,
    actualSampleRateInput: null,
    actualSampleRateOutput: null,
    maxSupportedOutputRate: null,
    inputChannels: 0,
    outputChannels: 0,
    isRunning: false,
    isDefaultInput: false,
    isDefaultOutput: false,
    isDefaultSystemOutput: false,
    supportedBluetoothServices: ["HFP", "A2DP"],
    ...overrides,
  };
}

test("输出可用采样率含高规格且标称采样率不高于 16 kHz 时判定为 HFP 等模式", () => {
  const [result] = assessBluetoothDevices([
    device({
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 48_000 }],
      nominalSampleRateOutput: 16_000,
      actualSampleRateOutput: 44_100,
      sampleRateOutput: 16_000,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(result.mode, "HFP_HSP");
  assert.equal(result.audioLinkType, null);
  assert.match(result.explanation, /标称或实际采样率不高于 16 kHz/);
});

test("输出可用采样率含高规格且实际采样率不高于 16 kHz 时判定为 HFP 等模式", () => {
  const [result] = assessBluetoothDevices([
    device({
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 48_000 }],
      nominalSampleRateOutput: 44_100,
      actualSampleRateOutput: 16_000,
      sampleRateOutput: 16_000,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(result.mode, "HFP_HSP");
});

test("设备最新链路为 tsco 时单独足以判定 HFP 等模式", () => {
  const [assessment] = assessBluetoothDevices([
    device({
      actualSampleRateOutput: 44_100,
      nominalSampleRateOutput: 44_100,
      sampleRateOutput: 44_100,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(assessment.mode, "A2DP");
  const state = applyBluetoothLinkSnapshot({ devices: [assessment], routes: { input: [], output: [] } }, {
    address: "50C0F0F36A66",
    profile: "tsco",
    timestamp: "2026-07-20T12:00:00.000Z",
  });
  assert.equal(state.devices[0].mode, "HFP_HSP");
  assert.equal(state.devices[0].audioLinkType, "tsco");
});

test("链路事件只更新同一蓝牙地址且旧事件不能覆盖新事件", () => {
  const devices = assessBluetoothDevices([
    device({ name: "设备 A", actualSampleRateOutput: 44_100, outputChannels: 2 }),
    device({
      id: 2,
      name: "设备 B",
      bluetoothAddress: "AA-BB-CC-DD-EE-FF",
      actualSampleRateOutput: 44_100,
      outputChannels: 2,
    }),
  ]);
  const initial = { devices, routes: { input: [], output: [] } };
  const withLatest = applyBluetoothLinkSnapshot(initial, {
    address: "AABBCCDDEEFF",
    profile: "tacl",
    timestamp: "2026-07-20T12:01:00.000Z",
  });
  const withOlder = applyBluetoothLinkSnapshot(withLatest, {
    address: "AA:BB:CC:DD:EE:FF",
    profile: "tsco",
    timestamp: "2026-07-20T12:00:00.000Z",
  });

  assert.equal(withOlder.devices.find((item) => item.name === "设备 A")?.audioLinkType, null);
  assert.equal(withOlder.devices.find((item) => item.name === "设备 B")?.audioLinkType, "tacl");
  assert.equal(withOlder.devices.find((item) => item.name === "设备 B")?.mode, "A2DP");
});

test("输出实际采样率高于 16 kHz 且至少双声道才判定为 A2DP 等模式", () => {
  const [result] = assessBluetoothDevices([
    device({
      nominalSampleRateOutput: 44_100,
      actualSampleRateOutput: 44_100,
      sampleRateOutput: 44_100,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
  ]);
  assert.equal(result.mode, "A2DP");
  assert.equal(result.audioLinkType, null);
});

test("仅有高实际采样率但输出为单声道时不判定为 A2DP", () => {
  const [result] = assessBluetoothDevices([
    device({ actualSampleRateOutput: 44_100, sampleRateOutput: 44_100, outputChannels: 1 }),
  ]);
  assert.equal(result.mode, "UNKNOWN");
});

test("只有标称采样率高于 16 kHz 而无法读取实际采样率时不判定为 A2DP", () => {
  const [result] = assessBluetoothDevices([
    device({ nominalSampleRateOutput: 44_100, sampleRateOutput: 44_100, outputChannels: 2 }),
  ]);
  assert.equal(result.mode, "UNKNOWN");
});

test("可用采样率最高只有 16 kHz 时明确判定不支持 A2DP", () => {
  const [result] = assessBluetoothDevices([
    device({
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 16_000 }],
      nominalSampleRateOutput: 16_000,
      actualSampleRateOutput: 16_000,
      sampleRateOutput: 16_000,
      outputChannels: 1,
    }),
  ]);
  assert.equal(result.mode, "UNKNOWN");
  assert.equal(result.a2dpSupport, "UNSUPPORTED");
  assert.equal(isRecoverableOutputDevice(result), false);
  assert.deepEqual(deviceModePresentation(result), {
    className: "a2dp_unsupported",
    text: "不支持A2DP（该设备无需修复）",
  });
});

test("44.1 kHz 是支持 A2DP 的可用采样率边界", () => {
  const [result] = assessBluetoothDevices([
    device({
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
      nominalSampleRateOutput: 16_000,
      actualSampleRateOutput: 16_000,
      sampleRateOutput: 16_000,
      outputChannels: 1,
    }),
  ]);
  assert.equal(result.mode, "HFP_HSP");
  assert.equal(result.a2dpSupport, "SUPPORTED");
  assert.equal(isRecoverableOutputDevice(result), true);
});

test("输出可用采样率无法读取时支持能力未知且不擅自排除修复", () => {
  const deviceWithUnknownSupport = {
    mode: "HFP_HSP",
    a2dpSupport: "UNKNOWN",
  };
  assert.equal(isRecoverableOutputDevice(deviceWithUnknownSupport), true);
  assert.equal(isA2dpRecoveryTarget(deviceWithUnknownSupport), true);
});

test("非默认设备也直接依据自身最新输出事实判定模式", () => {
  const [result] = assessBluetoothDevices([
    device({ actualSampleRateOutput: 44_100, sampleRateOutput: 44_100, outputChannels: 2 }),
  ]);
  assert.equal(result.mode, "A2DP");
});

test("实时输出事件会切换活动设备并按最新输出数据重新判定", () => {
  const devices = assessBluetoothDevices([
    device({
      name: "耳机",
      sampleRateOutput: 44_100,
      nominalSampleRateOutput: 44_100,
      actualSampleRateOutput: 44_100,
      maxSupportedOutputRate: 44_100,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
    device({
      id: 2,
      name: "音箱",
      bluetoothAddress: "AA-BB-CC-DD-EE-FF",
      sampleRateOutput: 44_100,
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
      nominalSampleRateOutput: 44_100,
      actualSampleRateOutput: 44_100,
      maxSupportedOutputRate: 44_100,
      outputChannels: 2,
    }),
  ]);
  const next = applyActiveOutputSnapshot({
    devices,
    routes: { input: [], output: [] },
  }, {
    name: "音箱",
    nominalSampleRate: 16_000,
    actualSampleRate: 16_000,
    outputChannels: 1,
    isRunning: true,
    timestamp: "2026-07-17T00:00:00.000Z",
  });
  assert.equal(next.devices.find((item) => item.name === "耳机")?.mode, "A2DP");
  assert.equal(next.devices.find((item) => item.name === "音箱")?.mode, "HFP_HSP");
  assert.equal(next.devices.find((item) => item.name === "音箱")?.nominalSampleRateOutput, 16_000);
  assert.equal(next.devices.find((item) => item.name === "音箱")?.actualSampleRateOutput, 16_000);
});

test("实时事件中的零采样率按未知处理而不是误判为 HFP", () => {
  const [assessment] = assessBluetoothDevices([
    device({
      sampleRateOutput: 44_100,
      availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
      nominalSampleRateOutput: 44_100,
      actualSampleRateOutput: 44_100,
      outputChannels: 2,
      isDefaultOutput: true,
    }),
  ]);
  const next = applyActiveOutputSnapshot({
    devices: [assessment],
    routes: { input: [], output: [] },
  }, {
    name: "测试耳机",
    nominalSampleRate: 0,
    actualSampleRate: 0,
    outputChannels: 2,
    isRunning: true,
    timestamp: "2026-07-20T12:00:00.000Z",
  });

  assert.equal(next.devices[0].nominalSampleRateOutput, null);
  assert.equal(next.devices[0].actualSampleRateOutput, null);
  assert.equal(next.devices[0].mode, "UNKNOWN");
});

test("设备卡为输入输出展示三类采样率并使用设备级声音链路框", () => {
  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");

  assert.match(source, /createElement\("fieldset", "audio-link-group"\)/);
  assert.match(source, /声音链路类型：/);
  assert.match(source, /metric\("可用采样率"/);
  assert.match(source, /metric\("标称采样率"/);
  assert.match(source, /metric\("实际采样率"/);
  assert.doesNotMatch(source, /当前未刷新输入输出参数/);
});

test("具体声音链路类型统一追加中文解释", () => {
  assert.equal(
    audioLinkTypePresentation("tacl"),
    "tacl（异步传输，用于单向音频播放）",
  );
  assert.equal(
    audioLinkTypePresentation("tsco"),
    "tsco（同步传输，常用于语音通话）",
  );
  assert.equal(audioLinkTypePresentation(null), "无法确认");
  assert.equal(audioLinkTypePresentation("其他值"), "无法确认");
});

test("输入开始或停止采集只更新活动状态，不直接改变模式", () => {
  const [assessment] = assessBluetoothDevices([
    device({
      sampleRateInput: 16_000,
      inputChannels: 1,
      isDefaultInput: true,
    }),
  ]);
  const next = applyActiveInputSnapshot({
    devices: [assessment],
    routes: {
      input: [{ name: "测试耳机", direction: "input", transport: "bluetooth", channels: 1, sampleRate: 16_000, isDefault: true }],
      output: [{ name: "测试耳机", direction: "output", transport: "bluetooth", channels: 1, sampleRate: 16_000, isDefault: false }],
    },
  }, {
    name: "测试耳机",
    isRunning: true,
    nominalSampleRate: 16_000,
    actualSampleRate: 16_000,
  });

  assert.equal(next.devices[0].isActive, true);
  assert.equal(next.devices[0].isInputActive, true);
  assert.equal(next.devices[0].mode, "UNKNOWN");
  assert.equal(next.devices[0].sampleRateInput, 16_000);
  const stopped = applyActiveInputSnapshot(next, {
    name: "测试耳机",
    isRunning: false,
    actualSampleRate: 16_000,
  });
  assert.equal(stopped.devices[0].mode, "UNKNOWN");
  assert.equal(stopped.devices[0].isInputActive, false);
});

test("仅作为输入且明确不支持 A2DP 的设备不显示修复入口", () => {
  const microphone = {
    mode: "HFP_HSP",
    label: "HFP/HSP 模式",
    isInputActive: true,
    isDefaultOutput: false,
    sampleRateInput: 16_000,
    sampleRateOutput: 16_000,
    availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 16_000 }],
    actualSampleRateOutput: 16_000,
    maxSupportedOutputRate: 16_000,
    a2dpSupport: "UNSUPPORTED",
  };

  assert.equal(isRecoverableOutputDevice(microphone), false);
  assert.deepEqual(deviceModePresentation(microphone), {
    className: "a2dp_unsupported",
    text: "不支持A2DP（该设备无需修复）",
  });
});

test("一键修复入口以最新 HFP 模式和 A2DP 支持能力为准", () => {
  assert.equal(isRecoverableOutputDevice({
    isDefaultOutput: true,
    mode: "HFP_HSP",
    a2dpSupport: "SUPPORTED",
    availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
    actualSampleRateOutput: 16_000,
    maxSupportedOutputRate: 44_100,
    sampleRateOutput: 16_000,
  }), true);
  assert.equal(isRecoverableOutputDevice({
    isDefaultOutput: false,
    mode: "HFP_HSP",
    a2dpSupport: "UNSUPPORTED",
    availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 16_000 }],
    actualSampleRateOutput: 16_000,
  }), false);
  assert.equal(isRecoverableOutputDevice({
    isDefaultOutput: true,
    mode: "UNKNOWN",
    availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 16_000 }],
    actualSampleRateOutput: 16_000,
    maxSupportedOutputRate: 16_000,
    sampleRateOutput: 16_000,
  }), false);
  assert.equal(isRecoverableOutputDevice({
    isDefaultOutput: true,
    mode: "HFP_HSP",
    availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
    nominalSampleRateOutput: 16_000,
    actualSampleRateOutput: null,
  }), true);
  assert.equal(isRecoverableOutputDevice({
    isDefaultOutput: true,
    mode: "HFP_HSP",
    availableSampleRateRangesOutput: [],
    actualSampleRateOutput: 16_000,
    maxSupportedOutputRate: 44_100,
  }), true);
  assert.equal(deviceModePresentation({
    mode: "HFP_HSP",
    label: "HFP/HSP 模式",
    isDefaultInput: true,
    isInputActive: true,
    isDefaultOutput: true,
    sampleRateInput: 16_000,
    sampleRateOutput: 16_000,
    maxSupportedOutputRate: 16_000,
  }).text, "HFP等模式（低音质语音模式）");
  assert.equal(deviceModePresentation({
    mode: "HFP_HSP",
    microphoneOccupancy: { isInUse: true },
  }).text, "HFP等模式（低音质语音模式 · 麦克风使用中）");
});

test("无法确认的默认蓝牙麦克风在胶囊只显示判定和采集状态", () => {
  assert.deepEqual(deviceModePresentation({
    mode: "UNKNOWN",
    label: "模式无法确认",
    isDefaultInput: true,
    isInputActive: false,
    isDefaultOutput: false,
  }), {
    className: "unknown",
    text: "模式无法确认",
  });

  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /当前只使用此设备的麦克风|input-only-note/);
});

test("低功耗蓝牙输入运行时展示活动参数但不冒充已识别模式", () => {
  const [assessment] = assessBluetoothDevices([
    device({
      transport: "bluetooth-le",
      sampleRateInput: 32_000,
      inputChannels: 1,
      isDefaultInput: true,
    }),
  ]);
  const next = applyActiveInputSnapshot({ devices: [assessment], routes: { input: [], output: [] } }, {
    name: "测试耳机",
    isRunning: true,
    actualSampleRate: 32_000,
  });

  assert.equal(next.devices[0].isInputActive, true);
  assert.equal(next.devices[0].mode, "UNKNOWN");
  assert.equal(next.devices[0].label, "模式无法确认");
});

test("忽略非蓝牙设备", () => {
  const result = assessBluetoothDevices([
    device({ transport: "usb", isDefaultOutput: true }),
  ]);
  assert.deepEqual(result, []);
});

test("一键修复请求期间立即显示忙碌状态并阻止重复提交", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");
  const busyState = source.indexOf("runningDevices.add(device.name)");
  const request = source.indexOf('fetch("/api/a2dp-recovery"');

  assert.ok(busyState >= 0 && busyState < request);
  assert.match(source, /正在修复，请稍候/);
  assert.match(source, /if \(runningDevices\.has\(device\.name\)\) return/);
});

test("一键修复只在更新时间后显示一个列表级入口", () => {
  const pageSource = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");
  const recoverySource = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");
  const htmlSource = readFileSync(new URL("../../app/web/index.html", import.meta.url), "utf8");

  assert.match(htmlSource, /id="refresh-time"[\s\S]*?id="a2dp-recovery-trigger"/);
  assert.match(pageSource, /triggerContainer: recoveryTriggerElement/);
  assert.doesNotMatch(pageSource, /createElement\("button", "recovery-trigger"/);
  assert.match(recoverySource, /const repairableDevices = devices\.filter\(isA2dpRecoveryTarget\)/);
  assert.match(recoverySource, /`识别到有 \$\{repairableDevices\.length\} 个设备处于 HFP`/);
  assert.doesNotMatch(recoverySource, /其中 \$\{repairableDevices\.length\} 个需要修复/);
  assert.match(recoverySource, /createElement\("button", `recovery-trigger/);
  assert.match(recoverySource, /"一键修复全部需要修复的 HFP 设备"/);
});

test("设备卡片在名称下显示模式且右侧只保留展开图标", () => {
  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./web/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(source, /function routeText/);
  assert.doesNotMatch(source, /已连接，非默认设备/);
  assert.match(source, /title\.append\(createElement\("h2", "", device\.name\), badge\)/);
  assert.match(source, /summary\.append\(icon, title, chevron\)/);
  assert.match(source, /header\.append\(summary\)/);
  assert.doesNotMatch(source, /device-card__mode-actions/);
  assert.match(styles, /\.device-title \{ display: flex;[\s\S]*?flex-direction: column/);
  assert.doesNotMatch(styles, /\.device-card__mode-actions/);
});

test("列表级一键修复逐台处理并在需要用户选择时暂停", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.match(source, /while \(batchQueue\.length > 0\)/);
  assert.match(source, /await recover\(device\)/);
  assert.match(source, /feedbackByDevice\.get\(deviceName\)\?\.result\?\.actionRequired/);
  assert.match(source, /batchPausedDevice = deviceName/);
  assert.match(source, /recoverAndResumeBatch/);
  assert.match(source, /batchStorageKey = "a2dp-recovery-batch-v1"/);
  assert.match(source, /pausedDevice: batchPausedDevice/);
  assert.match(source, /storedBatch\?\.pausedDevice/);
  assert.match(source, /persistBatchState\(\)/);
});

test("同一标签页刷新后保留已完成修复结果但不恢复运行中状态", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.match(source, /window\.sessionStorage\.getItem\(storageKey\)/);
  assert.match(source, /obsoleteAuthorization/);
  assert.match(source, /setFeedback\(device\.name, \{\s+kind: "running"[\s\S]*?\}, false\)/);
  assert.match(source, /setFeedback\(device\.name, \{\s+kind: result\.actionRequired/);
  assert.match(source, /if \(feedback\?\.result\?\.actionRequired\) expandedDevices\.add/);
  assert.doesNotMatch(source, /for \(const deviceName of feedbackByDevice\.keys\(\)\) expandedDevices\.add/);
});

test("多端点确诊后路由选择不会被持续麦克风占用折叠", () => {
  const pageSource = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");
  const recoverySource = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.match(pageSource, /const pendingActionDevice = devices\.find/);
  assert.match(pageSource, /if \(pendingActionDevice\) \{\s+expandedDevices\.add\(pendingActionDevice\.name\)/);
  assert.match(pageSource, /const pendingRouteChoice = recoveryController\.getPendingRouteChoice\(\)/);
  assert.match(pageSource, /showConfirmedRouteConflict\(pendingRouteChoice\)/);
  assert.match(recoverySource, /result\.outcome === "无需修复"[\s\S]*?"neutral"/);
  assert.match(recoverySource, /routeChoiceId: choice\.id/);
  assert.match(recoverySource, /createElement\("div", "recovery-result-header"\)/);
  assert.match(recoverySource, /successfulRecoverySummary\(result, deviceName\)/);
  assert.doesNotMatch(recoverySource, /查看处理详情|recovery-details|工作流：/);
});

test("完成结果只根据实际成功动作生成原因", () => {
  const baseResult = {
    releasedPrograms: [],
    diagnosis: { kind: "麦克风占用类" },
    steps: [],
    usedReconnect: false,
    recoveryPath: "原因对应处理",
  };
  assert.equal(successfulRecoverySummary({
    ...baseResult,
    releasedPrograms: ["语音程序"],
  }, "测试耳机"), "已解除「语音程序」的麦克风占用");
  assert.equal(successfulRecoverySummary({
    ...baseResult,
    steps: [{ stage: "应用多端点替代组合", status: "成功", detail: "保留当前扬声器，麦克风改为“内置麦克风”" }],
  }, "测试耳机"), "已将输入切换为「内置麦克风」");
  assert.equal(successfulRecoverySummary({
    ...baseResult,
    diagnosis: { kind: "格式请求类" },
    releasedPrograms: ["声音程序"],
  }, "测试耳机"), "已结束「声音程序」发起的声音格式请求");
  assert.equal(successfulRecoverySummary({
    ...baseResult,
    guardedPrograms: ["声音程序"],
  }, "测试耳机"), "已在本次开机期间阻止「声音程序」自动拉起");
  assert.equal(successfulRecoverySummary({
    ...baseResult,
    diagnosis: { kind: "链路残留类" },
    releasedPrograms: ["语音程序"],
  }, "测试耳机"), "已解除「语音程序」的输入占用，并已解除残留声音链路并恢复点击前输入输出");
  assert.equal(successfulRecoverySummary({
    ...baseResult,
    diagnosis: { kind: "链路残留类" },
    usedReconnect: true,
  }, "测试耳机"), "已重建「测试耳机」的蓝牙连接并恢复点击前输入输出");
});

test("只有较新的占用快照确认相关进程停止读取时才撤销麦克风授权", () => {
  const feedback = {
    recordedAt: "2026-07-21T00:21:12.380+08:00",
    result: {
      actionRequired: {
        kind: "relaunch-authorization",
        cause: "麦克风占用类",
        triggerState: "still-running",
        processNames: ["replayd"],
      },
    },
  };
  const free = [];
  const unconfirmed = [{ pid: 80530, name: "replayd", bundleId: "", devices: [], inputActivityKind: "未确认麦克风占用的输入活动" }];
  const occupied = [{ pid: 80530, name: "replayd", bundleId: "", devices: ["耳机"], inputActivityKind: "已确认实体麦克风占用" }];

  assert.equal(shouldContinueAfterOccupancyEnded(feedback, free, "2026-07-21T00:21:12.446+08:00"), true);
  assert.equal(shouldContinueAfterOccupancyEnded(feedback, free, "2026-07-21T00:21:12.000+08:00"), false);
  assert.equal(shouldContinueAfterOccupancyEnded(feedback, unconfirmed, "2026-07-21T00:21:12.446+08:00"), true);
  assert.equal(shouldContinueAfterOccupancyEnded(feedback, occupied, "2026-07-21T00:21:12.446+08:00"), false);
  assert.equal(shouldContinueAfterOccupancyEnded({
    ...feedback,
    result: { actionRequired: { ...feedback.result.actionRequired, cause: "格式请求类" } },
  }, free, "2026-07-21T00:21:12.446+08:00"), false);
});

test("无法形成占用证据的声音活动必须脱离具体设备卡片展示", () => {
  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");

  assert.match(source, /其他声音输入活动/);
  assert.match(source, /不属于任何设备的麦克风占用/);
  assert.doesNotMatch(source, /存在未归属读取/);
  assert.match(source, /lastMicrophoneUsers/);
  assert.match(source, /microphoneUsers: lastMicrophoneUsers/);
});

test("不同经典蓝牙输入输出在语音前显示风险提示", () => {
  const routes = {
    input: [{ name: "蓝牙麦克风 A", transport: "bluetooth", isDefault: true }],
    output: [{ name: "蓝牙耳机 B", transport: "bluetooth", isDefault: true }],
  };

  assert.equal(
    describeBluetoothRouteRisk(routes),
    "⚠️注意：当前输入和输出来自两个不同的蓝牙设备，微信输入法等App的语音功能可能无法正常处理这种组合。",
  );
  assert.equal(describeBluetoothRouteRisk({
    input: [{ name: "同一耳机", transport: "bluetooth", isDefault: true }],
    output: [{ name: "同一耳机", transport: "bluetooth", isDefault: true }],
  }), null);
  assert.equal(describeBluetoothRouteRisk({
    input: [{ name: "内建麦克风", transport: "built-in", isDefault: true }],
    output: [{ name: "蓝牙耳机 B", transport: "bluetooth", isDefault: true }],
  }), null);
});

function routeConflictState(mode: "A2DP" | "HFP_HSP", connected = true, inputActive = false) {
  return {
    devices: [
      { name: "蓝牙麦克风 A", mode: "UNKNOWN", isInputActive: inputActive },
      { name: "蓝牙耳机 B", mode },
    ],
    routes: connected ? {
      input: [{ name: "蓝牙麦克风 A", transport: "bluetooth", isDefault: true }],
      output: [{ name: "蓝牙耳机 B", transport: "bluetooth", isDefault: true }],
    } : { input: [], output: [] },
  };
}

test("双蓝牙组合连续两次模式变化后标记路由抖动", () => {
  let observation = observeBluetoothRouteInstability(null, routeConflictState("A2DP"), 1_000);
  assert.equal(observation.unstable, false);
  observation = observeBluetoothRouteInstability(observation.state, routeConflictState("HFP_HSP"), 2_000);
  assert.equal(observation.unstable, false);
  observation = observeBluetoothRouteInstability(observation.state, routeConflictState("A2DP"), 3_000);
  assert.equal(observation.unstable, true);
  assert.equal(observation.triggered, true);
  assert.equal(observation.targetOutputName, "蓝牙耳机 B");
});

test("双蓝牙组合断开后又重连也视为路由抖动", () => {
  let observation = observeBluetoothRouteInstability(null, routeConflictState("A2DP"), 1_000);
  observation = observeBluetoothRouteInstability(observation.state, routeConflictState("A2DP", false), 2_000);
  assert.equal(observation.unstable, false);
  observation = observeBluetoothRouteInstability(observation.state, routeConflictState("A2DP"), 3_000);
  assert.equal(observation.unstable, true);
});

test("双蓝牙输入开始实际采集时记录一次状态变化", () => {
  let observation = observeBluetoothRouteInstability(null, routeConflictState("A2DP"), 1_000);
  assert.equal(observation.triggered, false);
  observation = observeBluetoothRouteInstability(
    observation.state,
    routeConflictState("A2DP", true, true),
    2_000,
  );
  assert.equal(observation.unstable, false);
  assert.equal(observation.triggered, true);
});

test("页面首次扫描只展示双蓝牙实时状态而不自动发起修复", () => {
  const observation = observeBluetoothRouteInstability(
    null,
    routeConflictState("A2DP", true, true),
    1_000,
  );
  assert.equal(observation.unstable, false);
  assert.equal(observation.triggered, true);

  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /scheduleRouteConflictInspection|inspectRouteConflict|inspectMultiEndpoint/);
  assert.match(source, /renderState\(result, options\)/);
});

test("一键修复结果不会因麦克风仍在使用而被页面删除", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /microphoneOccupancy\?\.isInUse\) feedbackByDevice\.delete/);
  assert.match(source, /kind: result\.actionRequired[\s\S]*?result\.ok \? "success" : "error"/);
  assert.match(source, /finally \{\s+runningDevices\.delete\(device\.name\);\s+progressByDevice\.delete/s);
});

test("双蓝牙抖动时立即刷新但不自动发起修复", () => {
  const modeClient = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");
  const recoveryClient = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.doesNotMatch(modeClient, /scheduleSettledRealtimeRender|pendingRealtimeState|realtimeRenderTimer/);
  assert.match(modeClient, /renderState\(result, \{ preserveRouteMessage: true \}\)/);
  assert.match(modeClient, /页面会继续实时显示每次变化/);
  assert.doesNotMatch(modeClient, /inspectRouteConflict|inspectMultiEndpoint/);
  assert.doesNotMatch(recoveryClient, /inspectRouteConflict|inspectMultiEndpoint|observedConflict/);
  assert.match(recoveryClient, /routeChoiceId: choice\.id/);
});

test("多端点处理只能由用户点击一键修复发起", () => {
  const source = readFileSync(new URL("../a2dp-recovery/web/client.js", import.meta.url), "utf8");

  assert.match(source, /"正在保存现场…"/);
  assert.match(source, /正在保存点击现场，然后依次检查多端点与 tsco、实体麦克风占用和链路残留/);
  assert.doesNotMatch(source, /async function inspectRouteConflict|inspectingDevices/);
  assert.match(source, /feedback\?\.source === "inspection"/);
  assert.match(source, /obsoleteUnmarkedInspection/);
});

test("单独解除占用显示阶段并在完成后主动多次复查", () => {
  const source = readFileSync(new URL("./web/client.js", import.meta.url), "utf8");

  assert.match(source, /occupancyBusyDevices\.add\(deviceName\)/);
  assert.match(source, /正在解除并复查…/);
  assert.match(source, /\[350, 900, 1_800\]/);
  assert.match(source, /已重新占用/);
});
