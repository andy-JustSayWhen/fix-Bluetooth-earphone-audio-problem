import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";
import type {
  A2dpRecoveryResult,
  RecoveryProgress,
  RecoveryRequest,
} from "./types.ts";

export type {
  A2dpRecoveryResult,
  RecoveryActionRequired,
  RecoveryDiagnosis,
  RecoveryOutcome,
  RecoveryProgress,
  RecoveryRequest,
  RecoveryRequestContext,
  RecoveryContinuation,
  RecoveryRoundState,
  RecoveryRouteChoice,
  RecoveryStep,
  RelaunchGuardRequest,
} from "./types.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const recoveryWebAssetsDirectory = join(moduleDirectory, "web");
const runnerPath = join(moduleDirectory, "runner.ts");
const relaunchGuardRunnerPath = join(moduleDirectory, "relaunch-guard-runner.ts");
const guardedCommands = new Set<string>();

function startThisBootRelaunchGuard(command: string, processName: string): void {
  if (guardedCommands.has(command)) return;
  const child = spawn(process.execPath, [relaunchGuardRunnerPath, command], {
    cwd: join(moduleDirectory, "..", ".."),
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  guardedCommands.add(command);
  detailedLog("info", "a2dp-recovery.relaunch-guard-started", {
    processName,
    command,
    pid: child.pid,
    lifetime: "current-boot",
  });
}

export function recoverA2dp(
  request: RecoveryRequest,
  onProgress: (progress: RecoveryProgress) => void = () => {},
  readModeAssessment: (name: string) => AudioModeAssessment | null = () =>
    request.context?.targetAssessment ?? null,
): Promise<A2dpRecoveryResult> {
  return new Promise((resolve, reject) => {
    for (const guard of request._approvedRelaunchGuards ?? []) {
      startThisBootRelaunchGuard(guard.command, guard.processName);
    }
    const child = spawn(process.execPath, [runnerPath, JSON.stringify(request)], {
      cwd: join(moduleDirectory, "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    detailedLog("info", "a2dp-recovery.worker-started", { deviceName: request.name, pid: child.pid });
    let bufferedOutput = "";
    let stderr = "";
    let result: A2dpRecoveryResult | null = null;
    let lastModeMessage = "";
    const syncModeAssessment = () => {
      if (child.stdin.destroyed) return;
      const assessment = readModeAssessment(request.name);
      const message = JSON.stringify({ type: "mode-assessment", assessment });
      if (message === lastModeMessage) return;
      lastModeMessage = message;
      child.stdin.write(`${message}\n`);
    };
    syncModeAssessment();
    const modeSyncTimer = setInterval(syncModeAssessment, 100);
    child.stdin.on("error", () => {
      // The worker may close stdin immediately after returning its final result.
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bufferedOutput += chunk;
      const lines = bufferedOutput.split("\n");
      bufferedOutput = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        try {
          const message = JSON.parse(line) as
            | { type: "progress"; progress: RecoveryProgress }
            | { type: "result"; result: A2dpRecoveryResult };
          if (message.type === "progress") onProgress(message.progress);
          else result = message.result;
        } catch {
          stderr += `无法读取工作进度：${line}\n`;
        }
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      clearInterval(modeSyncTimer);
      detailedLog("error", "a2dp-recovery.worker-failed", { deviceName: request.name, error });
      reject(error);
    });
    child.once("close", (code) => {
      clearInterval(modeSyncTimer);
      detailedLog(code === 0 ? "info" : "error", "a2dp-recovery.worker-stopped", {
        deviceName: request.name,
        pid: child.pid,
        code,
        stderr,
      });
      if (code !== 0 || result === null) {
        reject(new Error(stderr.trim() || "恢复进程没有返回可读取结果"));
        return;
      }
      detailedLog(result.ok ? "info" : "warn", "a2dp-recovery.worker-result", { deviceName: request.name, result });
      resolve(result);
    });
  });
}
