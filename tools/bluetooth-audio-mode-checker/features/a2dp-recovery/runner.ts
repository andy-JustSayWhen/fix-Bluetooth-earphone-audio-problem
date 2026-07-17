import { runRecovery } from "./run-recovery.ts";

const name = process.argv[2];
if (!name) {
  console.error("缺少目标设备名称");
  process.exit(2);
}

runRecovery(name).then(
  (result) => process.stdout.write(JSON.stringify(result)),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
