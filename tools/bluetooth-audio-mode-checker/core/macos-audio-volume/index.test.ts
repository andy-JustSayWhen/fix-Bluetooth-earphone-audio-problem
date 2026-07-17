import test from "node:test";
import assert from "node:assert/strict";
import { readOutputVolume } from "./index.ts";

test("可以读取当前系统输出音量和静音状态", () => {
  const snapshot = readOutputVolume();
  assert.ok(snapshot.volume >= 0 && snapshot.volume <= 100);
  assert.equal(typeof snapshot.muted, "boolean");
});
