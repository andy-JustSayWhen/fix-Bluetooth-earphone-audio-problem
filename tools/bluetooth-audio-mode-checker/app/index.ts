import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { execFile } from "node:child_process";

import {
  applyActiveOutputSnapshot,
  readAudioModeState,
  startAudioModeRealtimeMonitor,
  webAssetsDirectory,
} from "../features/bluetooth-audio-mode/index.ts";
import {
  attachMicrophoneOccupancy,
  attachMicrophoneOccupancyAsync,
  releaseMicrophoneUsers,
} from "../features/microphone-occupancy/index.ts";
import { recoverA2dp } from "../features/a2dp-recovery/index.ts";
import { setDefaultAudioDevice } from "../core/macos-audio-route/index.ts";

import type {
  ActiveOutputSnapshot,
  AudioModeState,
} from "../shared/audio-device-types/index.ts";

type Options = {
  port: number;
  openBrowser: boolean;
};

const allowedAssets = new Set(["index.html", "styles.css", "client.js"]);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function parseArguments(argumentsList: string[]): Options {
  const options: Options = { port: 4173, openBrowser: true };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--port") {
      const value = Number(argumentsList[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new Error("--port 后面必须是 1 到 65535 之间的端口号。");
      }
      options.port = value;
      index += 1;
    } else if (argument === "--no-open") {
      options.openBrowser = false;
    } else if (argument === "--help" || argument === "-h") {
      console.log(`蓝牙音频模式检查器

用法：./run.command [--port 端口号] [--no-open]

默认启动本地网页并自动打开浏览器。`);
      process.exit(0);
    } else {
      throw new Error(`无法识别的参数：${argument}`);
    }
  }
  return options;
}

async function serveAsset(assetName: string, response: import("node:http").ServerResponse) {
  if (!allowedAssets.has(assetName)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("页面不存在");
    return;
  }
  try {
    const data = await readFile(join(webAssetsDirectory, assetName));
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(assetName)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(data);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("页面资源读取失败");
  }
}

function openBrowser(url: string): void {
  execFile("/usr/bin/open", [url], (error) => {
    if (error) {
      console.error(`浏览器未能自动打开，请手动访问：${url}`);
    }
  });
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("请求内容过大");
  }
  return JSON.parse(body);
}

