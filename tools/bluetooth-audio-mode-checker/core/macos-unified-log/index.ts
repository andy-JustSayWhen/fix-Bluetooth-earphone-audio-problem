import { execFileSync } from "node:child_process";
import type { Readable } from "node:stream";

export function systemBootTimeMs(): number {
  try {
    const output = execFileSync("/usr/sbin/sysctl", ["-n", "kern.boottime"], {
      encoding: "utf8",
      timeout: 1_000,
    });
    const seconds = Number(output.match(/sec\s*=\s*(\d+)/)?.[1]);
    return Number.isFinite(seconds) && seconds > 0
      ? seconds * 1_000
      : Date.now() - 24 * 60 * 60_000;
  } catch {
    return Date.now() - 24 * 60 * 60_000;
  }
}

export function formatUnifiedLogStart(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    "-", pad(date.getMonth() + 1),
    "-", pad(date.getDate()),
    " ", pad(date.getHours()),
    ":", pad(date.getMinutes()),
    ":", pad(date.getSeconds()),
  ].join("");
}

export function parseUnifiedLogTimestamp(line: string, fallback = new Date()): string {
  const localTimestamp = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/)?.[1];
  const parsed = localTimestamp ? new Date(localTimestamp.replace(" ", "T")) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

export function consumeUtf8Lines(stream: Readable | null | undefined, onLine: (line: string) => void): void {
  if (!stream) return;
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
  stream.once("end", () => {
    if (pending) onLine(pending);
    pending = "";
  });
}
