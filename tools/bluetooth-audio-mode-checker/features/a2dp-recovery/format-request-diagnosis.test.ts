import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnoseFormatRequestCause,
  diagnoseMultiEndpointCause,
  formatSystemLogStart,
  parseSystemAudioLog,
  type FormatRequestEvidence,
} from "./format-request-diagnosis.ts";
import type { RunningProcess } from "../../core/macos-running-apps/index.ts";
import type { RawAudioDevice } from "../../shared/audio-device-types/index.ts";

const processInfo: RunningProcess = {
  pid: 30114,
  name: "WeType",
  command: "/Applications/WeType.app/Contents/MacOS/WeType",
  startedAt: "Sat Jul 18 09:00:00 2026",
};

const requestLine = "2026-07-18 12:47:04.276197+0800  localhost coreaudiod[90589]: [ 30114 ]BTUnifiedAudioDevice: kBluetoothAudioDevicePropertyFormat request 0 ->1";
const tscoLine = "2026-07-18 12:47:04.309000+0800  localhost coreaudiod[90589]: BTUnifiedAudioDevice: Current profile tsco";
const multiEndpointLines = `2026-07-18 15:28:17.939653+0800 localhost coreaudiod[90589]: session: WeType(30114)
details:
  deviceUIDs:
    - 50-C0-F0-F3-6A-66:output
    - 58-B8-58-9D-C1-E8:input
2026-07-18 15:28:18.000000+0800 localhost coreaudiod[90589]: There was an error setting the deviceUUIDs as there are more than one BT device connected`;

const multiTarget: RawAudioDevice = {
  id: 1,
  name: "XIBERIA K03S",
  uid: "50-C0-F0-F3-6A-66:output",
  manufacturer: "",
  transport: "bluetooth",
  sampleRateInput: 16_000,
  sampleRateOutput: 16_000,
  inputChannels: 1,
  outputChannels: 2,
  isRunning: true,
  isDefaultInput: false,
  isDefaultOutput: true,
  isDefaultSystemOutput: true,
};

function evidence(lines: string): FormatRequestEvidence {
  return {
    windowMinutes: 10,
    events: parseSystemAudioLog(lines),
    rawLines: lines.split("\n"),
    queryError: null,
  };
}

test("系统日志开始时间使用本地空格格式而不是 ISO 字符串", () => {
  const localTime = new Date(2026, 6, 20, 3, 4, 40).getTime();
  assert.equal(formatSystemLogStart(localTime), "2026-07-20 03:04:40");
});

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

test("同进程号程序启动时间晚于格式请求时不得结束它", () => {
  const cause = diagnoseFormatRequestCause(
    evidence(`${requestLine}\n${tscoLine}`),
    "Redmi电脑音箱-3899",
    ["Redmi电脑音箱-3899"],
    () => ({ ...processInfo, startedAt: "Sat Jul 18 13:00:00 2026" }),
  );
  assert.equal(cause.confidence, "高度疑似");
  assert.match(cause.gaps.join("\n"), /进程号复用/);
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

test("同一会话绑定两台蓝牙设备且系统拒绝时确认多端点原因", () => {
  const cause = diagnoseMultiEndpointCause(
    evidence(multiEndpointLines),
    multiTarget,
    () => processInfo,
  );
  assert.equal(cause.confidence, "已确认");
  assert.equal(cause.bindings.length, 2);
  assert.match(cause.rejection ?? "", /more than one BT device connected/);
});

test("兼容 audiomxd 当前使用的 JSON 会话字段写法", () => {
  const currentMacOsLines = `2026-07-20 14:32:59.000001+0800 localhost audiomxd[510]: {"session":{"ID":"0x6aa002","name":"WeType(30114)"},"details":{"deviceUIDs":["50-C0-F0-F3-6A-66:output","58-B8-58-9D-C1-E8:input"]}}
2026-07-20 14:32:59.000002+0800 localhost audiomxd[510]: There was an error setting the deviceUUIDs as there are more than one BT device connected`;
  const cause = diagnoseMultiEndpointCause(
    evidence(currentMacOsLines),
    multiTarget,
    () => processInfo,
  );
  assert.equal(cause.confidence, "已确认");
  assert.equal(cause.requesterPid, 30114);
  assert.equal(cause.requester?.name, "WeType");
});

test("多端点日志缺少系统拒绝或目标对应时不得确认", () => {
  const withoutRejection = diagnoseMultiEndpointCause(
    evidence(multiEndpointLines.split("\n").slice(0, -1).join("\n")),
    multiTarget,
    () => processInfo,
  );
  assert.equal(withoutRejection.confidence, "高度疑似");

  const wrongTarget = diagnoseMultiEndpointCause(
    evidence(multiEndpointLines),
    { ...multiTarget, uid: "AA-BB-CC-DD-EE-FF:output" },
    () => processInfo,
  );
  assert.equal(wrongTarget.confidence, "高度疑似");
});

test("多端点日志查询失败必须保留为明确证据缺口", () => {
  const result = diagnoseMultiEndpointCause({
    ...evidence(""),
    queryError: "读取超时",
  }, multiTarget, () => null, { allowRecoveredTarget: true });

  assert.equal(result.confidence, "无法确认");
  assert.match(result.gaps.join("\n"), /系统声音日志读取失败：读取超时/);
});
