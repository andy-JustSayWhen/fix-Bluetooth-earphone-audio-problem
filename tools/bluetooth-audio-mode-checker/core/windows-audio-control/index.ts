import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./control.ps1", import.meta.url));
const baseArgs = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script];
const options = { encoding: "utf8" as const, windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 };

export function runWindowsControl(action: string, args: string[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", [...baseArgs, "-Action", action, ...args], options, (error, stdout, stderr) => {
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

export type WindowsProcess = { pid: number; name: string; command: string; startedAt: string };

export function readWindowsProcess(pid: number): WindowsProcess | null {
  if (!Number.isInteger(pid) || pid <= 4) return null;
  try { return JSON.parse(execFileSync("powershell.exe", [...baseArgs, "-Action", "process", "-TargetPid", String(pid)], options)); }
  catch { return null; }
}

export function closeWindowsProcess(process: WindowsProcess): void {
  execFileSync("powershell.exe", [...baseArgs, "-Action", "close", "-TargetPid", String(process.pid), "-ExpectedStart", process.startedAt], options);
}
