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
  assert.match(source, /pendingRelaunchAuthorizations\.has\(body\.name\)/);
  assert.match(source, /result\.actionRequired\?\.kind === "relaunch-authorization"/);
});
