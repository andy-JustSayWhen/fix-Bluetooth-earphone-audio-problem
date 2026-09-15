import { accessSync, constants } from "node:fs";
import { join } from "node:path";

// Some machines' PATH lacks the WindowsPowerShell directory, so resolving by
// name fails with ENOENT; prefer the standard absolute location instead.
let cachedExecutable: string | null = null;

export function powershellExecutable(): string {
  if (cachedExecutable !== null) return cachedExecutable;
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
    const candidate = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    try {
      accessSync(candidate, constants.F_OK);
      cachedExecutable = candidate;
    } catch {
      cachedExecutable = "powershell.exe";
    }
  } else {
    cachedExecutable = "powershell.exe";
  }
  return cachedExecutable;
}
