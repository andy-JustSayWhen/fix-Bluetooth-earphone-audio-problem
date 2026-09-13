import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Windows 服务能够从首次加载进入真实设备状态，并处理刷新和无效写请求", {skip: process.platform !== "win32", timeout: 20_000}, async t => {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as {port: number}).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, [fileURLToPath(new URL("./index.ts", import.meta.url)), "--port", String(port), "--no-open"], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {...process.env, BLUETOOTH_AUDIO_LOG_ENABLED: "0"},
  });
  let stderr = "";
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => {stderr += chunk;});
  child.stdout.resume();
  t.after(() => child.kill());
  const origin = `http://127.0.0.1:${port}`;
  let state: any = null;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, stderr);
    try {
      const response = await fetch(`${origin}/api/devices`);
      const body = await response.json();
      if (response.ok && body.routes) {state = body; break;}
      if (body.error) throw new Error(body.error);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(state?.routes, `没有读到设备状态：${stderr}`);
  assert.ok(Array.isArray(state.devices));
  assert.ok(Array.isArray(state.routes.input));
  assert.ok(Array.isArray(state.routes.output));
  assert.equal((await fetch(origin)).status, 200);
  const bad = await fetch(`${origin}/api/default-device`, {method: "POST", headers: {"content-type": "application/json", origin}, body: JSON.stringify({direction: "invalid", name: "missing"})});
  assert.equal(bad.status, 400);
  const output = state.routes.output.find((route: any) => route.isDefault);
  if (output) {
    const same = await fetch(`${origin}/api/default-device`, {method: "POST", headers: {"content-type": "application/json", origin}, body: JSON.stringify({direction: "output", name: output.name})});
    assert.equal(same.status, 200, JSON.stringify(await same.json()));
  }
  const refreshed = await fetch(`${origin}/api/devices`);
  assert.equal(refreshed.status, 200);
  assert.equal(stderr, "");
});
