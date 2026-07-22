import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type NativeHelperBuildOptions = {
  sourcePath: string;
  executablePath: string;
  compilerFlags?: string[];
  frameworks: string[];
  stdio?: ExecFileSyncOptions["stdio"];
};

function modificationTime(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

export function ensureNativeHelperBuilt(options: NativeHelperBuildOptions): void {
  if (modificationTime(options.executablePath) >= modificationTime(options.sourcePath)) return;
  mkdirSync(dirname(options.executablePath), { recursive: true });
  execFileSync("/usr/bin/clang", [
    ...(options.compilerFlags ?? []),
    options.sourcePath,
    ...options.frameworks.flatMap((framework) => ["-framework", framework]),
    "-o",
    options.executablePath,
  ], { stdio: options.stdio ?? ["ignore", "ignore", "pipe"] });
}
