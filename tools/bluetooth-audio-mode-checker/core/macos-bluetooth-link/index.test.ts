import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { parseBluetoothLinkLine } from "./index.ts";

test("解析设备当前 tsco 链路并按蓝牙地址归属", () => {
  const result = parseBluetoothLinkLine(
    "2026-07-20 19:33:51.430 Df coreaudiod[92595:587b34] [com.apple.bluetooth:BTAudio] BTUnifiedAudioDevice: [50:C0:F0:F3:6A:66-output ] Is route change pending ? No Current profile tsco",
  );

  assert.equal(result?.address, "50C0F0F36A66");
  assert.equal(result?.profile, "tsco");
  assert.equal(result?.timestamp, "2026-07-20T11:33:51.430Z");
});

test("解析设备正在启动的 tacl 链路", () => {
  const result = parseBluetoothLinkLine(
    "2026-07-20 18:13:56.821 Df coreaudiod[92595:56bd73] [com.apple.bluetooth:BTAudio] Starting IO on profile tacl, 0 to AA:BB:CC:DD:EE:FF-tacl mAudioObjectID: 55 Wait IO Start 1",
  );

  assert.equal(result?.address, "AABBCCDDEEFF");
  assert.equal(result?.profile, "tacl");
});

test("没有设备地址或没有明确当前链路类型的日志不能进入模式判定", () => {
  assert.equal(parseBluetoothLinkLine(
    "2026-07-20 19:33:51.430 Df coreaudiod Current profile tsco",
  ), null);
  assert.equal(parseBluetoothLinkLine(
    "2026-07-20 19:34:54.000 Df coreaudiod 50:C0:F0:F3:6A:66 Stop IO",
  ), null);
});

test("声音链路重建使用只连接辅助程序，不先关闭已有连接", () => {
  const source = readFileSync(new URL("./connect-device.m", import.meta.url), "utf8");
  assert.match(source, /if \(\[target isConnected\]\) return 0/);
  assert.match(source, /\[target openConnection\]/);
  assert.doesNotMatch(source, /closeConnection/);
});
