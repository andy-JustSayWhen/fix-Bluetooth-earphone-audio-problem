import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detailedLog } from "../../core/detailed-logging/index.ts";
import { readMicrophoneUsersAsync } from "../../core/macos-microphone-usage/index.ts";
import { readRunningProcess } from "../../core/macos-running-apps/index.ts";
import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";
import type { MicrophoneUser } from "../../shared/audio-device-types/index.ts";
import type { RunningProcess } from "../../core/macos-running-apps/index.ts";
import {
  findUnclosedFormatRequests,
  readRecentSystemAudioEvidence,
  type FormatRequestEvidence,
} from "./format-request-diagnosis.ts";

export { startFormatRequestOccupancyMonitor } from "./format-request-diagnosis.ts";
import type {
  A2dpRecoveryResult,
  RecoveryProgress,
  RecoveryRequest,
  RelaunchGuardRequest,
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

export async function retainCurrentMicrophoneGuards(
  guards: RelaunchGuardRequest[],
  readConfirmedUsers: () => Promise<MicrophoneUser[]> = () => readMicrophoneUsersAsync(2_000),
  readProcess: (pid: number) => RunningProcess | null = readRunningProcess,
  readEvidence: () => FormatRequestEvidence = () => readRecentSystemAudioEvidence(10),
): Promise<RelaunchGuardRequest[]> {
  const microphoneGuards = guards.filter((guard) => guard.cause === "麦克风占用类");
  if (microphoneGuards.length === 0) return guards;
  let currentUsers: MicrophoneUser[] = [];
  try {
    currentUsers = await readConfirmedUsers();
  } catch (error) {
    detailedLog("warn", "a2dp-recovery.authorization-recheck-failed", { error });
  }
  const needsFormatEvidence = microphoneGuards.some((guard) =>
    guard.occupancyEvidence === "unclosed-format-request"
  );
  let unclosedCommands = new Set<string>();
  if (needsFormatEvidence) {
    try {
      const evidence = readEvidence();
      if (evidence.queryError) throw new Error(evidence.queryError);
      unclosedCommands = new Set(findUnclosedFormatRequests(evidence, readProcess)
        .map((item) => item.requester.command));
    } catch (error) {
      detailedLog("warn", "a2dp-recovery.format-authorization-recheck-failed", { error });
    }
  }
  return guards.filter((guard) => {
    if (guard.cause !== "麦克风占用类") return true;
    const physicalOccupancyStillConfirmed = currentUsers.some((user) => {
      const command = readProcess(user.pid)?.command;
      return command === guard.command &&
        user.inputActivityKind === "已确认实体麦克风占用" &&
        (!guard.microphoneDeviceName || user.confirmedDeviceNames?.includes(guard.microphoneDeviceName));
    });
    return physicalOccupancyStillConfirmed || unclosedCommands.has(guard.command);
  });
}

export async function recoverA2dp(
  request: RecoveryRequest,
  onProgress: (progress: RecoveryProgress) => void = () => {},
  readModeAssessments: () => AudioModeAssessment[] = () =>
    request.context?.deviceAssessments ?? (request.context?.targetAssessment ? [request.context.targetAssessment] : []),
  readConfirmedMicrophoneUsers: () => Promise<MicrophoneUser[]> = () => Promise.resolve([]),
): Promise<A2dpRecoveryResult> {
  const approvedRelaunchGuards = await retainCurrentMicrophoneGuards(
    request._approvedRelaunchGuards ?? [],
    readConfirmedMicrophoneUsers,
  );
  const workerRequest = approvedRelaunchGuards.length === (request._approvedRelaunchGuards?.length ?? 0)
    ? request
    : { ...request, _approvedRelaunchGuards: approvedRelaunchGuards };
  return new Promise((resolve, reject) => {
    for (const guard of approvedRelaunchGuards) {
      startThisBootRelaunchGuard(guard.command, guard.processName);
    }
    const child = spawn(process.execPath, [runnerPath, JSON.stringify(workerRequest)], {
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
