import { runRecovery, systemRuntime } from "./run-recovery.ts";
import type { RecoveryProgress, RecoveryRequest } from "./types.ts";
import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";

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

let latestAssessment = request.context?.targetAssessment ?? null;
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
        assessment?: AudioModeAssessment | null;
      };
      if (message.type === "mode-assessment") latestAssessment = message.assessment ?? null;
    } catch {
      // Ignore a malformed live update and keep the last valid server assessment.
    }
  }
});

runRecovery(request, {
  ...systemRuntime,
  readModeAssessment: (name) => latestAssessment?.name === name ? latestAssessment : null,
}, writeProgress).then(
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
