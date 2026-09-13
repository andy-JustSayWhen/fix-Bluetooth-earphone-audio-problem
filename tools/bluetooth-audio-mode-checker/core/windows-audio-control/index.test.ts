import test from "node:test";
import assert from "node:assert/strict";
import { runWindowsControl } from "./index.ts";

test("拒绝对非蓝牙物理节点执行重建", {skip: process.platform !== "win32"}, async () => {
  await assert.rejects(runWindowsControl("restart", ["-InstanceId", "USB\\unrelated-device"]), /not a unique Bluetooth/);
});
test("拒绝将名称当作系统端点标识执行切换", {skip: process.platform !== "win32"}, async () => {
  await assert.rejects(runWindowsControl("route", ["-EndpointId", "耳机; unexpected-command"]), /Invalid audio endpoint/);
});
test("不存在的进程不能成为退出操作的目标", {skip: process.platform !== "win32"}, async () => {
  assert.equal(await runWindowsControl("process", ["-TargetPid", "2147483647"]), null);
});
