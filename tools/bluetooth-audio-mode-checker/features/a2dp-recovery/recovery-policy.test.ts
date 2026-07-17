import test from "node:test";
import assert from "node:assert/strict";
import { selectRecoveryPolicy } from "./recovery-policy.ts";

test("命中原因且有确证方法时只执行对应方法", () => {
  assert.equal(selectRecoveryPolicy(true, true), "执行原因对应方法");
});

test("命中原因但无确证方法时直接进入最后兜底", () => {
  assert.equal(selectRecoveryPolicy(true, false), "直接进入最后兜底");
});

test("未命中原因时按方法清单逐项尝试", () => {
  assert.equal(selectRecoveryPolicy(false, false), "按方法清单逐项尝试");
});
