import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectRecoveryPolicy } from "./recovery-policy.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

test("命中原因且有确证方法时只执行对应方法", () => {
  assert.equal(selectRecoveryPolicy(true, true), "执行原因对应方法");
});

test("命中原因但无确证方法时直接进入最后兜底", () => {
  assert.equal(selectRecoveryPolicy(true, false), "直接进入最后兜底");
});

test("未命中原因时按方法清单逐项尝试", () => {
  assert.equal(selectRecoveryPolicy(false, false), "按方法清单逐项尝试");
});

test("恢复编排不得把采样率写入当作模式切换", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  assert.doesNotMatch(source, /requestOutputSampleRate|请求高采样率/);
  assert.match(source, /重新评估输出路由/);
});

test("目标麦克风仍被占用时不得断开重连并假报恢复", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  const occupiedBranches = [...source.matchAll(/if \(initialUsers\.length > 0\) \{([\s\S]*?)\n  \}/g)];
  const occupiedBranch = occupiedBranches.at(-1)?.[1] ?? "";
  assert.match(occupiedBranch, /return result\(/);
  assert.match(occupiedBranch, /false,/);
  assert.doesNotMatch(occupiedBranch, /reconnectAndFinish/);
  assert.match(occupiedBranch, /占用存在时不执行断开重连/);
});

test("高采样率必须持续六次读取才可判定稳定", () => {
  const source = readFileSync(join(moduleDirectory, "run-recovery.ts"), "utf8");
  assert.match(source, /consecutive >= 6/);
  assert.doesNotMatch(source, /consecutive >= 2/);
});
