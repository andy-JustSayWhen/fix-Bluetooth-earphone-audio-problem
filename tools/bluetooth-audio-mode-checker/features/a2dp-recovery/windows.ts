import { getWindowsProbe, endpointDeviceName, type WindowsProbeResult, type WindowsEndpointFacts } from "../../core/windows-audio-probe/index.ts";
import { restartWindowsBluetoothDevice, setWindowsDefaultEndpoint } from "../../core/windows-audio-control/index.ts";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import type { A2dpRecoveryResult, RecoveryMicrophoneReleaseResult, RecoveryProgress, RecoveryStep } from "./types.ts";
import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";
import { isA2dpRecoveryEligible } from "./recovery-policy.ts";

type ModeResult = Pick<AudioModeAssessment, "name" | "mode" | "a2dpSupport">;

export type WindowsRecoveryRuntime = {
  read: () => Promise<WindowsProbeResult>;
  set: (id: string, role?: number) => Promise<unknown>;
  restart: (id: string) => Promise<unknown>;
  release: (name: string) => Promise<RecoveryMicrophoneReleaseResult>;
  assess: () => ModeResult | undefined;
};

const roles = ["Console", "Multimedia", "Comms"] as const;

export function targetEndpoints(result: WindowsProbeResult, name: string): WindowsEndpointFacts[] {
  const matches = result.endpoints.filter(e => e.transport === "bluetooth" && endpointDeviceName(e, result) === name);
  const keys = new Set(matches.map(e => e.canonicalId));
  if (!matches.length || keys.size !== 1) throw new Error("目标蓝牙设备不可用或身份不唯一");
  return matches;
}

