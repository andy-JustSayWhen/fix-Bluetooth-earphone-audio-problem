import assert from "node:assert/strict";
import test from "node:test";

import {
  terminateAndConfirmRunningProcesses,
  type RunningProcess,
} from "./index.ts";

function processInfo(overrides: Partial<RunningProcess> = {}): RunningProcess {
  return {
    pid: 42,
    name: "语音应用",
    command: "/Applications/Voice.app/Contents/MacOS/Voice",
    startedAt: "Wed Jul 22 16:00:00 2026",
    ...overrides,
  };
}

test("统一退出能力永远不向系统核心进程发送退出请求", async () => {
  const protectedProcess = processInfo({
    pid: 99,
    name: "coreaudiod",
    command: "/usr/sbin/coreaudiod",
  });
  const terminated: number[] = [];
  const result = await terminateAndConfirmRunningProcesses([protectedProcess], {
    now: Date.now,
    readProcess: () => protectedProcess,
    terminateProcess: (current) => { terminated.push(current.pid); },
    wait: async () => {},
  });

  assert.deepEqual(terminated, []);
  assert.deepEqual(result.requestedPids, []);
  assert.deepEqual(result.releasedPids, []);
  assert.deepEqual(result.remainingPids, []);
  assert.deepEqual(result.protectedPids, [99]);
});

test("统一退出能力只等待同一进程身份并按真实期限停止", async () => {
  const expected = processInfo();
  let now = 1_000;
  let waits = 0;
  const result = await terminateAndConfirmRunningProcesses([expected], {
    now: () => now,
    readProcess: () => expected,
    terminateProcess: () => {},
    wait: async (milliseconds) => { now += milliseconds; waits += 1; },
  });

  assert.equal(now, 3_000);
  assert.equal(waits, 20);
  assert.deepEqual(result.remainingPids, [42]);
});

test("旧进程身份已经消失时视为解除，不结束复用同一进程号的新程序", async () => {
  const expected = processInfo();
  const replacement = processInfo({ command: "/Applications/Other.app/Contents/MacOS/Other" });
  const terminated: number[] = [];
  const result = await terminateAndConfirmRunningProcesses([expected], {
    now: Date.now,
    readProcess: () => replacement,
    terminateProcess: (current) => { terminated.push(current.pid); },
    wait: async () => {},
  });

  assert.deepEqual(terminated, []);
  assert.deepEqual(result.requestedPids, []);
  assert.deepEqual(result.releasedPids, [42]);
});
