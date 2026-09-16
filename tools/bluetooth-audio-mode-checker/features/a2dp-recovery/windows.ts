import { getWindowsProbe, endpointDeviceName, type WindowsProbeResult, type WindowsEndpointFacts } from "../../core/windows-audio-probe/index.ts";
import {
  readConnectedWindowsBluetoothDevices,
  readWindowsBluetoothRadioState,
  reconnectWindowsBluetoothAudio,
  reconnectWindowsBluetoothDevice,
  restartWindowsBluetoothDevice,
  setWindowsBluetoothRadio,
  setWindowsDefaultEndpoint,
  type WindowsConnectedBluetoothDevice,
} from "../../core/windows-audio-control/index.ts";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import type { A2dpRecoveryResult, RecoveryMicrophoneReleaseResult, RecoveryProgress, RecoveryStep } from "./types.ts";
import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";
import { isA2dpRecoveryEligible } from "./recovery-policy.ts";

type ModeResult = Pick<AudioModeAssessment, "name" | "mode" | "a2dpSupport">;

export type WindowsRecoveryRuntime = {
  read: () => Promise<WindowsProbeResult>;
  set: (id: string, role?: number) => Promise<unknown>;
  restart: (id: string) => Promise<unknown>;
  inventory: () => Promise<WindowsConnectedBluetoothDevice[]>;
  radioState: () => Promise<boolean>;
  setRadio: (enabled: boolean) => Promise<unknown>;
  reconnect: (device: WindowsConnectedBluetoothDevice) => Promise<unknown>;
  reconnectAudio: (endpointId: string) => Promise<unknown>;
  wait: (milliseconds: number) => Promise<void>;
  now: () => number;
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
    restart: restartWindowsBluetoothDevice,
    inventory: readConnectedWindowsBluetoothDevices,
    radioState: readWindowsBluetoothRadioState,
    setRadio: setWindowsBluetoothRadio,
    reconnect: reconnectWindowsBluetoothDevice,
    reconnectAudio: reconnectWindowsBluetoothAudio,
    wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now: Date.now,
    release, assess: () => readModeAssessments().find(device => device.name === name),
  },
  readModeAssessments: () => ModeResult[] = () => [],
): Promise<A2dpRecoveryResult> {
  const steps: RecoveryStep[] = [];
  let releasedPrograms: string[] = [], remainingPrograms: string[] = [];
  let rebuiltAudioChain = false;
  let targetRestartAccepted = false;
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
    progress({stage: "正在确认稳定", message: "等待目标进入高音质模式并连续保持三秒"});
    const firstSeenDeadline = runtime.now() + 3_000;
    while (true) {
      targetEndpoints(await runtime.read(), name);
      const assessment = runtime.assess();
      if (assessment?.name === name && assessment.mode === "A2DP") break;
      const remaining = firstSeenDeadline - runtime.now();
      if (remaining <= 0) return false;
      await runtime.wait(Math.min(500, remaining));
    }
    const stableDeadline = runtime.now() + 3_000;
    while (runtime.now() < stableDeadline) {
      await runtime.wait(Math.min(500, stableDeadline - runtime.now()));
      targetEndpoints(await runtime.read(), name);
      const assessment = runtime.assess();
      if (assessment?.name !== name || assessment.mode !== "A2DP") return false;
    }
    return true;
  };
  const before = await runtime.read();
  targetEndpoints(before, name);
  let bluetoothBaseline: WindowsConnectedBluetoothDevice[] | null = null;
  let bluetoothInventoryError: unknown = null;
  try { bluetoothBaseline = await runtime.inventory(); }
  catch (error) { bluetoothInventoryError = error; }
  const assessment = runtime.assess();
  if (assessment?.name === name && assessment.a2dpSupport === "UNSUPPORTED") {
    record("现场复核", "跳过", "该设备不支持 A2DP，无需恢复。");
    return {...finish(true, "该设备不支持 A2DP，无需恢复。"), outcome: "无需修复"};
  }
  if (assessment?.name !== name || !isA2dpRecoveryEligible(assessment)) {
    if (await verify()) return finish(true, "目标已连续三秒确认为高音质输出。");
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
  if (await verify()) return finish(true, "解除占用后，目标连续三秒确认为高音质输出。");

  progress({stage: "正在切换声音设备", message: "先通过另一非蓝牙输入中转并恢复原默认输入"});
  const inputSnapshot = await runtime.read();
  const inputDefaults = roles.map((_, role) => ({
    role,
    endpoint: inputSnapshot.defaults[`capture${roles[role]}` as keyof typeof inputSnapshot.defaults],
  })).filter((item): item is {role: number; endpoint: WindowsEndpointFacts} => Boolean(item.endpoint));
  const originalInputIds = new Set(inputDefaults.map(item => item.endpoint.id));
  const inputCandidate = inputSnapshot.endpoints
    .filter(e => e.flow === "eCapture" && !e.transport.startsWith("bluetooth") && !["unknown", "virtual"].includes(e.transport) && !originalInputIds.has(e.id))
    .sort((a, b) => Number(b.transport === "built-in") - Number(a.transport === "built-in"))[0];
  if (!inputCandidate || inputDefaults.length === 0) {
    record("默认输入中转", "跳过", "没有可用的另一非蓝牙输入或没有可恢复的默认输入。");
  } else {
    let inputSwitchFailed = false;
    try {
      for (const item of inputDefaults) await runtime.set(inputCandidate.id, item.role);
      await runtime.read();
      record("默认输入中转", "成功", `完成 ${inputDefaults.length} 个默认输入角色的中转请求。`);
    } catch (error) {
      inputSwitchFailed = true;
      record("默认输入中转", "失败", String(error));
    } finally {
      for (const item of [...inputDefaults].reverse()) {
        try { await runtime.set(item.endpoint.id, item.role); }
        catch (error) { inputSwitchFailed = true; record("恢复默认输入", "失败", String(error)); }
      }
    }
    const inputRestored = await runtime.read();
    const inputMismatch = inputDefaults.some(item =>
      inputRestored.defaults[`capture${roles[item.role]}` as keyof typeof inputRestored.defaults]?.id !== item.endpoint.id
    );
    record("默认输入读回", inputMismatch ? "失败" : "成功", inputMismatch ? "部分默认输入角色未恢复。" : "原默认输入角色已恢复。");
    if (inputMismatch) return finish(false, "部分默认输入角色未能恢复，请在系统声音设置中确认后再继续。");
    if (!inputSwitchFailed && await verify()) return finish(true, "默认输入中转后，目标连续三秒确认为高音质输出。");
  }

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
  if (await verify()) return finish(true, "目标连续三秒确认为高音质输出。");

  progress({stage: "正在重建声音链路", message: "重启目标蓝牙物理设备节点"});
  try {
    const current = targetEndpoints(await runtime.read(), name);
    const id = current[0].canonicalId;
    if (!id || !/^BTHENUM\\DEV_[0-9A-F]{12}\\/i.test(id)) throw new Error("无法确认可重启的蓝牙物理节点");
    await runtime.restart(id);
    targetRestartAccepted = true;
    record("目标设备重启", "成功", "系统接受目标设备重启请求，继续核实输出端点和模式。");
    for (let i = 0; i < 20; i++) {
      const result = await runtime.read();
      if (result.endpoints.some(e => e.canonicalId === id && e.flow === "eRender")) { rebuiltAudioChain = true; break; }
    }
    if (!rebuiltAudioChain) throw new Error("目标输出端点未重新出现");
    if (await verify()) return finish(true, "目标端点恢复，连续三秒确认为高音质输出。");
  } catch (error) { record("目标设备重建", "失败", String(error)); }

  progress({stage: "正在重建声音链路", message: "记录全部连接设备并重建完整蓝牙链路"});
  if (!targetRestartAccepted) {
    record("完整蓝牙重建预检", "失败", "目标物理节点重启未被系统接受，无法确认具备输入设备补连所需权限，禁止关闭蓝牙。");
    return finish(false, "未关闭蓝牙：请以管理员身份启动工具后重试。");
  }
  if (bluetoothInventoryError || !bluetoothBaseline) {
    record("完整蓝牙重建预检", "失败", `无法记录关闭前的全部已连接设备：${String(bluetoothInventoryError)}`);
    return finish(false, "未关闭蓝牙：无法安全记录全部已连接设备。");
  }
  const uniqueBaselineIds = new Set(bluetoothBaseline.map(device => device.id));
  const unsafeDevices = bluetoothBaseline.filter(device => !device.id || !device.address || !["classic", "le"].includes(device.kind));
  if (bluetoothBaseline.length === 0 || uniqueBaselineIds.size !== bluetoothBaseline.length || unsafeDevices.length > 0) {
    record("完整蓝牙重建预检", "失败", unsafeDevices.length
      ? `以下连接设备缺少稳定身份或主动重连路径：${unsafeDevices.map(device => device.name).join("、")}`
      : "关闭前连接清单为空或包含重复身份，禁止关闭蓝牙。");
    return finish(false, "未关闭蓝牙：连接设备清单无法作为安全恢复基线。");
  }
  record("完整蓝牙重建预检", "成功", `已记录 ${bluetoothBaseline.length} 台已连接设备：${bluetoothBaseline.map(device => device.name).join("、")}`);

  const waitForRadio = async (enabled: boolean, timeout: number) => {
    const deadline = runtime.now() + timeout;
    do {
      if (await runtime.radioState() === enabled) return true;
      const remaining = deadline - runtime.now();
      if (remaining <= 0) return false;
      await runtime.wait(Math.min(100, remaining));
    } while (runtime.now() <= deadline);
    return false;
  };
  const waitForBaseline = async (timeout: number) => {
    const deadline = runtime.now() + timeout;
    let connected: WindowsConnectedBluetoothDevice[] = [];
    do {
      connected = await runtime.inventory();
      const ids = new Set(connected.map(device => device.id));
      const missing = bluetoothBaseline!.filter(device => !ids.has(device.id));
      if (missing.length === 0) return {connected, missing};
      const remaining = deadline - runtime.now();
      if (remaining <= 0) return {connected, missing};
      await runtime.wait(Math.min(500, remaining));
    } while (runtime.now() <= deadline);
    const ids = new Set(connected.map(device => device.id));
    return {connected, missing: bluetoothBaseline!.filter(device => !ids.has(device.id))};
  };
  const keepRadioOn = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (await runtime.radioState()) return true;
        await runtime.setRadio(true);
        if (await waitForRadio(true, 10_000)) return true;
      } catch { /* The next attempt still tries to leave Bluetooth on. */ }
    }
    return false;
  };

  let radioWasConfirmedOff = false;
  try {
    await runtime.setRadio(false);
    radioWasConfirmedOff = await waitForRadio(false, 5_000);
    if (!radioWasConfirmedOff) throw new Error("关闭请求后未能独立确认蓝牙已经关闭");
    record("关闭蓝牙", "成功", "已独立回读确认蓝牙关闭。");

    await runtime.setRadio(true);
    if (!await waitForRadio(true, 10_000)) throw new Error("打开请求后未能独立确认蓝牙已经开启");
    radioWasConfirmedOff = false;
    record("打开蓝牙", "成功", "已独立回读确认蓝牙开启，开始等待 Windows 自动重连。");

    let recovery = await waitForBaseline(10_000);
    if (recovery.missing.length === 0) {
      record("系统自动重连", "成功", "关闭前记录的全部蓝牙设备均已由 Windows 自动恢复。");
    } else {
      record("系统自动重连", "失败", `未自动恢复：${recovery.missing.map(device => device.name).join("、")}`);
      const audioEndpoints = new Map<string, string[]>();
      for (const endpoint of before.endpoints) {
        if (!endpoint.bluetoothAddress || !endpoint.transport.startsWith("bluetooth")) continue;
        const ids = audioEndpoints.get(endpoint.bluetoothAddress) ?? [];
        if (!ids.includes(endpoint.id)) ids.push(endpoint.id);
        audioEndpoints.set(endpoint.bluetoothAddress, ids);
      }
      for (let round = 1; round <= 2 && recovery.missing.length > 0; round++) {
        for (const device of recovery.missing) {
          for (const endpointId of audioEndpoints.get(device.address!) ?? []) {
            try { await runtime.reconnectAudio(endpointId); }
            catch (error) { record("声音设备主动补连", "失败", `${device.name}：${String(error)}`); }
          }
          try { await runtime.reconnect(device); }
          catch (error) { record("蓝牙设备主动补连", "失败", `${device.name}：${String(error)}`); }
        }
        record("蓝牙设备主动补连", "成功", `已对第 ${round} 轮缺失设备发起主动补连请求，继续按连接状态验收。`);
        recovery = await waitForBaseline(10_000);
      }
    }
    if (recovery.missing.length > 0) {
      record("全部设备恢复验收", "失败", `仍未连接：${recovery.missing.map(device => device.name).join("、")}`);
      return finish(false, `蓝牙已保持开启，但以下原已连接设备未恢复：${recovery.missing.map(device => device.name).join("、")}`);
    }
    record("全部设备恢复验收", "成功", `关闭前记录的 ${bluetoothBaseline.length} 台设备已全部重新连接。`);

    const current = await runtime.read();
    let routeFailure = false;
    for (const [key, endpoint] of Object.entries(before.defaults)) {
      if (!endpoint) continue;
      const role = roles.findIndex(role => key.endsWith(role));
      if (role < 0 || !current.endpoints.some(candidate => candidate.id === endpoint.id)) {
        routeFailure = true;
        record("恢复默认声音路由", "失败", `${endpoint.name} 的原默认角色当前不可用。`);
        continue;
      }
      try { await runtime.set(endpoint.id, role); }
      catch (error) { routeFailure = true; record("恢复默认声音路由", "失败", `${endpoint.name}：${String(error)}`); }
    }
    const routed = await runtime.read();
    const routeMismatch = (Object.keys(before.defaults) as Array<keyof typeof before.defaults>)
      .some(key => before.defaults[key]?.id !== routed.defaults[key]?.id);
    if (routeFailure || routeMismatch) {
      record("默认声音路由验收", "失败", "部分关闭前的默认声音角色未恢复。");
      return finish(false, "全部蓝牙设备已重新连接，但原默认声音路由未完全恢复。");
    }
    record("默认声音路由验收", "成功", "关闭前的默认输入输出角色已恢复。");
    rebuiltAudioChain = true;
    if (await verify()) return finish(true, "全部原已连接蓝牙设备和默认声音路由均已恢复，目标已稳定进入高音质输出。");
  } catch (error) {
    record("完整蓝牙链路重建", "失败", String(error));
  } finally {
    if (radioWasConfirmedOff || !await runtime.radioState().catch(() => false)) {
      if (!await keepRadioOn()) record("保持蓝牙开启", "失败", "结束前仍无法确认蓝牙已经开启。");
    }
  }
  return finish(false, "已完成可执行步骤，但当前证据不足以确认高音质恢复；请查看步骤结果并核实实际听感。");
}
