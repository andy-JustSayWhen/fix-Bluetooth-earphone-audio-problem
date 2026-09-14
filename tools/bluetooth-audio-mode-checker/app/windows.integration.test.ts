import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
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


test("原生控制器解析区分成功、失败、断开和截断事件", {skip: process.platform !== "win32", timeout: 15_000}, () => {
  const path = fileURLToPath(new URL("../core/windows-audio-probe/probe-audio-endpoints.cs", import.meta.url));
  const script = `Add-Type -Path $env:PROBE_NATIVE_SOURCE
$a = '2C1100000EE7003DBC58E4020C043C003C0003'
[WindowsAudioProbeCore]::InspectControllerEvents(@($a))
[WindowsAudioProbeCore]::InspectControllerEvents(@($a, '050400000E16'))
[WindowsAudioProbeCore]::InspectControllerEvents(@('2C1101000EE7003DBC58E4020C043C003C0003'))
[WindowsAudioProbeCore]::InspectControllerEvents(@('2C1100000E'))
[WindowsAudioProbeCore]::InspectControllerEvents(@($a, '050400010E16'))`;
  const lines = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {windowsHide: true, encoding: "utf8", env: {...process.env, PROBE_NATIVE_SOURCE: path}, timeout: 12_000}).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(lines[0][0].address, "E458BC3D00E7");
  assert.deepEqual(lines.slice(1,4), [[], [], []]);
  assert.equal(lines[4].length, 1);
});

test("原生高音质流状态机区分协商、流开始与停止", {skip: process.platform !== "win32", timeout: 15_000}, () => {
  const path = fileURLToPath(new URL("../core/windows-audio-probe/probe-audio-endpoints.cs", import.meta.url));
  const script = `Add-Type -Path $env:PROBE_NATIVE_SOURCE
[WindowsAudioProbeCore]::ObserveA2dpNegotiation('E458BC3D00E7', [uint32]0, [uint32]2, [uint32]0, [uint32]48000, [uint32]2, '2026-09-14T11:43:47Z')
[WindowsAudioProbeCore]::ObserveA2dpStream('E458BC3D00E7', $true, '2026-09-14T11:43:49Z')
[WindowsAudioProbeCore]::InspectA2dpState()
[WindowsAudioProbeCore]::ObserveA2dpStream('E458BC3D00E7', $false, '2026-09-14T11:44:12Z')
[WindowsAudioProbeCore]::InspectA2dpState()
[WindowsAudioProbeCore]::ObserveA2dpNegotiation('E458BC3D00E7', [uint32]5, [uint32]0, [uint32]0, [uint32]44100, [uint32]2, '2026-09-14T11:45:00Z')
[WindowsAudioProbeCore]::ObserveA2dpNegotiation('', [uint32]0, [uint32]2, [uint32]0, [uint32]48000, [uint32]2, '2026-09-14T11:45:01Z')
[WindowsAudioProbeCore]::InspectA2dpState()`;
  const lines = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {windowsHide: true, encoding: "utf8", env: {...process.env, PROBE_NATIVE_SOURCE: path}, timeout: 12_000}).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(lines[0].length, 1);
  assert.deepEqual(lines[0][0], {address: "E458BC3D00E7", streaming: true, startedAt: "2026-09-14T11:43:49Z", codec: 2, vendorId: 0, sampleRate: 48000, channels: 2, negotiatedAt: "2026-09-14T11:43:47Z"});
  assert.equal(lines[1][0].streaming, false);
  assert.equal(lines[1][0].sampleRate, 48000);
  assert.equal(lines[1][0].negotiatedAt, "2026-09-14T11:43:47Z");
  assert.equal(lines[2].length, 1);
  assert.equal(lines[2][0].negotiatedAt, "2026-09-14T11:43:47Z");
});

test("历史文件回放补读协商参数，超窗事件不充当正在传输", {skip: process.platform !== "win32", timeout: 20_000}, () => {
  const path = fileURLToPath(new URL("../core/windows-audio-probe/probe-audio-endpoints.cs", import.meta.url));
  const source = fileURLToPath(new URL("../../../artifacts/bose-negotiation-20260914-114148-A2dp.etl", import.meta.url));
  const script = `Add-Type -Path $env:PROBE_NATIVE_SOURCE
[WindowsAudioProbeCore]::ReplayHistoryFile($env:HISTORY_ETL, [int]::MaxValue)
[WindowsAudioProbeCore]::InspectA2dpState()
[WindowsAudioProbeCore]::ReplayHistoryFile($env:HISTORY_ETL, 0)
[WindowsAudioProbeCore]::InspectA2dpState()`;
  const lines = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {windowsHide: true, encoding: "utf8", env: {...process.env, PROBE_NATIVE_SOURCE: path, HISTORY_ETL: source}, timeout: 16_000}).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(lines[0].voiceLinks.length, 0);
  assert.equal(lines[0].a2dpStreams[0].address, "E458BC3D00E7");
  assert.equal(lines[0].a2dpStreams[0].streaming, true);
  assert.equal(lines[0].a2dpStreams[0].codec, 2);
  assert.equal(lines[0].a2dpStreams[0].sampleRate, 48000);
  // 窗口外事件不充当当前状态，但协商参数保留展示。（输出共 4 行：两次回放、两次检查）
  assert.equal(lines[3][0].streaming, false);
  assert.equal(lines[3][0].sampleRate, 48000);
  assert.equal(lines[3][0].negotiatedAt, "2026-09-14T03:43:47.3546883Z");
});
