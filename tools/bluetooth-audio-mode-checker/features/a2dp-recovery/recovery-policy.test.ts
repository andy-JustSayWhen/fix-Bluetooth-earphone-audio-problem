import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectRecoveryPolicy } from "./recovery-policy.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

test("只有命中已确认原因时才执行原因对应处理", () => {
  assert.equal(selectRecoveryPolicy(true), "执行原因对应处理");
  assert.equal(selectRecoveryPolicy(false), "停止，不执行处理");
});

test("严格原因工作流不得执行通用方法或兜底", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  assert.doesNotMatch(source, /reconnectBluetoothDevice|disconnectBluetooth|setDefaultAudioDevice/);
  assert.doesNotMatch(source, /synchronizeOutput|fallbackDevice|重新评估输出路由|重建声音路由/);
  assert.match(source, /strict-cause-only/);
  assert.match(source, /没有执行其他方法或兜底/);
});

test("格式请求证据不完整时不得结束候选进程", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  assert.match(source, /formatCause\.confidence !== "已确认"/);
  assert.match(source, /没有结束候选进程/);
});

test("高采样率必须持续六次读取才可判定稳定", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  assert.match(source, /consecutive >= 6/);
  assert.doesNotMatch(source, /consecutive >= 2/);
});
