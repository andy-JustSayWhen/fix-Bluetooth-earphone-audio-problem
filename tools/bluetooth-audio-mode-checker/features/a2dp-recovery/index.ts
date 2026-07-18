import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detailedLog } from "../../core/detailed-logging/index.ts";

export type RecoveryStep = {
  stage: string;
  status: "成功" | "失败" | "跳过";
  detail: string;
  sampleRate?: number | null;
};

export type RecoveryDiagnosis = {
  confidence: "已确认" | "高度疑似" | "无法确认";
  summary: string;
  evidence: string[];
};

export type A2dpRecoveryResult = {
  ok: boolean;
  recoveryPath: "原因对应处理" | "仅原因定位";
  handledCause: boolean;
  sampleRate: number | null;
  releasedPrograms: string[];
  remainingPrograms: string[];
  diagnosis: RecoveryDiagnosis;
  steps: RecoveryStep[];
  usedReconnect: boolean;
  message: string;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(moduleDirectory, "runner.ts");

export function recoverA2dp(name: string): Promise<A2dpRecoveryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath, name], {
      cwd: join(moduleDirectory, "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    detailedLog("info", "a2dp-recovery.worker-started", { deviceName: name, pid: child.pid });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      detailedLog("error", "a2dp-recovery.worker-failed", { deviceName: name, error });
      reject(error);
    });
    child.once("close", (code) => {
      detailedLog(code === 0 ? "info" : "error", "a2dp-recovery.worker-stopped", {
        deviceName: name,
        pid: child.pid,
        code,
        stderr,
      });
      if (code !== 0) {
        reject(new Error(stderr.trim() || "恢复进程执行失败"));
        return;
      }
      try {
        const result = JSON.parse(stdout) as A2dpRecoveryResult;
        detailedLog(result.ok ? "info" : "warn", "a2dp-recovery.worker-result", { deviceName: name, result });
        resolve(result);
      } catch {
        reject(new Error("恢复结果无法读取"));
      }
    });
  });
}