export async function recoverWindowsAudio(
  name: string,
  progress: (progress: RecoveryProgress) => void,
  release: WindowsRecoveryRuntime["release"],
  runtime: WindowsRecoveryRuntime = {
    read: () => getWindowsProbe(Date.now()), set: setWindowsDefaultEndpoint,
    restart: restartWindowsBluetoothDevice, release, assess: () => readModeAssessments().find(device => device.name === name),
  },
  readModeAssessments: () => ModeResult[] = () => [],
): Promise<A2dpRecoveryResult> {
  const steps: RecoveryStep[] = [];
  let releasedPrograms: string[] = [], remainingPrograms: string[] = [];
  let rebuiltAudioChain = false;
  const record = (stage: string, status: RecoveryStep["status"], detail: string) => {
    steps.push({stage, status, detail});
    detailedLog(status === "失败" ? "warn" : "info", "windows-recovery.step", {name, stage, status, detail});
  };
  const finish = (ok: boolean, message: string): A2dpRecoveryResult => ({
    ok, outcome: ok ? "完全恢复" : "未恢复", recoveryPath: "固定处理顺序", handledCause: releasedPrograms.length > 0,
    sampleRate: null, releasedPrograms, remainingPrograms, rebuiltAudioChain, steps, message,
    diagnosis: {kind: "证据不足", confidence: "无法确认", summary: message, evidence: steps.map(s => s.detail)},
  });
  const verify = async () => {
    progress({stage: "正在确认稳定", message: "连续读取目标端点与共同模式判定"});
    for (let i = 0; i < 3; i++) {
      targetEndpoints(await runtime.read(), name);
      const assessment = runtime.assess();
      if (assessment?.name !== name || assessment.mode !== "A2DP") return false;
    }
    return true;
  };
  const before = await runtime.read();
  targetEndpoints(before, name);
  const assessment = runtime.assess();
  if (assessment?.name === name && assessment.a2dpSupport === "UNSUPPORTED") {
    record("现场复核", "跳过", "该设备不支持 A2DP，无需恢复。");
    return {...finish(true, "该设备不支持 A2DP，无需恢复。"), outcome: "无需修复"};
  }
  if (assessment?.name !== name || !isA2dpRecoveryEligible(assessment)) {
    if (await verify()) return finish(true, "目标已连续三次确认为高音质输出。");
    record("现场复核", "跳过", "当前没有足够通话模式证据，未执行恢复操作。");
    return finish(false, "当前模式无法确认，请先使用目标设备并刷新。");
  }
  progress({stage: "正在检查占用", message: "重新核实并请求解除目标麦克风占用"});
  try {
    const result = await runtime.release(name);
    releasedPrograms = result.processes.filter(p => result.releasedPids.includes(p.pid)).map(p => p.name);
    remainingPrograms = result.processes.filter(p => result.remainingPids.includes(p.pid) || result.protectedPids.includes(p.pid)).map(p => p.name);
    record("解除麦克风占用", remainingPrograms.length ? "失败" : "成功", `已退出 ${releasedPrograms.length} 个程序，仍占用或受保护 ${remainingPrograms.length} 个。`);
  } catch (error) { record("解除麦克风占用", "失败", String(error)); }
  if (await verify()) return finish(true, "解除占用后，目标连续三次确认为高音质输出。");

  progress({stage: "正在切换声音设备", message: "通过非蓝牙设备中转并恢复原默认角色"});
  const snapshot = await runtime.read();
  const changed: Array<{id: string; role: number}> = [];
  try {
    for (const flow of ["eCapture", "eRender"] as const) {
      const candidate = snapshot.endpoints.filter(e => e.flow === flow && !e.transport.startsWith("bluetooth") && !["unknown", "virtual"].includes(e.transport))
        .sort((a, b) => Number(b.transport === "built-in") - Number(a.transport === "built-in"))[0];
      if (!candidate) { record("默认设备中转", "跳过", `${flow === "eRender" ? "输出" : "输入"}没有可用非蓝牙端点。`); continue; }
      for (let role = 0; role < roles.length; role++) {
        const key = `${flow === "eRender" ? "render" : "capture"}${roles[role]}` as keyof typeof snapshot.defaults;
        const previous = snapshot.defaults[key]?.id;
        if (!previous || previous === candidate.id) continue;
        changed.push({id: previous, role});
        await runtime.set(candidate.id, role);
      }
    }
    await runtime.read();
    record("默认设备中转", "成功", `完成 ${changed.length} 个默认角色的中转请求。`);
  } catch (error) { record("默认设备中转", "失败", String(error)); }
  finally {
    for (const previous of [...changed].reverse()) {
      try { await runtime.set(previous.id, previous.role); }
      catch (error) { record("恢复默认角色", "失败", String(error)); }
    }
  }
  const restored = await runtime.read();
  const mismatch = (Object.keys(snapshot.defaults) as Array<keyof typeof snapshot.defaults>).some(key => snapshot.defaults[key]?.id !== restored.defaults[key]?.id);
  record("默认角色读回", mismatch ? "失败" : "成功", mismatch ? "部分默认角色未恢复，请在页面重新选择。" : "原默认角色已恢复。");
  if (mismatch) return finish(false, "部分默认声音角色未能恢复，请在系统声音设置中确认后再继续。");
  if (await verify()) return finish(true, "目标连续三次确认为高音质输出。");

  progress({stage: "正在重建声音链路", message: "重启目标蓝牙物理设备节点"});
  try {
    const current = targetEndpoints(await runtime.read(), name);
    const id = current[0].canonicalId;
    if (!id || !/^BTHENUM\\DEV_[0-9A-F]{12}\\/i.test(id)) throw new Error("无法确认可重启的蓝牙物理节点");
    await runtime.restart(id);
    record("目标设备重启", "成功", "系统接受目标设备重启请求，继续核实输出端点和模式。");
    for (let i = 0; i < 20; i++) {
      const result = await runtime.read();
      if (result.endpoints.some(e => e.canonicalId === id && e.flow === "eRender")) { rebuiltAudioChain = true; break; }
    }
    if (!rebuiltAudioChain) throw new Error("目标输出端点未重新出现");
    if (await verify()) return finish(true, "目标端点恢复，连续三次确认为高音质输出。");
  } catch (error) { record("目标设备重建", "失败", String(error)); }
  return finish(false, "已完成可执行步骤，但当前证据不足以确认高音质恢复；请查看步骤结果并核实实际听感。");
}
