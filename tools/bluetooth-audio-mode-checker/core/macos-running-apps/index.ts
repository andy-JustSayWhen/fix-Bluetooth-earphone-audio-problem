import { execFileSync } from "node:child_process";

export function isApplicationRunning(name: string): boolean {
  try {
    execFileSync("/usr/bin/pgrep", ["-x", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
