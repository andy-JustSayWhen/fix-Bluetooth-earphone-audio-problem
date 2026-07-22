import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNativeHelperBuilt } from "../native-helper/index.ts";

import type { MicrophoneUser } from "../../shared/audio-device-types/index.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const sourcePath = join(moduleDirectory, "read-input-users.c");
const executablePath = join(toolRoot, ".build", "microphone-usage", "read-input-users");

function ensureHelperBuilt(): void {
  ensureNativeHelperBuilt({
    sourcePath,
    executablePath,
    frameworks: ["CoreAudio", "CoreFoundation"],
    stdio: ["ignore", "inherit", "inherit"],
  });
}

export function readMicrophoneUsersAsync(timeoutMs = 2_000): Promise<MicrophoneUser[]> {
  ensureHelperBuilt();
  return new Promise((resolve, reject) => {
    execFile(executablePath, [], { encoding: "utf8", timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout) as MicrophoneUser[]);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}
