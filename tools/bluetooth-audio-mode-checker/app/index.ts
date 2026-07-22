import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

import {
  applyActiveInputSnapshot,
  applyActiveOutputSnapshot,
  applyBluetoothLinkSnapshot,
  readAudioModeState,
  readAudioModeStateAsync,
  startAudioModeRealtimeMonitor,
  startAudioModeLinkMonitor,
  webAssetsDirectory,
} from "../features/bluetooth-audio-mode/index.ts";
import {
  attachEmptyMicrophoneOccupancy,
  attachMicrophoneOccupancyFromUsers,
  classifyInputActivities,
  mergeMicrophoneUsers,
  mergeMicrophoneOccupancy,
  readAllMicrophoneUsersAsync,
  releaseMicrophoneUsers,
  shouldContinueOccupancyScanning,
  shouldStartOccupancyScanForInputActivity,
} from "../features/microphone-occupancy/index.ts";
import {
  recoverA2dp,
  recoveryWebAssetsDirectory,
  startFormatRequestOccupancyMonitor,
  type RecoveryProgress,
} from "../features/a2dp-recovery/index.ts";
import {
  attachSpeakerOccupancy,
  filterCurrentSpeakerUsers,
  reconnectSpeakerDevice,
  speakerOccupancyWebAssetsDirectory,
  startSpeakerOccupancyMonitor,
} from "../features/speaker-occupancy/index.ts";
import { setDefaultAudioDevice } from "../core/macos-audio-route/index.ts";
import { detailedLog, getDetailedLogStatus } from "../core/detailed-logging/index.ts";

import type {
  ActiveInputSnapshot,
  ActiveOutputSnapshot,
  AudioModeState,
  BluetoothLinkSnapshot,
  SpeakerOutputUser,
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
  "speaker-occupancy-client.js",
  "speaker-occupancy.css",
]);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const manualRefreshMinimumIntervalMs = 2_500;

