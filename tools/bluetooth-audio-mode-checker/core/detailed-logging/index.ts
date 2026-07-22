import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DetailedLogLevel = "debug" | "info" | "warn" | "error";

export type DetailedLogStatus = {
  enabled: boolean;
  path: string;
  sizeBytes: number;
  maxFileBytes: number;
  retainedFiles: number;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const toolRoot = join(moduleDirectory, "..", "..");
const logDirectory = process.env.BLUETOOTH_AUDIO_LOG_DIRECTORY || join(toolRoot, "logs");
const logPath = process.env.BLUETOOTH_AUDIO_LOG_PATH || join(logDirectory, "app.jsonl");
const enabled = process.env.BLUETOOTH_AUDIO_LOG_ENABLED !== "0";
export const maxFileBytes = 10 * 1024 * 1024;
export const retainedFiles = 5;
const sensitiveKey = /password|passwd|secret|token|authorization|cookie/i;
const maxTextLength = 4_000;
let writingFailure = false;

function truncateText(value: string): string {
  return value.length <= maxTextLength
    ? value
    : `${value.slice(0, maxTextLength)}…[已截断 ${value.length - maxTextLength} 个字符]`;
}

export function sanitizeLogDetails(value: unknown, key = "", depth = 0): unknown {
  if (sensitiveKey.test(key)) return "[已隐藏]";
  if (depth > 6) return "[层级过深，已省略]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateText(value.message),
      stack: value.stack ? truncateText(value.stack) : undefined,
    };
  }
  if (typeof value === "string") return truncateText(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeLogDetails(item, key, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        sanitizeLogDetails(childValue, childKey, depth + 1),
      ]),
    );
  }
  return value;
}

function rotateIfNeeded(incomingBytes: number): void {
  let size = 0;
  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }
  if (size + incomingBytes <= maxFileBytes) return;
  for (let index = retainedFiles - 1; index >= 1; index -= 1) {
    const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
    const destination = `${logPath}.${index}`;
    if (existsSync(source)) renameSync(source, destination);
  }
}

export function detailedLog(
  level: DetailedLogLevel,
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!enabled) return;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      level,
      pid: process.pid,
      event,
      details: sanitizeLogDetails(details),
    };
    const line = `${JSON.stringify(record)}\n`;
    rotateIfNeeded(Buffer.byteLength(line));
    appendFileSync(logPath, line, { encoding: "utf8", mode: 0o600 });
    writingFailure = false;
  } catch (error) {
    if (!writingFailure) {
      writingFailure = true;
      console.error(`详细日志写入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function getDetailedLogStatus(): DetailedLogStatus {
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(logPath).size;
  } catch {
    // The file is created by the first log record.
  }
  return { enabled, path: logPath, sizeBytes, maxFileBytes, retainedFiles };
}
