import test from "node:test";
import assert from "node:assert/strict";
import { recoverWindowsAudio, type WindowsRecoveryRuntime } from "./windows.ts";
import type { WindowsEndpointFacts, WindowsProbeResult } from "../../core/windows-audio-probe/index.ts";

const output: WindowsEndpointFacts = {
  id: "out", name: "耳机", physicalName: "耳机", flow: "eRender", transport: "bluetooth", role: "a2dp",
  canonicalId: "BTHENUM\\DEV_AABBCCDDEEFF\\1", bluetoothAddress: "AABBCCDDEEFF", manufacturer: null,
  pnpFound: true, rate: 48000, channels: 2, bits: 32, sessionsKnown: true,
  sessions: [{pid: 100, name: "播放程序", id: "out-session"}],
};
const input: WindowsEndpointFacts = {...output, id: "in", flow: "eCapture", role: "handsfree"};
const emptyRelease = {users: [], processes: [], requestedPids: [], releasedPids: [], remainingPids: [], protectedPids: []};
function harness() {
  let current: WindowsProbeResult = {endpoints: [output, input], defaults: {renderConsole: output, renderComms: output, captureConsole: input}};
  const actions: string[] = [];
  const runtime: WindowsRecoveryRuntime = {
    read: async () => structuredClone(current),
    set: async (id, role) => {actions.push(`route:${id}:${role}`);},
    restart: async id => {actions.push(`restart:${id}`);},
    release: async () => {actions.push("release"); return emptyRelease;},
  };
  return {runtime, actions, get state() { return current; }, set state(value) {current = value;}};
}
test("无法确认通话时不执行恢复写操作", async () => {
  const h = harness(); h.state.endpoints = [output];
  const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.equal(result.ok, false); assert.deepEqual(h.actions, []);
});
test("设备重启成功但统一端点仍无法确认高音质时不得报告完全恢复", async () => {
  const h = harness();
  const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.equal(result.ok, false); assert.equal(result.outcome, "未恢复");
  assert.equal(result.rebuiltAudioChain, true);
  assert.equal(h.actions[0], "release");
  assert.equal(h.actions.filter(x => x.startsWith("restart:")).length, 1);
});
test("目标不存在时不进行操作", async () => {
  const h = harness();
  await assert.rejects(recoverWindowsAudio("另一台", () => {}, h.runtime.release, h.runtime), /不可用/);
  assert.deepEqual(h.actions, []);
});
test("解除输入后连续三次独立立体声证据才能报告恢复", async () => {
  const h = harness(); let readsAfterRelease = 0;
  h.runtime.release = async () => {
    h.state.endpoints = [output, {...output, id: "hf", role: "handsfree", sessions: []}, {...input, sessions: []}];
    const read = h.runtime.read;
    h.runtime.read = async () => {readsAfterRelease++; return read();};
    return emptyRelease;
  };
  const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.equal(result.ok, true); assert.equal(readsAfterRelease, 3);
  assert.equal(h.actions.some(x => x.startsWith("restart:")), false);
});
test("权限失败保留具体步骤且不报告重建完成", async () => {
  const h = harness(); h.runtime.restart = async () => {throw new Error("管理员权限不足");};
  const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.equal(result.rebuiltAudioChain, false);
  assert.ok(result.steps.some(s => s.status === "失败" && s.detail.includes("管理员权限不足")));
});
