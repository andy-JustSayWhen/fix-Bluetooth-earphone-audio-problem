import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMultiEndpointRouteChoices,
  orderedRouteCandidates,
  routeDevicePriority,
  selectCauseRoute,
} from "./recovery-policy.ts";
import { retainCurrentMicrophoneGuards } from "./index.ts";
import { parseSystemAudioLog, type FormatRequestEvidence } from "./format-request-diagnosis.ts";
import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

function device(partial: Partial<RawAudioDevice>): RawAudioDevice {
  return {
    id: 1,
    name: "设备",
    uid: "uid",
    manufacturer: "",
    transport: "built-in",
    sampleRateInput: null,
    sampleRateOutput: null,
    inputChannels: 0,
    outputChannels: 0,
    isRunning: false,
    isDefaultInput: false,
    isDefaultOutput: false,
    isDefaultSystemOutput: false,
    ...partial,
  };
}

test("原因路由严格按蓝牙麦克风占用、多端点、残留、格式请求的优先级", () => {
  assert.equal(selectCauseRoute(true, true, true, true), "麦克风占用类");
  assert.equal(selectCauseRoute(false, true, true, true), "麦克风占用类");
  assert.equal(selectCauseRoute(false, false, true, true), "链路残留类");
  assert.equal(selectCauseRoute(false, false, false, true), "格式请求类");
  assert.equal(selectCauseRoute(false, false, false, false), "证据不足");
});

test("设备优先级依次为内置、有线、其他非蓝牙和蓝牙", () => {
  assert.equal(routeDevicePriority(device({ transport: "built-in" })), 0);
  assert.equal(routeDevicePriority(device({ transport: "coreaudio_device_transport_builtin" })), 0);
  assert.equal(routeDevicePriority(device({ transport: "usb" })), 1);
  assert.equal(routeDevicePriority(device({ transport: "2.4g-receiver" })), 1);
  assert.equal(routeDevicePriority(device({ transport: "display-port" })), 1);
  assert.equal(routeDevicePriority(device({ transport: "coreaudio_device_transport_continuity" })), 2);
  assert.equal(routeDevicePriority(device({ transport: "unknown" })), 2);
  assert.equal(routeDevicePriority(device({ transport: "bluetooth" })), 3);
  assert.equal(routeDevicePriority(device({ transport: "bluetooth-le" })), 3);
  assert.equal(routeDevicePriority(device({ transport: "coreaudio_device_transport_bluetooth" })), 3);
});

test("自动候选不受设备枚举顺序影响且同级保持原顺序", () => {
  const candidates = orderedRouteCandidates([
    device({ name: "iPhone 麦克风", transport: "unknown", inputChannels: 1 }),
    device({ name: "USB 麦克风甲", transport: "usb", inputChannels: 1 }),
    device({ name: "蓝牙麦克风", transport: "bluetooth", inputChannels: 1 }),
    device({ name: "内置麦克风", transport: "built-in", inputChannels: 1 }),
    device({ name: "USB 麦克风乙", transport: "usb", inputChannels: 1 }),
  ], "input");

  assert.deepEqual(candidates.map((candidate) => candidate.name), [
    "内置麦克风",
    "USB 麦克风甲",
    "USB 麦克风乙",
    "iPhone 麦克风",
    "蓝牙麦克风",
  ]);
});

test("多端点会话存在内建设备时不展示低优先级组合", () => {
  const choices = createMultiEndpointRouteChoices([
    device({ name: "蓝牙扬声器", transport: "bluetooth", outputChannels: 2, isDefaultOutput: true }),
    device({ name: "蓝牙扬声器", transport: "bluetooth", inputChannels: 1 }),
    device({ name: "蓝牙麦克风", transport: "bluetooth", inputChannels: 1, isDefaultInput: true }),
    device({ name: "蓝牙麦克风", transport: "bluetooth", outputChannels: 2 }),
    device({ name: "内建设备", inputChannels: 1, outputChannels: 2 }),
  ], "蓝牙扬声器");

  assert.deepEqual(new Set(choices.map((choice) => choice.id)), new Set([
    "output:内建设备",
    "input:内建设备",
  ]));
});

