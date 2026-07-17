import assert from "node:assert/strict";
import test from "node:test";

import {
  getDetailedLogStatus,
  maxFileBytes,
  retainedFiles,
  sanitizeLogDetails,
} from "./index.ts";

test("普通启动默认启用详细日志", () => {
  assert.equal(getDetailedLogStatus().enabled, true);
  assert.match(getDetailedLogStatus().path, /logs\/app\.jsonl$/);
});

test("默认轮转配置保留当前文件和四份历史文件", () => {
  assert.equal(maxFileBytes, 10 * 1024 * 1024);
  assert.equal(retainedFiles, 5);
});

test("敏感字段会被隐藏", () => {
  assert.deepEqual(sanitizeLogDetails({
    authorization: "Bearer abc",
    nested: { password: "0000", name: "设备" },
  }), {
    authorization: "[已隐藏]",
    nested: { password: "[已隐藏]", name: "设备" },
  });
});

test("过长文本会被截断", () => {
  const sanitized = sanitizeLogDetails("x".repeat(5_000));
  assert.equal(typeof sanitized, "string");
  assert.match(sanitized as string, /已截断 1000 个字符/);
});
