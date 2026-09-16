import assert from "node:assert/strict";
import test from "node:test";

import { releaseCurrentMicrophoneOccupancy } from "./microphone-release.ts";
import type { AudioModeAssessment } from "../shared/audio-device-types/index.ts";

const device = {
  name: "REDMI",
  inputChannels: 1,
  inputTransport: "bluetooth",
  isDefaultInput: true,
} as AudioModeAssessment;

test("应用层组合入口实时读取实体占用并调用统一解除能力", async () => {
  const processInfo = {
    pid: 42,
    name: "Codex (Service)",
    command: "/Applications/Codex.app/Contents/MacOS/Codex (Service)",
    startedAt: "Wed Jul 22 22:59:00 2026",
  };
  let running = true;
  let readCount = 0;
  const result = await releaseCurrentMicrophoneOccupancy({
    devices: [device],
    formatRequestUsers: [],
    deviceName: "REDMI",
    requestedPids: null,
    evidenceScope: "实体端点占用",
    readPhysicalUsers: async () => {
      readCount += 1;
      return running ? [{
        pid: 42,
        name: "Codex (Service)",
        bundleId: "com.openai.codex.helper",
        devices: ["REDMI"],
      }] : [];
    },
    releaseRuntime: {
      now: Date.now,
      readProcess: () => running ? processInfo : null,
      terminateProcess: () => { running = false; },
      wait: async () => {},
    },
  });

  assert.equal(readCount, 2);
  assert.deepEqual(result.physicalUsers.map((user) => user.pid), []);
  assert.deepEqual(result.release.requestedPids, [42]);
  assert.deepEqual(result.release.releasedPids, [42]);
  assert.deepEqual(result.release.restartedProcesses, []);
});

test("旧进程结束后同名程序以新进程号出现时只报告重启而不再次结束", async () => {
  const oldProcess = {
    pid: 42,
    name: "pallas",
    command: "C:\\WeGame\\pallas.exe",
    startedAt: "2026-09-16T04:23:37.4788267Z",
  };
  let running = true;
  let physicalReadCount = 0;
  const terminated: number[] = [];
  const result = await releaseCurrentMicrophoneOccupancy({
    devices: [{...device, mode: "HFP_HSP"}],
    formatRequestUsers: [],
    deviceName: "REDMI",
    requestedPids: [42],
    evidenceScope: "HFP 暂停输入会话",
    readPhysicalUsers: async () => {
      physicalReadCount += 1;
      return physicalReadCount === 1 ? [{
        pid: 42,
        name: "pallas",
        bundleId: "",
        devices: ["REDMI"],
        inputActivityKind: "HFP 下的暂停输入会话",
      }] : [{
        pid: 84,
        name: "pallas",
        bundleId: "",
        devices: ["REDMI"],
        inputActivityKind: "HFP 下的暂停输入会话",
      }];
    },
    releaseRuntime: {
      now: Date.now,
      readProcess: (pid) => running && pid === 42 ? oldProcess : null,
      terminateProcess: (current) => {
        terminated.push(current.pid);
        running = false;
      },
      wait: async () => {},
    },
  });

  assert.deepEqual(terminated, [42]);
  assert.deepEqual(result.release.releasedPids, [42]);
  assert.deepEqual(result.release.restartedProcesses, [{
    name: "pallas",
    previousPid: 42,
    currentPid: 84,
  }]);
});
