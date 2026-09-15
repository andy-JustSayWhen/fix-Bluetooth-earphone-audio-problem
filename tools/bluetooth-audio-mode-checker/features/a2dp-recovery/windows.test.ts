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
  let assessment: ReturnType<WindowsRecoveryRuntime["assess"]> = {name: "耳机", mode: "HFP_HSP", a2dpSupport: "UNKNOWN"};
  const runtime: WindowsRecoveryRuntime = {
    read: async () => structuredClone(current),
    set: async (id, role) => {actions.push(`route:${id}:${role}`);},
    restart: async id => {actions.push(`restart:${id}`);},
    release: async () => {actions.push("release"); return emptyRelease;},
    assess: () => assessment,
  };
  return {runtime, actions, get assessment() { return assessment; }, set assessment(value) {assessment = value;}, get state() { return current; }, set state(value) {current = value;}};
}
test("无法确认通话时不执行恢复写操作", async () => {
  const h = harness(); h.state.endpoints = [output];
  h.assessment = {...h.assessment!, mode: "UNKNOWN"};
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

test("共同判定已确认 HFP 时，即使没有麦克风会话也允许进入修复", async () => {
  const h = harness();
  h.state.endpoints = [{...output, sessions: []}];
  const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.equal(h.actions[0], "release");
  assert.equal(result.rebuiltAudioChain, true);
});
test("解除输入后连续三次共同模式判定为高音质才能报告恢复", async () => {
  const h = harness(); let readsAfterRelease = 0;
  h.runtime.release = async () => {
    h.assessment = {...h.assessment!, mode: "A2DP"};
    h.state.endpoints = [output, {...output, id: "hf", role: "handsfree", sessions: []}, {...input, sessions: []}];
    const read = h.runtime.read;
    h.runtime.read = async () => {readsAfterRelease++; return read();};
    return emptyRelease;
  };
  const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.equal(result.ok, true); assert.equal(readsAfterRelease, 3);
  assert.equal(h.actions.some(x => x.startsWith("restart:")), false);
});

test("仅凭输入占用不能绕过共同模式入口，不支持高音质也不执行写操作", async () => {
  for (const assessment of [
    {name: "耳机", mode: "UNKNOWN", a2dpSupport: "UNKNOWN"},
    {name: "耳机", mode: "HFP_HSP", a2dpSupport: "UNSUPPORTED"},
    {name: "另一台", mode: "HFP_HSP", a2dpSupport: "UNKNOWN"},
  ] as const) {
    const h = harness(); h.assessment = assessment;
    const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
    assert.equal(result.ok, assessment.a2dpSupport === "UNSUPPORTED");
    if (assessment.a2dpSupport === "UNSUPPORTED") assert.equal(result.outcome, "无需修复");
    assert.deepEqual(h.actions, []);
  }
});
test("权限失败保留具体步骤且不报告重建完成", async () => {
  const h = harness(); h.runtime.restart = async () => {throw new Error("管理员权限不足");};
  const result = await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.equal(result.rebuiltAudioChain, false);
  assert.ok(result.steps.some(s => s.status === "失败" && s.detail.includes("管理员权限不足")));
});

test("链路残留先只中转输入，再中转输入输出，最后才重启目标", async () => {
  const h = harness();
  const alternateInput = {...input, id: "other-in", name: "内置麦克风", physicalName: "内置麦克风", canonicalId: "other-in", bluetoothAddress: null, transport: "built-in"};
  const alternateOutput = {...output, id: "other-out", name: "内置扬声器", physicalName: "内置扬声器", canonicalId: "other-out", bluetoothAddress: null, transport: "built-in"};
  h.state.endpoints.push(alternateInput, alternateOutput);
  await recoverWindowsAudio("耳机", () => {}, h.runtime.release, h.runtime);
  assert.deepEqual(h.actions, [
    "release",
    "route:other-in:0", "route:in:0",
    "route:other-in:0", "route:other-out:0", "route:other-out:2",
    "route:out:2", "route:out:0", "route:in:0",
    "restart:BTHENUM\\DEV_AABBCCDDEEFF\\1",
  ]);
});
