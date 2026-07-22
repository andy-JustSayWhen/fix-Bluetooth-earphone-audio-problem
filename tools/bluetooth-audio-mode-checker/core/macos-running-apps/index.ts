import { execFileSync } from "node:child_process";
import { basename } from "node:path";

export type RunningProcess = {
  pid: number;
  name: string;
  command: string;
  startedAt: string;
};

export type ProcessTerminationRuntime = {
  now: () => number;
  readProcess: (pid: number) => RunningProcess | null;
  terminateProcess: (processInfo: RunningProcess) => void;
  wait: (milliseconds: number) => Promise<void>;
};

export type ProcessTerminationResult = {
  processes: RunningProcess[];
  requestedPids: number[];
  releasedPids: number[];
  remainingPids: number[];
  protectedPids: number[];
};

const protectedSystemProcessNames = new Set([
  "audioaccessoryd",
  "audiomxd",
  "bluetoothd",
  "bluetoothuserd",
  "coreaudiod",
  "kernel_task",
  "launchd",
]);

export function isProtectedSystemProcess(processInfo: Pick<RunningProcess, "name">): boolean {
  return protectedSystemProcessNames.has(processInfo.name.toLocaleLowerCase());
}

export function runningProcessIdentity(processInfo: RunningProcess): string {
  return `${processInfo.pid}\u0000${processInfo.command}\u0000${processInfo.startedAt}`;
}

export function isSameRunningProcess(
  expected: RunningProcess,
  current: RunningProcess | null,
): boolean {
  return current !== null &&
    current.pid === expected.pid &&
    current.command === expected.command &&
    current.startedAt === expected.startedAt;
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

export function terminateRunningProcess(expected: RunningProcess): void {
  if (isProtectedSystemProcess(expected)) {
    throw new Error("系统核心进程只能由声音链路重建步骤按服务身份重启");
  }
  const current = readRunningProcess(expected.pid);
  if (!current) return;
  if (!isSameRunningProcess(expected, current)) {
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

const systemTerminationRuntime: ProcessTerminationRuntime = {
  now: Date.now,
  readProcess: readRunningProcess,
  terminateProcess: terminateRunningProcess,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export async function terminateAndConfirmRunningProcesses(
  processes: RunningProcess[],
  runtime: ProcessTerminationRuntime = systemTerminationRuntime,
): Promise<ProcessTerminationResult> {
  const uniqueProcesses = [...new Map(
    processes.map((processInfo) => [runningProcessIdentity(processInfo), processInfo] as const),
  ).values()];
  const protectedProcesses = uniqueProcesses.filter(isProtectedSystemProcess);
  const releasableProcesses = uniqueProcesses.filter((processInfo) => !isProtectedSystemProcess(processInfo));
  const requestedProcesses = releasableProcesses.filter((expected) =>
    isSameRunningProcess(expected, runtime.readProcess(expected.pid))
  );
  for (const processInfo of requestedProcesses) runtime.terminateProcess(processInfo);

  let remainingProcesses = requestedProcesses.filter((expected) =>
    isSameRunningProcess(expected, runtime.readProcess(expected.pid))
  );
  const deadline = runtime.now() + 2_000;
  while (remainingProcesses.length > 0) {
    const remainingTime = deadline - runtime.now();
    if (remainingTime <= 0) break;
    await runtime.wait(Math.min(100, remainingTime));
    remainingProcesses = requestedProcesses.filter((expected) =>
      isSameRunningProcess(expected, runtime.readProcess(expected.pid))
    );
  }

  const remainingPids = remainingProcesses.map((processInfo) => processInfo.pid);
  const requestedPids = requestedProcesses.map((processInfo) => processInfo.pid);
  return {
    processes: uniqueProcesses,
    requestedPids,
    releasedPids: releasableProcesses
      .map((processInfo) => processInfo.pid)
      .filter((pid) => !remainingPids.includes(pid)),
    remainingPids,
    protectedPids: protectedProcesses.map((processInfo) => processInfo.pid),
  };
}
