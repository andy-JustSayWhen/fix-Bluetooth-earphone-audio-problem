import test from "node:test";
import assert from "node:assert/strict";
import { readOutputDeviceVolume, readOutputVolume } from "./index.ts";

test("可以读取当前系统输出音量和静音状态", () => {
  const snapshot = readOutputVolume();
  assert.ok(snapshot.volume >= 0 && snapshot.volume <= 100);
  assert.equal(typeof snapshot.muted, "boolean");
});

test("读取不存在的输出设备时返回空结果", () => {
  assert.equal(readOutputDeviceVolume("__missing_audio_device__"), null);
});
