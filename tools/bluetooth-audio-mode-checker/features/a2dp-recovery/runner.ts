import { runRecovery, systemRuntime } from "./run-recovery.ts";
import type { RecoveryMicrophoneReleaseResult, RecoveryProgress, RecoveryRequest } from "./types.ts";
import type { AudioModeAssessment, MicrophoneUser } from "../../shared/audio-device-types/index.ts";

const encodedRequest = process.argv[2];
if (!encodedRequest) {
  console.error("缺少修复请求");
  process.exit(2);
}

let request: RecoveryRequest;
try {
  request = JSON.parse(encodedRequest) as RecoveryRequest;
} catch {
  console.error("修复请求无法读取");
  process.exit(2);
}

const writeProgress = (progress: RecoveryProgress) => {
  process.stdout.write(`${JSON.stringify({ type: "progress", progress })}\n`);
};

let latestAssessments: AudioModeAssessment[] = [];
let latestFormatRequestUsers: MicrophoneUser[] = [];
let initialEvidenceReceived = false;
let resolveInitialEvidence: (() => void) | null = null;
const initialEvidence = new Promise<void>((resolve) => { resolveInitialEvidence = resolve; });
let releaseRequestId = 0;
const pendingReleases = new Map<number, {
  resolve: (result: RecoveryMicrophoneReleaseResult) => void;
  reject: (error: Error) => void;
}>();
let pendingInput = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  pendingInput += chunk;
  const lines = pendingInput.split("\n");
  pendingInput = lines.pop() ?? "";
  for (const line of lines.filter(Boolean)) {
    try {
      const message = JSON.parse(line) as {
        type?: string;
        assessments?: AudioModeAssessment[];
        formatRequestUsers?: MicrophoneUser[];
        requestId?: number;
        result?: RecoveryMicrophoneReleaseResult;
        error?: string;
      };
      if (message.type === "live-evidence") {
        latestAssessments = message.assessments ?? [];
        latestFormatRequestUsers = message.formatRequestUsers ?? [];
        if (!initialEvidenceReceived) {
          initialEvidenceReceived = true;
          resolveInitialEvidence?.();
        }
      } else if (message.type === "microphone-release-result" && Number.isInteger(message.requestId)) {
        const pending = pendingReleases.get(message.requestId as number);
        if (pending) {
          pendingReleases.delete(message.requestId as number);
          if (message.error) pending.reject(new Error(message.error));
          else if (message.result) pending.resolve(message.result);
          else pending.reject(new Error("麦克风解除没有返回结果"));
        }
      }
    } catch {
      // Ignore a malformed live update and keep the last valid server assessment.
    }
  }
});

const initialEvidenceTimeout = setTimeout(() => resolveInitialEvidence?.(), 2_000);
initialEvidence.then(() => {
  clearTimeout(initialEvidenceTimeout);
  return runRecovery(request, {
    ...systemRuntime,
    readModeAssessment: (name) => latestAssessments.find((assessment) => assessment.name === name) ?? null,
    readModeAssessments: () => latestAssessments,
    readFormatRequestUsers: () => latestFormatRequestUsers,
    releaseBluetoothMicrophoneOccupancy: (deviceName) => new Promise((resolve, reject) => {
      releaseRequestId += 1;
      pendingReleases.set(releaseRequestId, { resolve, reject });
      process.stdout.write(`${JSON.stringify({
        type: "release-bluetooth-microphone-occupancy",
        requestId: releaseRequestId,
        deviceName,
      })}\n`);
    }),
  }, writeProgress);
}).then(
  (result) => {
    process.stdin.destroy();
    process.stdout.write(`${JSON.stringify({ type: "result", result })}\n`);
  },
  (error) => {
    process.stdin.destroy();
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
