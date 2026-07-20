import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMultiEndpointRouteChoices,
  selectCauseRoute,
} from "./recovery-policy.ts";
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

test("原因路由严格按占用、多端点、格式请求的优先级", () => {
  assert.equal(selectCauseRoute(true, true, true), "麦克风占用类");
  assert.equal(selectCauseRoute(false, true, true), "多端点会话类");
  assert.equal(selectCauseRoute(false, false, true), "格式请求类");
  assert.equal(selectCauseRoute(false, false, false), "证据不足");
});

test("多端点会话只生成规格允许的四类替代组合", () => {
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
    "output:蓝牙麦克风",
    "input:蓝牙扬声器",
  ]));
});

test("一键修复包含兜底、重连和三次稳定确认", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  assert.match(source, /临时切换到非蓝牙输入/);
  assert.match(source, /reconnectDevice\(name\)/);
  assert.match(source, /consecutive >= 3/);
  assert.doesNotMatch(source, /consecutive >= 6/);
});

test("本次开机阻止授权必须先由服务端进入等待状态", () => {
  const source = readFileSync(join(moduleDirectory, "..", "..", "app", "index.ts"), "utf8");
  const clientSource = readFileSync(join(moduleDirectory, "web", "client.js"), "utf8");
  assert.match(source, /pendingRelaunchAuthorizations\.get\(body\.name\)/);
  assert.match(source, /pending\.continuation\.roundState\.context/);
  assert.match(source, /expiresAt: Date\.now\(\) \+ 30 \* 60 \* 1_000/);
  assert.match(source, /result\.actionRequired\?\.kind === "relaunch-authorization"/);
  assert.match(clientSource, /result\.actionRequired\.processNames/);
  assert.match(clientSource, /涉及进程/);
  assert.match(clientSource, /授权本次开机阻止/);
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
  assert.match(appSource, /cachedState\?\.devices\.find\(\(device\) => device\.name === body\.name\)/);
  assert.match(featureSource, /type: "mode-assessment", assessment/);
  assert.match(runnerSource, /readModeAssessment: \(name\) => latestAssessment\?\.name === name/);
});
