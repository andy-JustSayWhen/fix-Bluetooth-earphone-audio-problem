import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

import {
  applyActiveInputSnapshot,
  applyActiveOutputSnapshot,
  readAudioModeState,
  readAudioModeStateAsync,
  startAudioModeRealtimeMonitor,
  webAssetsDirectory,
} from "../features/bluetooth-audio-mode/index.ts";
import {
  attachEmptyMicrophoneOccupancy,
  attachMicrophoneOccupancyAsync,
  mergeMicrophoneOccupancy,
  releaseMicrophoneUsers,
  shouldContinueOccupancyScanning,
  shouldStartOccupancyScanForInputActivity,
} from "../features/microphone-occupancy/index.ts";
import {
  recoverA2dp,
  recoveryWebAssetsDirectory,
  type RecoveryProgress,
} from "../features/a2dp-recovery/index.ts";
import { setDefaultAudioDevice } from "../core/macos-audio-route/index.ts";
import { detailedLog, getDetailedLogStatus } from "../core/detailed-logging/index.ts";

import type {
  ActiveInputSnapshot,
  ActiveOutputSnapshot,
  AudioModeState,
} from "../shared/audio-device-types/index.ts";

type Options = {
  port: number;
  openBrowser: boolean;
};

const appWebAssetsDirectory = join(dirname(fileURLToPath(import.meta.url)), "web");
const allowedAssets = new Set([
  "index.html",
  "app-client.js",
  "styles.css",
  "bluetooth-audio-mode-client.js",
  "a2dp-recovery-client.js",
  "a2dp-recovery.css",
]);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const manualRefreshMinimumIntervalMs = 2_500;

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
    const source = assetName === "index.html" || assetName === "app-client.js"
      ? { directory: appWebAssetsDirectory, name: assetName === "app-client.js" ? "client.js" : assetName }
      : assetName === "a2dp-recovery-client.js" || assetName === "a2dp-recovery.css"
        ? {
            directory: recoveryWebAssetsDirectory,
            name: assetName === "a2dp-recovery-client.js" ? "client.js" : "styles.css",
          }
        : {
            directory: webAssetsDirectory,
            name: assetName === "bluetooth-audio-mode-client.js" ? "client.js" : assetName,
          };
    const data = await readFile(join(source.directory, source.name));
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
      detailedLog("error", "browser.open-failed", { url, error });
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

  detailedLog("info", "service.starting", {
    port: options.port,
    openBrowser: options.openBrowser,
    platform: process.platform,
    nodeVersion: process.version,
  });

  let cachedState: AudioModeState | null = null;
  let cachedStateUpdatedAt: string | null = null;
  let latestSnapshot: ActiveOutputSnapshot | null = null;
  const eventClients = new Set<import("node:http").ServerResponse>();
  let stateRefreshRunning = false;
  let lastManualRefreshStartedAt = 0;
  let realtimeFingerprint = "";
  let inputActivityFingerprint = "";
  let latestInputSnapshot: ActiveInputSnapshot | null = null;
  let latestOccupancyCapturedAt: string | null = null;
  let inputActivityScanPending = false;
  let initialOccupancyScanScheduled = false;
  const pendingRelaunchAuthorizations = new Set<string>();

  const statePayload = () => cachedState === null ? null : {
    ...cachedState,
    refreshedAt: cachedStateUpdatedAt ?? new Date().toISOString(),
  };
  const broadcastState = () => {
    const payload = statePayload();
    if (payload === null) return;
    const message = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of eventClients) client.write(message);
  };
  const broadcastRecoveryProgress = (deviceName: string, progress: RecoveryProgress) => {
    const message = `event: recovery\ndata: ${JSON.stringify({ deviceName, progress })}\n\n`;
    for (const client of eventClients) client.write(message);
  };
  const applyRefreshedState = (refreshedState: AudioModeState, minimumSnapshotTimestampMs = Date.now()): boolean => {
    const previousFingerprint = cachedState === null
      ? null
      : JSON.stringify({ devices: cachedState.devices, routes: cachedState.routes });
    const previousOccupancy = new Map(
      (cachedState?.devices ?? []).map((device) => [device.name, device.microphoneOccupancy]),
    );
    let nextState = refreshedState;
    nextState = previousOccupancy.size === 0
      ? { ...nextState, devices: attachEmptyMicrophoneOccupancy(nextState.devices) }
      : {
          ...nextState,
          devices: nextState.devices.map((device) => ({
            ...device,
            microphoneOccupancy: previousOccupancy.get(device.name),
          })),
        };
    if (latestSnapshot !== null && Date.parse(latestSnapshot.timestamp) >= minimumSnapshotTimestampMs) {
      nextState = applyActiveOutputSnapshot(nextState, latestSnapshot);
    }
    if (latestInputSnapshot !== null) {
      nextState = applyActiveInputSnapshot(nextState, latestInputSnapshot);
    }
    cachedState = nextState;
    cachedStateUpdatedAt = new Date().toISOString();
    const nextFingerprint = JSON.stringify({ devices: nextState.devices, routes: nextState.routes });
    return nextFingerprint !== previousFingerprint;
  };
  const refreshState = (): boolean => {
    const startedAt = Date.now();
    return applyRefreshedState(readAudioModeState(), startedAt);
  };
  const scheduleStateRefresh = (): boolean => {
    if (stateRefreshRunning) return false;
    stateRefreshRunning = true;
    setImmediate(async () => {
      const startedAt = performance.now();
      const startedAtWallClock = Date.now();
      try {
        const refreshedState = await readAudioModeStateAsync();
        const changed = applyRefreshedState(refreshedState, startedAtWallClock);
        if (changed) {
          detailedLog("info", "device-state.changed", {
            durationMs: Number((performance.now() - startedAt).toFixed(3)),
            deviceCount: refreshedState.devices.length,
            defaultInput: refreshedState.routes.input.find((device) => device.isDefault)?.name ?? null,
            defaultOutput: refreshedState.routes.output.find((device) => device.isDefault)?.name ?? null,
          });
          broadcastState();
        }
        if (cachedState?.devices.some((device) =>
          device.isDefaultOutput && device.sampleRateOutput !== null && device.sampleRateOutput <= 16_000
        )) scheduleOccupancyScan(0, "low-output-state");
        if (!initialOccupancyScanScheduled && cachedState !== null) {
          initialOccupancyScanScheduled = true;
          if (cachedState.devices.some((device) =>
            device.isDefaultOutput && device.sampleRateOutput !== null && device.sampleRateOutput <= 16_000
          )) scheduleOccupancyScan(0, "initial-low-output-state");
        }
        if (inputActivityScanPending) scheduleOccupancyScan(0, "default-input-started");
      } catch (error) {
        detailedLog("error", "device-state.refresh-failed", {
          durationMs: Number((performance.now() - startedAt).toFixed(3)),
          error,
        });
        // Keep the last valid state when a background system scan fails.
      } finally {
        stateRefreshRunning = false;
      }
    });
    return true;
  };
  const scheduleManualStateRefresh = () => {
    if (stateRefreshRunning) {
      detailedLog("debug", "device-state.refresh-skipped", {
        source: "manual",
        reason: "already-running",
      });
      return;
    }
    const now = performance.now();
    const elapsedMs = now - lastManualRefreshStartedAt;
    if (cachedState !== null && elapsedMs < manualRefreshMinimumIntervalMs) {
      detailedLog("debug", "device-state.refresh-skipped", {
        source: "manual",
        reason: "throttled",
        elapsedMs: Number(elapsedMs.toFixed(3)),
        minimumIntervalMs: manualRefreshMinimumIntervalMs,
      });
      return;
    }
    if (scheduleStateRefresh()) lastManualRefreshStartedAt = now;
  };
  const scheduleModeTransitionChecks = () => {
    scheduleStateRefresh();
    for (const delay of [700, 1_500, 2_800, 4_500]) {
      setTimeout(scheduleStateRefresh, delay);
    }
  };
  const stopRealtimeMonitor = startAudioModeRealtimeMonitor((snapshot) => {
    const inputSnapshot = snapshot.defaultInput;
    if (inputSnapshot !== undefined) {
      const nextInputFingerprint = JSON.stringify(inputSnapshot);
      if (nextInputFingerprint !== inputActivityFingerprint) {
        const shouldScan = shouldStartOccupancyScanForInputActivity(latestInputSnapshot, inputSnapshot);
        inputActivityFingerprint = nextInputFingerprint;
        latestInputSnapshot = inputSnapshot;
        detailedLog("info", "default-input-activity.changed", { snapshot: inputSnapshot });
        if (cachedState !== null) {
          cachedState = applyActiveInputSnapshot(cachedState, inputSnapshot);
          cachedStateUpdatedAt = snapshot.timestamp;
          broadcastState();
          scheduleStateRefresh();
        }
        if (shouldScan) {
          inputActivityScanPending = true;
          scheduleOccupancyScan(0, "default-input-started");
        }
      }
    }
    const nextFingerprint = JSON.stringify({
      name: snapshot.name,
      nominalSampleRate: snapshot.nominalSampleRate,
      actualSampleRate: snapshot.actualSampleRate,
      isRunning: snapshot.isRunning,
    });
    if (nextFingerprint === realtimeFingerprint) return;
    realtimeFingerprint = nextFingerprint;
    detailedLog("info", "active-output.changed", { snapshot });
    const activeRate = snapshot.actualSampleRate ?? snapshot.nominalSampleRate;
    if (activeRate !== null && activeRate > 0 && activeRate <= 16_000) {
      scheduleOccupancyScan(0, "low-output-realtime");
    }
    latestSnapshot = snapshot;
    if (cachedState !== null) {
      cachedState = applyActiveOutputSnapshot(cachedState, snapshot);
      cachedStateUpdatedAt = snapshot.timestamp;
      broadcastState();
      scheduleStateRefresh();
    }
  });
  let occupancyFingerprint = "";
  let occupancyTimer: NodeJS.Timeout | null = null;
  let occupancyScanRunning = false;
  const scheduleOccupancyScan = (delay = 750, source = "occupancy-still-present") => {
    if (occupancyTimer !== null || occupancyScanRunning) {
      detailedLog("debug", "microphone-occupancy.scan-trigger-skipped", {
        source,
        reason: occupancyScanRunning ? "scan-running" : "scan-scheduled",
      });
      return;
    }
    detailedLog("info", "microphone-occupancy.scan-triggered", { source, delayMs: delay });
    occupancyTimer = setTimeout(async () => {
      occupancyTimer = null;
      if (cachedState === null || occupancyScanRunning) {
        detailedLog("debug", "microphone-occupancy.scan-deferred", {
          source,
          reason: cachedState === null ? "device-state-not-ready" : "scan-running",
        });
        return;
      }
      inputActivityScanPending = false;
      occupancyScanRunning = true;
      let continueScanning = false;
      const startedAt = performance.now();
      try {
        const occupancySnapshot = await attachMicrophoneOccupancyAsync(cachedState.devices);
        latestOccupancyCapturedAt = new Date().toISOString();
        continueScanning = shouldContinueOccupancyScanning(occupancySnapshot);
        const nextFingerprint = JSON.stringify(occupancySnapshot.map((device) => ({
          name: device.name,
          users: device.microphoneOccupancy?.users ?? [],
        })));
        if (nextFingerprint === occupancyFingerprint) return;
        occupancyFingerprint = nextFingerprint;
        detailedLog("info", "microphone-occupancy.changed", {
          source,
          durationMs: Number((performance.now() - startedAt).toFixed(3)),
          devices: occupancySnapshot.map((device) => ({
            name: device.name,
            users: device.microphoneOccupancy?.users ?? [],
          })),
        });
        const devices = mergeMicrophoneOccupancy(cachedState.devices, occupancySnapshot);
        cachedState = { ...cachedState, devices };
        cachedStateUpdatedAt = new Date().toISOString();
        broadcastState();
        if (!continueScanning) scheduleModeTransitionChecks();
      } catch (error) {
        detailedLog("error", "microphone-occupancy.scan-failed", {
          source,
          durationMs: Number((performance.now() - startedAt).toFixed(3)),
          error,
        });
        // A transient system read failure must not interrupt device monitoring.
      } finally {
        occupancyScanRunning = false;
        detailedLog("debug", continueScanning
          ? "microphone-occupancy.scan-continuing"
          : "microphone-occupancy.scan-stopped", {
          source,
          reason: continueScanning ? "仍检测到占用程序" : "没有占用程序，停止探测以允许系统释放通话链路",
        });
        if (continueScanning) scheduleOccupancyScan(750, "occupancy-still-present");
        else if (inputActivityScanPending) scheduleOccupancyScan(0, "default-input-started");
      }
    }, delay);
  };
  scheduleStateRefresh();

  let requestSequence = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestId = `${process.pid}-${++requestSequence}`;
    const requestStartedAt = performance.now();
    detailedLog("debug", "http.request.started", { requestId, method: request.method, path: url.pathname });
    response.once("finish", () => detailedLog("info", "http.request.completed", {
      requestId,
      method: request.method,
      path: url.pathname,
      statusCode: response.statusCode,
      durationMs: Number((performance.now() - requestStartedAt).toFixed(3)),
    }));
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
        if (cachedState === null) {
          scheduleManualStateRefresh();
          response.writeHead(202, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          response.end(JSON.stringify({ loading: true }));
          return;
        }
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(statePayload()));
        scheduleManualStateRefresh();
      } catch (error) {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          error: error instanceof Error ? error.message : "音频设备读取失败",
        }));
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/logs/status") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(getDetailedLogStatus()));
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
        detailedLog("info", "microphone-occupancy.release-requested", { pids: body.pids });
        const result = await releaseMicrophoneUsers(body.pids as number[]);
        detailedLog("info", "microphone-occupancy.release-completed", { result });
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ ok: result.remainingPids.length === 0, ...result }));
      } catch (error) {
        detailedLog("error", "microphone-occupancy.release-failed", { error });
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
        const body = await readJsonBody(request) as {
          name?: unknown;
          inspectMultiEndpoint?: unknown;
          routeChoiceId?: unknown;
          authorizeRelaunchBlock?: unknown;
        };
        if (typeof body.name !== "string" || body.name.length === 0) throw new Error("设备名称无效");
        if (body.inspectMultiEndpoint !== undefined && typeof body.inspectMultiEndpoint !== "boolean") {
          throw new Error("多端点复核请求无效");
        }
        if (body.routeChoiceId !== undefined && (typeof body.routeChoiceId !== "string" || body.routeChoiceId.length > 512)) {
          throw new Error("输入输出组合无效");
        }
        if (body.authorizeRelaunchBlock !== undefined && typeof body.authorizeRelaunchBlock !== "boolean") {
          throw new Error("授权信息无效");
        }
        if (body.authorizeRelaunchBlock === true && !pendingRelaunchAuthorizations.has(body.name)) {
          throw new Error("当前没有等待确认的自动拉起阻止授权");
        }
        if (body.authorizeRelaunchBlock === true) pendingRelaunchAuthorizations.delete(body.name);
        detailedLog("info", "a2dp-recovery.requested", { deviceName: body.name });
        const clickedAt = new Date().toISOString();
        const currentState = cachedState ?? readAudioModeState();
        const currentDevice = currentState.devices.find((device) => device.name === body.name);
        const result = await recoverA2dp({
          name: body.name,
          inspectMultiEndpoint: body.inspectMultiEndpoint as boolean | undefined,
          routeChoiceId: body.routeChoiceId as string | undefined,
          authorizeRelaunchBlock: body.authorizeRelaunchBlock as boolean | undefined,
          context: {
            clickedAt,
            defaultInput: currentState.routes.input.find((route) => route.isDefault)?.name ?? null,
            defaultOutput: currentState.routes.output.find((route) => route.isDefault)?.name ?? null,
            targetSampleRate: currentDevice?.sampleRateOutput ?? null,
            occupancySnapshot: latestOccupancyCapturedAt && currentDevice?.microphoneOccupancy ? {
              capturedAt: latestOccupancyCapturedAt,
              users: currentDevice.microphoneOccupancy.users,
            } : undefined,
          },
        }, (progress) => broadcastRecoveryProgress(body.name as string, progress));
        if (result.actionRequired?.kind === "relaunch-authorization") {
          pendingRelaunchAuthorizations.add(body.name);
        }
        detailedLog(result.ok ? "info" : "warn", "a2dp-recovery.returned", { deviceName: body.name, result });
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify(result));
      } catch (error) {
        detailedLog("error", "a2dp-recovery.request-failed", { error });
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
        const selectedOption = currentState.routes[body.direction].find((option) => option.name === body.name);
        const available = selectedOption !== undefined;
        if (!available) throw new Error("所选声音设备当前不可用");
        detailedLog("info", "default-device.change-requested", {
          direction: body.direction,
          deviceName: body.name,
          alreadyDefault: selectedOption.isDefault,
        });
        if (!selectedOption.isDefault) {
          setDefaultAudioDevice(body.direction, body.name);
          scheduleModeTransitionChecks();
        }
        detailedLog("info", "default-device.change-completed", { direction: body.direction, deviceName: body.name });
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ ok: true }));
      } catch (error) {
        detailedLog("error", "default-device.change-failed", { error });
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
    detailedLog("error", "service.server-error", { error, port: options.port });
    stopRealtimeMonitor();
    if (error.code === "EADDRINUSE") {
      console.error(`端口 ${options.port} 已被占用，请运行 ./run.command --port 4174 重试。`);
    } else {
      console.error(`应用启动失败：${error.message}`);
    }
    process.exit(1);
  });

  const shutdown = () => {
    detailedLog("info", "service.stopping", { eventClients: eventClients.size });
    stopRealtimeMonitor();
    if (occupancyTimer !== null) clearTimeout(occupancyTimer);
    for (const client of eventClients) client.end();
    server.close(() => {
      detailedLog("info", "service.stopped");
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  server.listen(options.port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${options.port}`;
    console.log(`蓝牙音频模式检查器已启动：${url}`);
    console.log(`详细日志：${getDetailedLogStatus().path}`);
    detailedLog("info", "service.listening", { url, log: getDetailedLogStatus() });
    console.log("保持这个窗口运行；按 Control-C 关闭应用。");
    if (options.openBrowser) {
      openBrowser(url);
    }
  });
}

main();
