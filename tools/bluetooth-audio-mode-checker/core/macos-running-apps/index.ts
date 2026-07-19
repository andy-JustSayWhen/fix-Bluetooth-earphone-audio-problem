import { execFileSync } from "node:child_process";
import { basename } from "node:path";

export type RunningProcess = {
  pid: number;
  name: string;
  command: string;
  startedAt: string;
};

export function isApplicationRunning(name: string): boolean {
  try {
    execFileSync("/usr/bin/pgrep", ["-x", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function readRunningProcess(pid: number): RunningProcess | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const output = execFileSync("/bin/ps", [
      "-p", String(pid),
      "-o", "lstart=",
      "-o", "comm=",
    ], { encoding: "utf8" }).trim();
    const match = output.match(/^(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/);
    if (!match) return null;
    const command = match[2].trim();
    return {
      pid,
      name: basename(command),
      command,
      startedAt: match[1].replace(/\s+/g, " "),
    };
  } catch {
    return null;
  }
}

export function readRunningProcessesByCommand(command: string): RunningProcess[] {
  if (!command) return [];
  try {
    const output = execFileSync("/bin/ps", [
      "-axo", "pid=,lstart=,comm=",
    ], { encoding: "utf8" });
    const processes: RunningProcess[] = [];
    for (const line of output.split("\n")) {
      const match = line.trim().match(
        /^(\d+)\s+(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/,
      );
      if (!match || match[3].trim() !== command) continue;
      const pid = Number(match[1]);
      if (pid <= 1 || pid === process.pid) continue;
      processes.push({
        pid,
        name: basename(command),
        command,
        startedAt: match[2].replace(/\s+/g, " "),
      });
    }
    return processes;
  } catch {
    return [];
  }
}

export function terminateRunningProcess(expected: RunningProcess): void {
  const current = readRunningProcess(expected.pid);
  if (!current) return;
  if (current.startedAt !== expected.startedAt || current.command !== expected.command) {
    throw new Error("进程身份已经变化，已停止处理以避免结束错误程序");
  }
  if (expected.pid === process.pid) throw new Error("不能结束当前工具进程");
  try {
    process.kill(expected.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw new Error("无法请求该进程正常退出；它可能是受系统保护的进程");
  }
}
