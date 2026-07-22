import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";

export { startFormatRequestOccupancyMonitor } from "./format-request-diagnosis.ts";
import type {
  A2dpRecoveryResult,
  RecoveryProgress,
  RecoveryRequest,
} from "./types.ts";

export type {
  A2dpRecoveryResult,
  RecoveryDiagnosis,
  RecoveryOutcome,
  RecoveryProgress,
  RecoveryRequest,
  RecoveryRequestContext,
  RecoveryStep,
} from "./types.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const recoveryWebAssetsDirectory = join(moduleDirectory, "web");
const runnerPath = join(moduleDirectory, "runner.ts");

export async function recoverA2dp(
  request: RecoveryRequest,
  onProgress: (progress: RecoveryProgress) => void = () => {},
  readModeAssessments: () => AudioModeAssessment[] = () =>
    request.context?.deviceAssessments ?? (request.context?.targetAssessment ? [request.context.targetAssessment] : []),
): Promise<A2dpRecoveryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath, JSON.stringify(request)], {
      cwd: join(moduleDirectory, "..", ".."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    detailedLog("info", "a2dp-recovery.worker-started", { deviceName: request.name, pid: child.pid });
    let bufferedOutput = "";
    let stderr = "";
    let result: A2dpRecoveryResult | null = null;
    let lastModeMessage = "";
    const syncModeAssessments = () => {
      if (child.stdin.destroyed) return;
      const assessments = readModeAssessments();
      const message = JSON.stringify({ type: "mode-assessments", assessments });
      if (message === lastModeMessage) return;
      lastModeMessage = message;
      child.stdin.write(`${message}\n`);
    };
    syncModeAssessments();
    const modeSyncTimer = setInterval(syncModeAssessments, 100);
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
