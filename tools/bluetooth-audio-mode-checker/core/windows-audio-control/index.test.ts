import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readWindowsProcess, runWindowsControl, terminateWindowsProcess } from "./index.ts";

test("拒绝对非蓝牙物理节点执行重建", {skip: process.platform !== "win32"}, async () => {
  await assert.rejects(runWindowsControl("restart", ["-InstanceId", "USB\\unrelated-device"]), /not a unique Bluetooth/);
});
test("拒绝将名称当作系统端点标识执行切换", {skip: process.platform !== "win32"}, async () => {
  await assert.rejects(runWindowsControl("route", ["-EndpointId", "耳机; unexpected-command"]), /Invalid audio endpoint/);
});
test("不存在的进程不能成为退出操作的目标", {skip: process.platform !== "win32"}, async () => {
  assert.equal(await runWindowsControl("process", ["-TargetPid", "2147483647"]), null);
});

test("精确结束没有主窗口的目标进程且保留同名进程", {skip: process.platform !== "win32", timeout: 10_000}, async t => {
  const executable = `${process.env.SystemRoot}\\System32\\PING.EXE`;
  const child = spawn(executable, ["-t", "127.0.0.1"], {
    windowsHide: true,
    stdio: "ignore",
  });
  const sibling = spawn(executable, ["-t", "127.0.0.1"], {
    windowsHide: true,
    stdio: "ignore",
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  t.after(() => { if (sibling.exitCode === null) sibling.kill(); });
  await Promise.all([once(child, "spawn"), once(sibling, "spawn")]);
  const target = readWindowsProcess(child.pid!);
  assert.ok(target);
  const exited = once(child, "exit");
  terminateWindowsProcess(target);
  await exited;
  assert.equal(readWindowsProcess(target.pid), null);
  assert.ok(readWindowsProcess(sibling.pid!));
});
