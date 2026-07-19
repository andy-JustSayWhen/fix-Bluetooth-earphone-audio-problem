import { runRecovery } from "./run-recovery.ts";
import type { RecoveryProgress, RecoveryRequest } from "./types.ts";

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

runRecovery(request, undefined, writeProgress).then(
  (result) => process.stdout.write(`${JSON.stringify({ type: "result", result })}\n`),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
