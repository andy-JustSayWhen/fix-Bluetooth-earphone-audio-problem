import test from "node:test";
import assert from "node:assert/strict";
import { readOutputDeviceVolume, readOutputVolume, startOutputVolumeMonitor } from "./index.ts";

test("可以读取当前系统输出音量和静音状态", () => {
  const snapshot = readOutputVolume();
  assert.ok(snapshot.volume >= 0 && snapshot.volume <= 100);
  assert.equal(typeof snapshot.muted, "boolean");
});

test("读取不存在的输出设备时返回空结果", () => {
  assert.equal(readOutputDeviceVolume("__missing_audio_device__"), null);
});

test("事件监听器启动时输出完整的只读基线参数", async () => {
  const event = await new Promise<Parameters<Parameters<typeof startOutputVolumeMonitor>[0]>[0]>((resolve, reject) => {
    let stop = () => {};
    const timeout = setTimeout(() => {
      stop();
      reject(new Error("等待音量监听基线超时"));
    }, 3000);
    stop = startOutputVolumeMonitor((snapshot) => {
      clearTimeout(timeout);
      stop();
      resolve(snapshot);
    });
  });
  assert.equal(event.event, "initial");
  assert.equal(typeof event.deviceId, "number");
  assert.ok(Array.isArray(event.channelVolumes));
  assert.equal(event.channelVolumes.length, event.channelCount);
  assert.equal(typeof event.timestamp, "string");
});
