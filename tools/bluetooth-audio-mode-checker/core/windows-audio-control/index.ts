import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { powershellExecutable } from "../../shared/windows-powershell/index.ts";

const script = fileURLToPath(new URL("./control.ps1", import.meta.url));
const baseArgs = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script];
const options = { encoding: "utf8" as const, windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 };

export function runWindowsControl(action: string, args: string[] = [], timeout = options.timeout): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(powershellExecutable(), [...baseArgs, "-Action", action, ...args], {...options, timeout}, (error, stdout, stderr) => {
      if (error) { reject(new Error(`Windows 操作失败：${stderr.trim() || error.message}`)); return; }
      try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error("Windows 操作没有返回有效结果")); }
    });
  });
}

export function setWindowsDefaultEndpoint(id: string, role?: number): Promise<unknown> {
  return runWindowsControl("route", ["-EndpointId", id, ...(role === undefined ? [] : ["-Role", String(role)])]);
}

export function restartWindowsBluetoothDevice(instanceId: string): Promise<unknown> {
  return runWindowsControl("restart", ["-InstanceId", instanceId]);
}

export type WindowsConnectedBluetoothDevice = {
  id: string;
  name: string;
  kind: "classic" | "le";
  address: string | null;
};

export async function readConnectedWindowsBluetoothDevices(): Promise<WindowsConnectedBluetoothDevice[]> {
  const value = await runWindowsControl("bluetooth-inventory", [], 30_000);
  const entries = Array.isArray(value) ? value : value == null ? [] : [value];
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("蓝牙连接清单格式无效");
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !["classic", "le"].includes(String(item.kind))) {
      throw new Error("蓝牙连接清单缺少稳定设备身份");
    }
    return {id: item.id, name: item.name, kind: item.kind as "classic" | "le", address: typeof item.address === "string" ? item.address : null};
  });
}

export async function readWindowsBluetoothRadioState(): Promise<boolean> {
  const value = await runWindowsControl("bluetooth-radio-state") as {on?: unknown};
  if (typeof value?.on !== "boolean") throw new Error("无法读取蓝牙开关状态");
  return value.on;
}

export function setWindowsBluetoothRadio(enabled: boolean): Promise<unknown> {
  return runWindowsControl("bluetooth-radio-set", ["-RadioState", enabled ? "On" : "Off"], 30_000);
}

export function reconnectWindowsBluetoothDevice(device: WindowsConnectedBluetoothDevice): Promise<unknown> {
  return runWindowsControl("bluetooth-reconnect", [
    "-DeviceKind", device.kind,
    "-DeviceId", device.id,
    ...(device.address ? ["-Address", device.address] : []),
  ], 30_000);
}

export function reconnectWindowsBluetoothAudio(endpointId: string): Promise<unknown> {
  return runWindowsControl("bluetooth-audio-reconnect", ["-EndpointId", endpointId], 20_000);
}

export type WindowsProcess = { pid: number; name: string; command: string; startedAt: string };

export function readWindowsProcess(pid: number): WindowsProcess | null {
  if (!Number.isInteger(pid) || pid <= 4) return null;
  try { return JSON.parse(execFileSync(powershellExecutable(), [...baseArgs, "-Action", "process", "-TargetPid", String(pid)], options)); }
  catch { return null; }
}

export function terminateWindowsProcess(process: WindowsProcess): void {
  try {
    execFileSync(powershellExecutable(), [...baseArgs, "-Action", "terminate", "-TargetPid", String(process.pid), "-ExpectedStart", process.startedAt], options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("Process identity changed")) throw new Error("进程身份已经变化，已停止处理以避免结束错误程序");
    if (detail.includes("Protected process")) throw new Error("系统核心进程不能通过解除占用结束");
    if (detail.includes("All terminate methods failed")) throw new Error("两种结束方式均未能结束目标进程");
    throw new Error("无法结束目标进程；它可能已经退出或受系统保护");
  }
}

/** @deprecated 保留旧导出名供已有调用兼容；行为已改为精确结束目标进程。 */
export const closeWindowsProcess = terminateWindowsProcess;
