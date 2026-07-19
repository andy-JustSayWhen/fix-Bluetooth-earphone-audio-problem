import {
  readRunningProcessesByCommand,
  terminateRunningProcess,
} from "../../core/macos-running-apps/index.ts";

const command = process.argv[2];
if (!command) process.exit(2);

function stopRelaunchedProcesses(): void {
  for (const processInfo of readRunningProcessesByCommand(command)) {
    try {
      terminateRunningProcess(processInfo);
    } catch {
      // A later pass retries only exact command matches; no permanent setting is changed.
    }
  }
}

stopRelaunchedProcesses();
setInterval(stopRelaunchedProcesses, 750);
