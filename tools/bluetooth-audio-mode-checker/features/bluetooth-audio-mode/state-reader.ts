import { readAudioModeState } from "./index.ts";

try {
  process.stdout.write(JSON.stringify(readAudioModeState()));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