test("多端点会话只展示各方向当前最高可用的同级候选", () => {
  const choices = createMultiEndpointRouteChoices([
    device({ name: "蓝牙扬声器", transport: "bluetooth", outputChannels: 2, isDefaultOutput: true }),
    device({ name: "蓝牙扬声器", transport: "bluetooth", inputChannels: 1 }),
    device({ name: "蓝牙麦克风", transport: "bluetooth", inputChannels: 1, isDefaultInput: true }),
    device({ name: "蓝牙麦克风", transport: "bluetooth", outputChannels: 2 }),
    device({ name: "iPhone 麦克风", transport: "unknown", inputChannels: 1 }),
    device({ name: "USB 麦克风甲", transport: "usb", inputChannels: 1 }),
    device({ name: "USB 麦克风乙", transport: "usb", inputChannels: 1 }),
    device({ name: "未知扬声器", transport: "unknown", outputChannels: 2 }),
    device({ name: "USB 扬声器", transport: "usb", outputChannels: 2 }),
  ], "蓝牙扬声器");

  assert.deepEqual(choices.map((choice) => choice.id), [
    "output:USB 扬声器",
    "input:USB 麦克风甲",
    "input:USB 麦克风乙",
  ]);
});

test("多端点会话没有更高优先级候选时才展示其他蓝牙", () => {
  const choices = createMultiEndpointRouteChoices([
    device({ name: "蓝牙扬声器", transport: "bluetooth", outputChannels: 2, isDefaultOutput: true }),
    device({ name: "蓝牙扬声器", transport: "bluetooth", inputChannels: 1 }),
    device({ name: "蓝牙麦克风", transport: "bluetooth", inputChannels: 1, isDefaultInput: true }),
    device({ name: "蓝牙麦克风", transport: "bluetooth", outputChannels: 2 }),
  ], "蓝牙扬声器");

  assert.deepEqual(new Set(choices.map((choice) => choice.id)), new Set([
    "output:蓝牙麦克风",
    "input:蓝牙扬声器",
  ]));
});

test("一键修复包含兜底、重连和三次稳定确认", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  assert.match(source, /临时切换输入/);
  assert.match(source, /reconnectDevice\(name\)/);
  assert.match(source, /consecutive >= 3/);
  assert.doesNotMatch(source, /consecutive >= 6/);
});

test("本次开机阻止授权必须先由服务端进入等待状态", () => {
  const source = readFileSync(join(moduleDirectory, "..", "..", "app", "index.ts"), "utf8");
  const clientSource = readFileSync(join(moduleDirectory, "web", "client.js"), "utf8");
  assert.match(source, /pendingRelaunchAuthorizations\.get\(body\.name\)/);
  assert.match(source, /pending\.continuation\.roundState\.context/);
  assert.match(source, /body\.continueAfterOccupancyEnded === true/);
  assert.match(source, /expiresAt: Date\.now\(\) \+ 30 \* 60 \* 1_000/);
  assert.match(source, /result\.actionRequired\?\.kind === "relaunch-authorization"/);
  assert.match(clientSource, /result\.actionRequired\.processNames/);
  assert.match(clientSource, /涉及进程/);
  assert.match(clientSource, /授权本次开机阻止/);
  assert.match(clientSource, /continueAfterOccupancyEnded: true/);
});

test("麦克风占用授权只保留当前仍在读取的同一路径", async () => {
  const guards = [
    { cause: "麦克风占用类" as const, command: "/usr/libexec/replayd", processName: "replayd" },
    { cause: "麦克风占用类" as const, command: "/Applications/Voice.app/Voice", processName: "Voice" },
    { cause: "格式请求类" as const, command: "/Applications/Format.app/Format", processName: "Format" },
  ];
  const result = await retainCurrentMicrophoneGuards(
    guards,
    async () => [{
      pid: 11,
      name: "replayd",
      bundleId: "",
      devices: ["实体麦克风"],
      inputActivityKind: "已确认实体麦克风占用",
      physicalDeviceNames: ["实体麦克风"],
      confirmedDeviceNames: ["实体麦克风"],
    }],
    (pid) => pid === 11 ? {
      pid,
      name: "replayd",
      command: "/usr/libexec/replayd",
      startedAt: "Mon Jul 20 11:45:39 2026",
    } : null,
  );

  assert.deepEqual(result, [guards[0], guards[2]]);
});