function isRecoverableHfpOutput(device: AudioModeState["devices"][number]): boolean {
  return device.mode === "HFP_HSP" && device.a2dpSupport !== "UNSUPPORTED";
}

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
        : assetName === "speaker-occupancy-client.js" || assetName === "speaker-occupancy.css"
          ? {
              directory: speakerOccupancyWebAssetsDirectory,
              name: assetName === "speaker-occupancy-client.js" ? "client.js" : "styles.css",
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
  let fullStateUpdatedAtMs = 0;
  let latestSnapshot: ActiveOutputSnapshot | null = null;
  const eventClients = new Set<import("node:http").ServerResponse>();
  let stateRefreshRunning = false;
  let lastManualRefreshStartedAt = 0;
  let realtimeFingerprint = "";
  let inputActivityFingerprint = "";
  let latestInputSnapshot: ActiveInputSnapshot | null = null;
  const latestLinkSnapshots = new Map<string, BluetoothLinkSnapshot>();
  let latestOccupancyCapturedAt: string | null = null;
  let latestRawMicrophoneUsers: NonNullable<AudioModeState["microphoneUsers"]> = [];
  let latestFormatRequestUsers: NonNullable<AudioModeState["microphoneUsers"]> = [];
  let latestMicrophoneUsers: AudioModeState["microphoneUsers"] = [];
  let latestSpeakerUsers: SpeakerOutputUser[] = [];
  let speakerOccupancyFingerprint = "";
  const speakerReconnectBusyDevices = new Set<string>();
  let inputActivityScanPending = false;
  let initialOccupancyScanScheduled = false;
  const statePayload = () => cachedState === null ? null : {
    ...cachedState,
    microphoneUsers: latestMicrophoneUsers,
    refreshedAt: cachedStateUpdatedAt ?? new Date().toISOString(),
    occupancyCapturedAt: latestOccupancyCapturedAt,
  };
  const currentMicrophoneUsers = () => mergeMicrophoneUsers(
    latestRawMicrophoneUsers,
    latestFormatRequestUsers,
  );
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
    for (const linkSnapshot of latestLinkSnapshots.values()) {
      nextState = applyBluetoothLinkSnapshot(nextState, linkSnapshot);
    }
    if (latestOccupancyCapturedAt !== null) {
      const microphoneUsers = currentMicrophoneUsers();
      nextState = {
        ...nextState,
        devices: attachMicrophoneOccupancyFromUsers(nextState.devices, microphoneUsers),
      };
      latestMicrophoneUsers = classifyInputActivities(nextState.devices, microphoneUsers);
    }
    nextState = {
      ...nextState,
      devices: attachSpeakerOccupancy(nextState.devices, latestSpeakerUsers),
    };
    cachedState = nextState;
    cachedStateUpdatedAt = new Date().toISOString();
    fullStateUpdatedAtMs = Date.now();
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
            a2dpSupport: refreshedState.devices.map((device) => ({
              name: device.name,
              support: device.a2dpSupport,
              maximumAvailableOutputRate: Math.max(
                0,
                ...device.availableSampleRateRangesOutput.map((range) => range.maximum),
              ) || null,
              isDefaultInput: device.isDefaultInput,
              audioLinkType: device.audioLinkType,
            })),
          });
          broadcastState();
        }
        if (cachedState?.devices.some(isRecoverableHfpOutput)) {
          scheduleOccupancyScan(0, "low-output-state");
        }
        if (!initialOccupancyScanScheduled && cachedState !== null) {
          initialOccupancyScanScheduled = true;
          if (cachedState.devices.some(isRecoverableHfpOutput)) {
            scheduleOccupancyScan(0, "initial-low-output-state");
          }
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
      outputChannels: snapshot.outputChannels,
      isRunning: snapshot.isRunning,
    });
    if (nextFingerprint === realtimeFingerprint) return;
    realtimeFingerprint = nextFingerprint;
    detailedLog("info", "active-output.changed", { snapshot });
    latestSnapshot = snapshot;
    if (cachedState !== null) {
      cachedState = applyActiveOutputSnapshot(cachedState, snapshot);
      cachedStateUpdatedAt = snapshot.timestamp;
      broadcastState();
      if (cachedState.devices.some(isRecoverableHfpOutput)) {
        scheduleOccupancyScan(0, "low-output-realtime");
      }
      scheduleStateRefresh();
    }
  });
  const stopLinkMonitor = startAudioModeLinkMonitor((snapshot) => {
    const previous = latestLinkSnapshots.get(snapshot.address);
    if (previous && Date.parse(previous.timestamp) > Date.parse(snapshot.timestamp)) return;
    latestLinkSnapshots.set(snapshot.address, snapshot);
    detailedLog("info", "bluetooth-link.changed", { snapshot });
    if (cachedState === null) return;
    const previousFingerprint = JSON.stringify(cachedState.devices);
    cachedState = applyBluetoothLinkSnapshot(cachedState, snapshot);
    const microphoneUsers = currentMicrophoneUsers();
    cachedState = {
      ...cachedState,
      devices: attachMicrophoneOccupancyFromUsers(cachedState.devices, microphoneUsers),
    };
    latestMicrophoneUsers = classifyInputActivities(cachedState.devices, microphoneUsers);
    const nextFingerprint = JSON.stringify(cachedState.devices);
    if (nextFingerprint === previousFingerprint) return;
    cachedStateUpdatedAt = snapshot.timestamp;
    broadcastState();
  });
  const stopSpeakerOccupancyMonitor = startSpeakerOccupancyMonitor((users, event) => {
    latestSpeakerUsers = users;
    const nextFingerprint = JSON.stringify(users.map((user) => [
      user.sessionId, user.pid, user.deviceUid, user.observedAt,
    ]));
    if (nextFingerprint === speakerOccupancyFingerprint) return;
    speakerOccupancyFingerprint = nextFingerprint;
    detailedLog("info", "speaker-occupancy.changed", {
      event,
      users,
    });
    if (cachedState === null) return;
    const previousDevicesFingerprint = JSON.stringify(cachedState.devices);
    cachedState = {
      ...cachedState,
      devices: attachSpeakerOccupancy(cachedState.devices, latestSpeakerUsers),
    };
    if (JSON.stringify(cachedState.devices) === previousDevicesFingerprint) return;
    cachedStateUpdatedAt = event?.observedAt ?? new Date().toISOString();
    broadcastState();
  });
  const stopFormatRequestOccupancyMonitor = startFormatRequestOccupancyMonitor((users, event) => {
    latestFormatRequestUsers = users;
    detailedLog("info", "format-request-occupancy.changed", { event, users });
    if (cachedState === null) return;
    const microphoneUsers = currentMicrophoneUsers();
    cachedState = {
      ...cachedState,
      devices: attachMicrophoneOccupancyFromUsers(cachedState.devices, microphoneUsers),
    };
    latestMicrophoneUsers = classifyInputActivities(cachedState.devices, microphoneUsers);
    latestOccupancyCapturedAt = event?.timestamp ?? new Date().toISOString();
    cachedStateUpdatedAt = latestOccupancyCapturedAt;
    broadcastState();
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
        const physicalMicrophoneUsers = await readAllMicrophoneUsersAsync();
        latestRawMicrophoneUsers = physicalMicrophoneUsers;
        const microphoneUsers = currentMicrophoneUsers();
        const occupancySnapshot = attachMicrophoneOccupancyFromUsers(cachedState.devices, microphoneUsers);
        latestMicrophoneUsers = classifyInputActivities(occupancySnapshot, microphoneUsers);
        latestOccupancyCapturedAt = new Date().toISOString();
        continueScanning = shouldContinueOccupancyScanning(occupancySnapshot, microphoneUsers);
        const nextFingerprint = JSON.stringify({
          devices: occupancySnapshot.map((device) => ({
            name: device.name,
            users: device.microphoneOccupancy?.users ?? [],
          })),
          microphoneUsers: latestMicrophoneUsers,
        });
        if (nextFingerprint === occupancyFingerprint) return;
        occupancyFingerprint = nextFingerprint;
        detailedLog("info", "microphone-occupancy.changed", {
          source,
          durationMs: Number((performance.now() - startedAt).toFixed(3)),
          microphoneUsers: latestMicrophoneUsers,
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
        const body = await readJsonBody(request) as { deviceName?: unknown; pids?: unknown };
        if (typeof body.deviceName !== "string" || body.deviceName.length === 0) {
          throw new Error("麦克风设备无效");
        }
        const deviceName = body.deviceName;
        if (!Array.isArray(body.pids) || !body.pids.every(Number.isInteger)) {
          throw new Error("占用程序列表无效");
        }
        if (cachedState === null) throw new Error("当前没有可用的设备与链路状态");
        latestRawMicrophoneUsers = await readAllMicrophoneUsersAsync();
        const liveUsers = currentMicrophoneUsers();
        const activities = classifyInputActivities(cachedState.devices, liveUsers);
        const confirmedUsers = activities.filter((user) =>
          user.inputActivityKind === "已确认实体麦克风占用" &&
          user.confirmedDeviceNames?.includes(deviceName)
        );
        const confirmedPids = new Set(confirmedUsers.map((user) => user.pid));
        const requestedPids = [...new Set(body.pids as number[])];
        if (requestedPids.length === 0 || requestedPids.some((pid) => !confirmedPids.has(pid))) {
          throw new Error("当前没有仍有效且已确认的占用或格式请求，未结束任何进程");
        }
        detailedLog("info", "microphone-occupancy.release-requested", {
          deviceName,
          pids: requestedPids,
          evidence: confirmedUsers.map((user) => ({
            pid: user.pid,
            processName: user.name,
            physicalDeviceNames: user.physicalDeviceNames,
            confirmedDeviceNames: user.confirmedDeviceNames,
            inputActivityKind: user.inputActivityKind,
            occupancyEvidenceKinds: user.occupancyEvidenceKinds,
            unclosedFormatRequestAt: user.unclosedFormatRequestAt,
          })),
        });
        const result = await releaseMicrophoneUsers(confirmedUsers, requestedPids);
        detailedLog("info", "microphone-occupancy.release-completed", { result });
        scheduleOccupancyScan(0, "manual-release-completed");
        scheduleStateRefresh();
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

    if (request.method === "POST" && url.pathname === "/api/speaker-occupancy/reconnect") {
      let requestedName: string | null = null;
      try {
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          throw new Error("请求格式不正确");
        }
        const expectedOrigin = `http://127.0.0.1:${options.port}`;
        if (request.headers.origin && request.headers.origin !== expectedOrigin) {
          throw new Error("请求来源不正确");
        }
        const body = await readJsonBody(request) as { name?: unknown };
        if (typeof body.name !== "string" || body.name.length === 0 || body.name.length > 256) {
          throw new Error("蓝牙设备名称无效");
        }
        requestedName = body.name;
        if (speakerReconnectBusyDevices.has(body.name)) {
          throw new Error("该设备正在断开重连，请勿重复提交");
        }
        if (cachedState === null) throw new Error("当前没有可用的蓝牙设备状态");
        const currentUsers = filterCurrentSpeakerUsers(latestSpeakerUsers);
        const currentDevice = attachSpeakerOccupancy(cachedState.devices, currentUsers)
          .find((device) => device.name === body.name);
        if (!currentDevice) throw new Error("目标蓝牙设备当前未连接");
        const evidenceUsers = currentDevice.speakerOccupancy?.users ?? [];
        speakerReconnectBusyDevices.add(body.name);
        detailedLog("info", "speaker-occupancy.reconnect-requested", {
          deviceName: body.name,
          users: evidenceUsers,
        });
        const result = await reconnectSpeakerDevice(body.name);
        detailedLog("info", "speaker-occupancy.reconnect-completed", {
          deviceName: body.name,
          users: evidenceUsers,
          ...result,
          disconnected: true,
          reconnected: true,
        });
        scheduleStateRefresh();
        for (const delay of [350, 900, 1_800]) setTimeout(scheduleStateRefresh, delay);
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(JSON.stringify({ ok: true, name: body.name, ...result }));
      } catch (error) {
        detailedLog("error", "speaker-occupancy.reconnect-failed", {
          deviceName: requestedName,
          error,
        });
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          error: error instanceof Error ? error.message : "断开重连失败",
        }));
      } finally {
        if (requestedName !== null) speakerReconnectBusyDevices.delete(requestedName);
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/a2dp-recovery") {
      try {
        if (!request.headers["content-type"]?.startsWith("application/json")) throw new Error("请求格式不正确");
        const expectedOrigin = `http://127.0.0.1:${options.port}`;
        if (request.headers.origin && request.headers.origin !== expectedOrigin) throw new Error("请求来源不正确");
        const body = await readJsonBody(request) as Record<string, unknown>;
        if (typeof body.name !== "string" || body.name.length === 0) throw new Error("设备名称无效");
        if (Object.keys(body).some((key) => key !== "name")) throw new Error("修复请求只能提交目标设备名称");
        const clickedAt = new Date().toISOString();
        detailedLog("info", "a2dp-recovery.requested", {
          deviceName: body.name,
          clickedAt,
        });
        if (cachedState === null || Date.now() - fullStateUpdatedAtMs > 2_000) refreshState();
        const result = await recoverA2dp({
          name: body.name,
          context: { clickedAt },
        }, (progress) => broadcastRecoveryProgress(body.name as string, progress),
        () => cachedState?.devices ?? [],
        () => latestFormatRequestUsers);
        scheduleOccupancyScan(0, "a2dp-recovery-completed");
        scheduleStateRefresh();
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
    stopLinkMonitor();
    stopSpeakerOccupancyMonitor();
    stopFormatRequestOccupancyMonitor();
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
    stopLinkMonitor();
    stopSpeakerOccupancyMonitor();
    stopFormatRequestOccupancyMonitor();
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