function main(): void {
  let options: Options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  let cachedState: AudioModeState | null = null;
  let latestSnapshot: ActiveOutputSnapshot | null = null;
  const eventClients = new Set<import("node:http").ServerResponse>();
  let stateRefreshRunning = false;

  const statePayload = () => cachedState === null ? null : {
    ...cachedState,
    refreshedAt: latestSnapshot?.timestamp ?? new Date().toISOString(),
  };
  const broadcastState = () => {
    const payload = statePayload();
    if (payload === null) return;
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of eventClients) client.write(message);
  };
  const refreshState = (): boolean => {
    const previousFingerprint = cachedState === null
      ? null
      : JSON.stringify({ devices: cachedState.devices, routes: cachedState.routes });
    const previousOccupancy = new Map(
      (cachedState?.devices ?? []).map((device) => [device.name, device.microphoneOccupancy]),
    );
    let nextState = readAudioModeState();
    nextState = previousOccupancy.size === 0
      ? { ...nextState, devices: attachMicrophoneOccupancy(nextState.devices) }
      : {
          ...nextState,
          devices: nextState.devices.map((device) => ({
            ...device,
            microphoneOccupancy: previousOccupancy.get(device.name),
          })),
        };
    if (latestSnapshot !== null) nextState = applyActiveOutputSnapshot(nextState, latestSnapshot);
    cachedState = nextState;
    const nextFingerprint = JSON.stringify({ devices: nextState.devices, routes: nextState.routes });
    return nextFingerprint !== previousFingerprint;
  };
  const scheduleStateRefresh = () => {
    if (stateRefreshRunning) return;
    stateRefreshRunning = true;
    setImmediate(() => {
      try {
        if (refreshState()) broadcastState();
      } catch {
        // Keep the last valid state when a background system scan fails.
      } finally {
        stateRefreshRunning = false;
      }
    });
  };
  const scheduleModeTransitionChecks = () => {
    scheduleStateRefresh();
    for (const delay of [700, 1_500, 2_800, 4_500]) {
      setTimeout(scheduleStateRefresh, delay);
    }
  };
  const stopRealtimeMonitor = startAudioModeRealtimeMonitor((snapshot) => {
    latestSnapshot = snapshot;
    if (cachedState !== null) {
      cachedState = applyActiveOutputSnapshot(cachedState, snapshot);
      broadcastState();
    }
  });
  let occupancyFingerprint = "";
  let occupancyTimer: NodeJS.Timeout | null = null;
  let occupancyScanRunning = false;
  const scheduleOccupancyScan = () => {
    occupancyTimer = setTimeout(async () => {
      if (cachedState === null || occupancyScanRunning) {
        scheduleOccupancyScan();
        return;
      }
      occupancyScanRunning = true;
    try {
      const devices = await attachMicrophoneOccupancyAsync(cachedState.devices);
      const nextFingerprint = JSON.stringify(devices.map((device) => ({
        name: device.name,
        users: device.microphoneOccupancy?.users ?? [],
      })));
      if (nextFingerprint === occupancyFingerprint) return;
      occupancyFingerprint = nextFingerprint;
      cachedState = { ...cachedState, devices };
      broadcastState();
      scheduleModeTransitionChecks();
    } catch {
      // A transient system read failure must not interrupt device monitoring.
    } finally {
      occupancyScanRunning = false;
      scheduleOccupancyScan();
    }
    }, 750);
  };
  scheduleOccupancyScan();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      });
      response.write(": connected\n\n");
      eventClients.add(response);
      const payload = statePayload();
      if (payload !== null) response.write(`data: ${JSON.stringify(payload)}\n\n`);
      request.once("close", () => eventClients.delete(response));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/devices") {
      try {
        if (cachedState === null) refreshState();
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(statePayload()));
        scheduleStateRefresh();
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          error: error instanceof Error ? error.message : "音频设备读取失败",
        }));
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/microphone-occupancy/release") {
      try {
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          throw new Error("请求格式不正确");
        }
        const expectedOrigin = `http://127.0.0.1:${options.port}`;
        if (request.headers.origin && request.headers.origin !== expectedOrigin) {
          throw new Error("请求来源不正确");
        }
        const body = await readJsonBody(request) as { pids?: unknown };
        if (!Array.isArray(body.pids) || !body.pids.every(Number.isInteger)) {
          throw new Error("占用程序列表无效");
        }
        const result = await releaseMicrophoneUsers(body.pids as number[]);
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ ok: result.remainingPids.length === 0, ...result }));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          error: error instanceof Error ? error.message : "解除麦克风占用失败",
        }));
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a2dp-recovery") {
      try {
        if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("请求格式不正确");
        const expectedOrigin = `http://127.0.0.1:${options.port}`;
        if (request.headers.origin && request.headers.origin !== expectedOrigin) throw new Error("请求来源不正确");
        const body = await readJsonBody(request) as { name?: unknown };
        if (typeof body.name !== "string" || body.name.length === 0) throw new Error("设备名称无效");
        const result = await recoverA2dp(body.name);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "恢复失败" }));
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/default-device") {
      try {
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          throw new Error("请求格式不正确");
        }
        const expectedOrigin = `http://127.0.0.1:${options.port}`;
        if (request.headers.origin && request.headers.origin !== expectedOrigin) {
          throw new Error("请求来源不正确");
        }
        const body = await readJsonBody(request) as { direction?: unknown; name?: unknown };
        if ((body.direction !== "input" && body.direction !== "output") || typeof body.name !== "string") {
          throw new Error("声音设备选择无效");
        }
        const currentState = cachedState ?? readAudioModeState();
        const available = currentState.routes[body.direction].some((option) => option.name === body.name);
        if (!available) throw new Error("所选声音设备当前不可用");
        setDefaultAudioDevice(body.direction, body.name);
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          error: error instanceof Error ? error.message : "声音设备切换失败",
        }));
      }
      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("不支持这个请求");
      return;
    }

    const assetName = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    await serveAsset(assetName, response);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    stopRealtimeMonitor();
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${options.port} 已被占用，请运行 ./run.command --port 4174 重试。`);
    } else {
      console.error(`应用启动失败：${error.message}`);
    }
    process.exit(1);
  });

  const shutdown = () => {
    stopRealtimeMonitor();
    if (occupancyTimer !== null) clearTimeout(occupancyTimer);
    for (const client of eventClients) client.end();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  server.listen(options.port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${options.port}`;
    console.log(`蓝牙音频模式检查器已启动：${url}`);
    console.log("保持这个窗口运行；按 Control-C 关闭应用。");
    if (options.openBrowser) {
      openBrowser(url);
    }
  });
}

main();
