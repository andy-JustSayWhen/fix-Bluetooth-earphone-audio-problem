import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnoseFormatRequestCause,
  parseSystemAudioLog,
  type FormatRequestEvidence,
} from "./format-request-diagnosis.ts";
import type { RunningProcess } from "../../core/macos-running-apps/index.ts";

const processInfo: RunningProcess = {
  pid: 30114,
  name: "WeType",
  command: "/Applications/WeType.app/Contents/MacOS/WeType",
  startedAt: "Sat Jul 18 09:00:00 2026",
};

const requestLine = "2026-07-18 12:47:04.276197+0800  localhost coreaudiod[90589]: [ 30114 ]BTUnifiedAudioDevice: kBluetoothAudioDevicePropertyFormat request 0 ->1";
const tscoLine = "2026-07-18 12:47:04.309000+0800  localhost coreaudiod[90589]: BTUnifiedAudioDevice: Current profile tsco";

function evidence(lines: string): FormatRequestEvidence {
  return {
    windowMinutes: 10,
    events: parseSystemAudioLog(lines),
    rawLines: lines.split("\n"),
    queryError: null,
  };
}

test("解析格式请求者和内部切换方向", () => {
  const events = parseSystemAudioLog(requestLine);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    kind: "format-request",
    timestamp: "2026-07-18 12:47:04.276197+0800",
    timestampMs: events[0].timestampMs,
    requesterPid: 30114,
    from: 0,
    to: 1,
    raw: requestLine,
  });
});

test("唯一低采样率目标且两秒内进入 tsco 时确认格式请求原因", () => {
  const cause = diagnoseFormatRequestCause(
    evidence(`${requestLine}\n${tscoLine}`),
    "Redmi电脑音箱-3899",
    ["Redmi电脑音箱-3899"],
    () => processInfo,
  );
  assert.equal(cause.confidence, "已确认");
  assert.equal(cause.requester?.name, "WeType");
  assert.equal(cause.matchingTsco?.profile, "tsco");
  assert.equal(cause.gaps.length, 0);
});

test("同一进程存在 StartIO 时只标为高度疑似", () => {
  const startIoLine = "2026-07-18 12:47:04.280000+0800 localhost coreaudiod[90589]: BluetoothHALPlugIn_StartIO PID=30114";
  const cause = diagnoseFormatRequestCause(
    evidence(`${requestLine}\n${startIoLine}\n${tscoLine}`),
    "Redmi电脑音箱-3899",
    ["Redmi电脑音箱-3899"],
    () => processInfo,
  );
  assert.equal(cause.confidence, "高度疑似");
  assert.match(cause.gaps.join("\n"), /StartIO/);
});

test("缺少 tsco 或存在多个低采样率蓝牙输出时不确认原因", () => {
  const missingTsco = diagnoseFormatRequestCause(
    evidence(requestLine),
    "Redmi电脑音箱-3899",
    ["Redmi电脑音箱-3899"],
    () => processInfo,
  );
  assert.equal(missingTsco.confidence, "高度疑似");
  assert.match(missingTsco.gaps.join("\n"), /没有匹配的 tsco/);

  const multipleTargets = diagnoseFormatRequestCause(
    evidence(`${requestLine}\n${tscoLine}`),
    "Redmi电脑音箱-3899",
    ["Redmi电脑音箱-3899", "REDMI Buds"],
    () => processInfo,
  );
  assert.equal(multipleTargets.confidence, "高度疑似");
  assert.match(multipleTargets.gaps.join("\n"), /不是唯一目标/);
});

test("已有反向格式请求时不把旧的 0 -> 1 当作当前原因", () => {
  const reverseLine = "2026-07-18 12:47:05.000000+0800 localhost coreaudiod[90589]: [ 30114 ]BTUnifiedAudioDevice: kBluetoothAudioDevicePropertyFormat request 1 ->0";
  const cause = diagnoseFormatRequestCause(
    evidence(`${requestLine}\n${tscoLine}\n${reverseLine}`),
    "Redmi电脑音箱-3899",
    ["Redmi电脑音箱-3899"],
    () => processInfo,
  );
  assert.equal(cause.confidence, "无法确认");
  assert.equal(cause.request, null);
});
