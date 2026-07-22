import assert from "node:assert/strict";
import test from "node:test";

import { postJson } from "./request.js";

test("页面写请求统一发送本机接口需要的格式", async () => {
  const originalFetch = globalThis.fetch;
  let receivedPath = "";
  let receivedOptions;
  globalThis.fetch = async (path, options) => {
    receivedPath = path;
    receivedOptions = options;
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    assert.deepEqual(await postJson("/api/test", { name: "REDMI" }, "失败"), { ok: true });
    assert.equal(receivedPath, "/api/test");
    assert.equal(receivedOptions.method, "POST");
    assert.deepEqual(receivedOptions.headers, { "Content-Type": "application/json" });
    assert.equal(receivedOptions.body, '{"name":"REDMI"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("页面写请求统一采用服务端错误信息", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: "目标设备当前未连接" }),
  });
  try {
    await assert.rejects(
      () => postJson("/api/test", {}, "操作失败"),
      /目标设备当前未连接/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
