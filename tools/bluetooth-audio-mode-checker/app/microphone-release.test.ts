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
      return [{
        pid: 42,
        name: "Codex (Service)",
        bundleId: "com.openai.codex.helper",
        devices: ["REDMI"],
      }];
    },
    releaseRuntime: {
      now: Date.now,
      readProcess: () => running ? processInfo : null,
      terminateProcess: () => { running = false; },
      wait: async () => {},
    },
  });

  assert.equal(readCount, 1);
  assert.deepEqual(result.physicalUsers.map((user) => user.pid), [42]);
  assert.deepEqual(result.release.requestedPids, [42]);
  assert.deepEqual(result.release.releasedPids, [42]);
});
