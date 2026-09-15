import test from "node:test";
import assert from "node:assert/strict";
import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import { powershellExecutable } from "./index.ts";

test("Windows 解析出存在的 PowerShell 绝对路径，其他平台返回名称占位", () => {
  const executable = powershellExecutable();
  if (process.platform === "win32") {
    assert.equal(isAbsolute(executable), true, executable);
    accessSync(executable, constants.F_OK);
  } else {
    assert.equal(executable, "powershell.exe");
  }
});