test("麦克风占用授权必须仍对应同一个实体麦克风", async () => {
  const guard = {
    cause: "麦克风占用类" as const,
    command: "/usr/libexec/replayd",
    processName: "replayd",
    microphoneDeviceName: "蓝牙耳机 K03S",
  };
  const result = await retainCurrentMicrophoneGuards(
    [guard],
    async () => [{
      pid: 11,
      name: "replayd",
      bundleId: "",
      devices: ["其他实体麦克风"],
      inputActivityKind: "已确认实体麦克风占用",
      physicalDeviceNames: ["其他实体麦克风"],
      confirmedDeviceNames: ["其他实体麦克风"],
    }],
    (pid) => pid === 11 ? {
      pid,
      name: "replayd",
      command: "/usr/libexec/replayd",
      startedAt: "Mon Jul 20 11:45:39 2026",
    } : null,
  );

  assert.deepEqual(result, []);
});

test("未闭合 0 -> 1 仍成立时保留麦克风占用授权", async () => {
  const guard = {
    cause: "麦克风占用类" as const,
    command: "/Applications/WeType.app/Contents/MacOS/WeType",
    processName: "WeType",
    occupancyEvidence: "unclosed-format-request" as const,
  };
  const line = "2026-07-18 12:47:04.276197+0800 localhost coreaudiod[90589]: [ 30114 ]BTUnifiedAudioDevice: kBluetoothAudioDevicePropertyFormat request 0 ->1";
  const evidence: FormatRequestEvidence = {
    windowMinutes: 10,
    events: parseSystemAudioLog(line),
    rawLines: [line],
    queryError: null,
  };
  const result = await retainCurrentMicrophoneGuards(
    [guard],
    async () => [],
    (pid) => pid === 30114 ? {
      pid,
      name: "WeType",
      command: guard.command,
      startedAt: "Sat Jul 18 09:00:00 2026",
    } : null,
    () => evidence,
  );

  assert.deepEqual(result, [guard]);
});

test("授权前占用读取失败时不得启动麦克风进程阻止任务", async () => {
  const guards = [
    { cause: "麦克风占用类" as const, command: "/usr/libexec/replayd", processName: "replayd" },
    { cause: "格式请求类" as const, command: "/Applications/Format.app/Format", processName: "Format" },
  ];
  const result = await retainCurrentMicrophoneGuards(guards, async () => {
    throw new Error("读取失败");
  });

  assert.deepEqual(result, [guards[1]]);
});

test("多端点组合选择由服务端保存并复核当前路由后执行", () => {
  const source = readFileSync(join(moduleDirectory, "..", "..", "app", "index.ts"), "utf8");
  assert.match(source, /const pendingRouteChoices = new Map/);
  assert.match(source, /currentInputName !== pending\.inputName \|\| currentOutputName !== pending\.outputName/);
  assert.match(source, /_confirmedRouteChoice: confirmedRouteChoice/);
  assert.match(source, /pendingRouteChoices\.set\(body\.name/);
});

test("服务端修复请求只使用当前占用快照和已保存的路由选择", () => {
  const source = readFileSync(join(moduleDirectory, "..", "..", "app", "index.ts"), "utf8");
  assert.doesNotMatch(source, /inspectMultiEndpoint|observedConflict|observedRequester|observedProcess/);
  assert.match(source, /occupancySnapshot: latestOccupancyCapturedAt/);
});

test("一键修复后台持续使用模式判定功能的最新结论", () => {
  const appSource = readFileSync(join(moduleDirectory, "..", "..", "app", "index.ts"), "utf8");
  const featureSource = readFileSync(join(moduleDirectory, "index.ts"), "utf8");
  const runnerSource = readFileSync(join(moduleDirectory, "runner.ts"), "utf8");

  assert.match(appSource, /targetAssessment: currentDevice \?\? null/);
  assert.match(appSource, /\(\) => cachedState\?\.devices \?\? \[\]/);
  assert.match(featureSource, /type: "mode-assessments", assessments/);
  assert.match(runnerSource, /readModeAssessments: \(\) => latestAssessments/);
});
