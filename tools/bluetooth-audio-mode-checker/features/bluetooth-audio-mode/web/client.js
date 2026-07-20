export function getBluetoothRouteConflict(routes) {
  const input = routes.input.find((route) => route.isDefault);
  const output = routes.output.find((route) => route.isDefault);
  if (
    input?.transport === "bluetooth" &&
    output?.transport === "bluetooth" &&
    input.name !== output.name
  ) {
    return { input, output, key: `${input.name}\n${output.name}` };
  }
  return null;
}

export function describeBluetoothRouteRisk(routes) {
  const conflict = getBluetoothRouteConflict(routes);
  return conflict
    ? `当前输入“${conflict.input.name}”和输出“${conflict.output.name}”来自两台不同的蓝牙设备。部分语音应用会拒绝这种组合；开始语音前建议先确认是否必须保留这组路由。`
    : null;
}

export function observeBluetoothRouteInstability(previous, result, now = Date.now()) {
  const conflict = getBluetoothRouteConflict(result.routes);
  const withinPreviousConflict = previous && now - previous.lastConflictAt <= 8_000;
  if (!conflict && !withinPreviousConflict) {
    return { state: null, triggered: false, unstable: false, targetOutputName: null };
  }

  const key = conflict?.key ?? previous.key;
  const targetOutputName = conflict?.output.name ?? previous.targetOutputName;
  if (!previous || previous.key !== key) {
    const mode = result.devices.find((device) => device.name === targetOutputName)?.mode ?? "断开";
    return {
      state: {
        key,
        targetOutputName,
        lastSignal: conflict ? `已连接:${mode}` : "断开",
        changes: [],
        unstable: false,
        lastConflictAt: conflict ? now : 0,
      },
      triggered: false,
      unstable: false,
      targetOutputName,
    };
  }

  const mode = result.devices.find((device) => device.name === targetOutputName)?.mode ?? "断开";
  const signal = conflict ? `已连接:${mode}` : "断开";
  const changes = previous.lastSignal !== signal
    ? [...previous.changes, now].filter((timestamp) => now - timestamp <= 8_000)
    : previous.changes.filter((timestamp) => now - timestamp <= 8_000);
  const unstable = previous.unstable || changes.length >= 2;
  return {
    state: {
      key,
      targetOutputName,
      lastSignal: signal,
      changes,
      unstable,
      lastConflictAt: conflict ? now : previous.lastConflictAt,
    },
    triggered: unstable && !previous.unstable,
    unstable,
    targetOutputName,
  };
}

export function startBluetoothAudioModePage(createA2dpRecoveryController) {
const listElement = document.querySelector("#device-list");
const refreshButton = document.querySelector("#refresh-button");
const countElement = document.querySelector("#device-count");
const timeElement = document.querySelector("#refresh-time");
const statusDot = document.querySelector("#status-dot");
const emptyTemplate = document.querySelector("#empty-template");
const outputSelect = document.querySelector("#output-device");
const inputSelect = document.querySelector("#input-device");
const routeMessage = document.querySelector("#route-message");

const expandedDevices = new Set();
const occupancyFeedback = new Map();
let lastRenderedDevices = [];
let lastRenderedRoutes = null;
let lastRenderedStateFingerprint = "";
let recoveryController;
let refreshRequestRunning = false;
let pendingRouteChange = null;
let pendingRouteTimer = 0;
let routeInstabilityState = null;
let pendingRealtimeState = null;
let realtimeRenderTimer = 0;
let multiEndpointInspectionTimer = 0;

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatRate(rate) {
  if (!rate) return "无";
  const value = rate / 1000;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} kHz`;
}

function routeText(device) {
  const routes = [];
  if (device.isDefaultOutput) routes.push("默认输出");
  if (device.isDefaultInput) routes.push("默认输入");
  if (device.isInputActive) routes.push("麦克风使用中");
  if (device.isDefaultSystemOutput && routes.length === 0) routes.push("系统提示音输出");
  return routes.length ? routes.join(" · ") : "已连接，非默认设备";
}

function metric(label, value) {
  const item = createElement("div", "metric");
  item.append(createElement("span", "", label), createElement("strong", "", value));
  return item;
}

function metricGroup(label, firstMetric, secondMetric, note = "") {
  const group = createElement("fieldset", "metric-group");
  group.append(createElement("legend", "", label));
  const items = createElement("div", "metric-group__items");
  items.append(firstMetric, secondMetric);
  group.append(items);
  if (note) group.append(createElement("p", "metric-group__note", note));
  return group;
}

async function releaseOccupancy(deviceName, pids, label) {
  if (!pids.length || !window.confirm(`确定要结束“${label}”并解除麦克风占用吗？未保存的内容可能丢失。`)) return;
  occupancyFeedback.set(deviceName, { kind: "pending", text: "正在请求程序停止使用麦克风，并等待系统确认…" });
  renderDevices(lastRenderedDevices);
  try {
    const response = await fetch("/api/microphone-occupancy/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pids }),
    });
    const result = await response.json();
    if (!response.ok && result.error) throw new Error(result.error);
    if (result.remainingPids?.length) {
      occupancyFeedback.set(deviceName, {
        kind: "error",
        text: `解除未成功：仍有 ${result.remainingPids.length} 个程序正在读取麦克风。程序可能拒绝了正常退出请求。`,
      });
    } else if (result.releasedPids?.length) {
      const inputMethodHint = /WeType|微信输入法/i.test(label)
        ? " 微信输入法会自动重新启动，但本机实测发现语音快捷键可能不会同时恢复；如无法再次唤起语音，请切换一次输入法，或在微信输入法的语音设置中关闭再开启免提模式。"
        : "";
      occupancyFeedback.set(deviceName, {
        kind: "success",
        text: `系统已确认：相关程序不再读取此麦克风。程序自己的语音图标可能需要片刻才会复位。${inputMethodHint}`,
      });
    } else {
      occupancyFeedback.set(deviceName, {
        kind: "neutral",
        text: "操作前占用已经消失，无需解除。",
      });
    }
    await refreshDevices({ preserveRouteMessage: true });
  } catch (error) {
    occupancyFeedback.set(deviceName, { kind: "error", text: `解除失败：${error.message}` });
    renderDevices(lastRenderedDevices);
  }
}

function microphoneOccupancySection(device) {
  const occupancy = device.microphoneOccupancy;
  const section = createElement("section", "occupancy-section");
  const heading = createElement("div", "occupancy-heading");
  heading.append(
    createElement("h3", "", "麦克风占用"),
    createElement("span", occupancy?.isInUse ? "occupancy-status is-busy" : "occupancy-status is-free", occupancy?.isInUse ? "正在占用" : "未被本机占用"),
  );
  section.append(heading);

  if (occupancy?.users.length) {
    const list = createElement("div", "occupancy-users");
    for (const user of occupancy.users) {
      const row = createElement("div", "occupancy-user");
      const copy = createElement("div", "");
      copy.append(
        createElement("strong", "", user.name),
        createElement("span", "", user.bundleId || `进程 ${user.pid}`),
      );
      const close = createElement("button", "occupancy-close", "×");
      close.type = "button";
      close.title = `结束 ${user.name} 并解除占用`;
      close.setAttribute("aria-label", close.title);
      close.addEventListener("click", () => releaseOccupancy(device.name, [user.pid], user.name));
      row.append(copy, close);
      list.append(row);
    }
    section.append(list);
    const releaseAll = createElement("button", "occupancy-release-all", "解除全部占用");
    releaseAll.type = "button";
    releaseAll.addEventListener("click", () => releaseOccupancy(device.name, occupancy.users.map((user) => user.pid), "全部占用程序"));
    section.append(releaseAll);
  } else {
    section.append(createElement("p", "occupancy-empty", "没有检测到正在读取此设备麦克风的本机程序。仅设为默认输入不算占用。"));
  }

  const capability = createElement("div", "multipoint-note");
  capability.append(createElement(
    "p",
    "",
    "确保您的设备未处于双设备连接状态，本工具无法解除非本机的麦克风占用。",
  ));
  section.append(capability);
  const feedback = occupancyFeedback.get(device.name);
  if (feedback) section.append(createElement("p", `occupancy-feedback is-${feedback.kind}`, feedback.text));
  return section;
}

function createDeviceCard(device) {
  const card = createElement("article", "device-card");
  const header = createElement("div", "device-card__header");
  const summary = createElement("button", "device-card__summary");
  summary.type = "button";
  summary.setAttribute("aria-expanded", "false");

  const icon = createElement("span", "device-icon");
  icon.setAttribute("aria-hidden", "true");
  const title = createElement("div", "device-title");
  title.append(createElement("h2", "", device.name), createElement("p", "", routeText(device)));
  const badgeText = device.mode === "HFP_HSP"
    ? device.isInputActive ? "HFP/HSP模式（麦克风使用中）" : device.label
    : device.label;
  const badge = createElement("span", `mode-badge mode-badge--${device.mode.toLowerCase()}`, badgeText);
  const modeActions = createElement("div", "device-card__mode-actions");
  modeActions.append(badge);
  if (recoveryController.runningDevices.has(device.name)) {
    const runningButton = createElement("button", "recovery-trigger is-running", "正在修复，请稍候…");
    runningButton.type = "button";
    runningButton.disabled = true;
    modeActions.append(runningButton);
  } else if (device.mode === "HFP_HSP") {
    const recoveryButton = createElement("button", "recovery-trigger", "一键修复 HFP");
    recoveryButton.type = "button";
    recoveryButton.setAttribute("aria-label", `一键修复 ${device.name} 的 HFP 模式`);
    recoveryButton.addEventListener("click", () => recoveryController.recover(device));
    modeActions.append(recoveryButton);
  }
  const chevron = createElement("span", "chevron");
  chevron.setAttribute("aria-hidden", "true");
  summary.append(icon, title, chevron);
  header.append(summary, modeActions);

  const details = createElement("div", "device-card__details");
  const recovery = recoveryController.feedbackByDevice.get(device.name);
  if (recovery) details.append(recoveryController.resultSection(recovery, device.name));
  if (!device.isDefaultOutput && !device.isInputActive) {
    const inactiveState = createElement("div", "inactive-state");
    inactiveState.append(
      createElement("strong", "", "当前未刷新输入输出参数"),
      createElement(
        "p",
        "",
        "此设备当前未承担声音输出，因此不显示采样率和声道。将它切换为默认输出后，页面会自动显示实际参数。",
      ),
    );
    details.append(inactiveState, microphoneOccupancySection(device));
    card.append(header, details);
  } else {
  const metrics = createElement("div", "metric-groups");
  metrics.append(
    metricGroup(
      device.isDefaultOutput ? "系统输出端点（当前输出）" : "系统输出端点（当前未播放）",
      metric("采样率", formatRate(device.sampleRateOutput)),
      metric("声道", device.outputChannels ? `${device.outputChannels} 声道` : "无"),
      "这是系统暴露的输出端点，不代表设备具有物理扬声器。",
    ),
    metricGroup(
      device.isInputActive ? "输入（正在使用）" : "输入",
      metric("采样率", formatRate(device.sampleRateInput)),
      metric("声道", device.inputChannels ? `${device.inputChannels} 声道` : "无"),
    ),
  );
  details.append(metrics, microphoneOccupancySection(device));
  card.append(header, details);
  }

  if (expandedDevices.has(device.name)) {
    card.classList.add("is-expanded");
    summary.setAttribute("aria-expanded", "true");
  }

  summary.addEventListener("click", () => {
    const expanded = card.classList.toggle("is-expanded");
    summary.setAttribute("aria-expanded", String(expanded));
    if (expanded) expandedDevices.add(device.name);
    else expandedDevices.delete(device.name);
  });
  return card;
}

function renderRouteSelect(select, options) {
  const previousValue = select.value;
  select.replaceChildren();
  for (const route of options) {
    const option = document.createElement("option");
    option.value = route.name;
    option.textContent = route.name;
    option.selected = route.isDefault;
    select.append(option);
  }
  if (!options.some((route) => route.isDefault) && options.some((route) => route.name === previousValue)) {
    select.value = previousValue;
  }
  select.disabled = options.length === 0;
}

function renderRoutes(routes) {
  renderRouteSelect(outputSelect, routes.output);
  renderRouteSelect(inputSelect, routes.input);
}

function showRouteGuidance(routes) {
  const risk = describeBluetoothRouteRisk(routes);
  routeMessage.className = risk ? "route-message is-warning" : "route-message";
  routeMessage.textContent = risk || "选择其他设备后会立即写入系统。";
}

function updatePendingRouteMessage(routes) {
  if (!pendingRouteChange) return false;
  const activeRoute = routes[pendingRouteChange.direction].find((route) => route.isDefault);
  if (activeRoute?.name !== pendingRouteChange.name) return false;
  if (pendingRouteTimer) window.clearTimeout(pendingRouteTimer);
  pendingRouteTimer = 0;
  routeMessage.className = "route-message is-success";
  const risk = describeBluetoothRouteRisk(routes);
  routeMessage.textContent = risk
    ? `已切换到“${pendingRouteChange.name}”，系统状态已确认。${risk}`
    : `已切换到“${pendingRouteChange.name}”，系统状态已确认。`;
  pendingRouteChange = null;
  return true;
}

async function changeDefaultDevice(select) {
  const direction = select.dataset.direction;
  const name = select.value;
  pendingRouteChange = null;
  if (pendingRouteTimer) window.clearTimeout(pendingRouteTimer);
  pendingRouteTimer = 0;
  outputSelect.disabled = true;
  inputSelect.disabled = true;
  routeMessage.className = "route-message";
  routeMessage.textContent = `正在切换到“${name}”…`;
  try {
    const response = await fetch("/api/default-device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction, name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "切换失败");
    pendingRouteChange = { direction, name };
    routeMessage.className = "route-message";
    routeMessage.textContent = `切换请求已提交，等待系统确认“${name}”…`;
    outputSelect.disabled = false;
    inputSelect.disabled = false;
    if (pendingRouteTimer) window.clearTimeout(pendingRouteTimer);
    pendingRouteTimer = window.setTimeout(() => {
      if (!pendingRouteChange || pendingRouteChange.direction !== direction || pendingRouteChange.name !== name) return;
      routeMessage.className = "route-message";
      routeMessage.textContent = `切换请求已提交，但暂未收到“${name}”成为系统默认设备的确认。`;
    }, 8_000);
    if (lastRenderedRoutes) updatePendingRouteMessage(lastRenderedRoutes);
  } catch (error) {
    routeMessage.className = "route-message is-error";
    routeMessage.textContent = `切换失败：${error.message}`;
    outputSelect.disabled = false;
    inputSelect.disabled = false;
  }
}

function renderState(result, options = {}) {
  lastRenderedRoutes = result.routes;
  const fingerprint = JSON.stringify({ devices: result.devices, routes: result.routes });
  if (fingerprint !== lastRenderedStateFingerprint) {
    renderRoutes(result.routes);
    renderDevices(result.devices);
    lastRenderedStateFingerprint = fingerprint;
  }
  countElement.textContent = result.devices.length
    ? `发现 ${result.devices.length} 台蓝牙音频设备`
    : "未发现蓝牙音频设备";
  const refreshedAt = new Date(result.refreshedAt);
  timeElement.textContent = `更新于 ${refreshedAt.toLocaleTimeString("zh-CN", { hour12: false })}`;
  statusDot.className = "status-dot is-ready";
  const routeWasConfirmed = updatePendingRouteMessage(result.routes);
  if (!options.preserveRouteMessage && !pendingRouteChange && !routeWasConfirmed) {
    showRouteGuidance(result.routes);
  }
}

function clearRealtimeStabilityTimers() {
  if (realtimeRenderTimer) window.clearTimeout(realtimeRenderTimer);
  if (multiEndpointInspectionTimer) window.clearTimeout(multiEndpointInspectionTimer);
  realtimeRenderTimer = 0;
  multiEndpointInspectionTimer = 0;
}

function scheduleSettledRealtimeRender(delay) {
  if (realtimeRenderTimer) window.clearTimeout(realtimeRenderTimer);
  realtimeRenderTimer = window.setTimeout(() => {
    realtimeRenderTimer = 0;
    if (!pendingRealtimeState) return;
    const settled = pendingRealtimeState;
    pendingRealtimeState = null;
    routeInstabilityState = null;
    renderState(settled, { preserveRouteMessage: true });
    if (!pendingRouteChange) showRouteGuidance(settled.routes);
  }, delay);
}

function renderRealtimeState(result) {
  if (pendingRouteChange) {
    clearRealtimeStabilityTimers();
    pendingRealtimeState = null;
    routeInstabilityState = null;
    renderState(result, { preserveRouteMessage: true });
    return;
  }

  const observation = observeBluetoothRouteInstability(routeInstabilityState, result);
  routeInstabilityState = observation.state;
  const routeConflict = getBluetoothRouteConflict(result.routes) ?? getBluetoothRouteConflict(lastRenderedRoutes ?? { input: [], output: [] });
  if (!routeConflict && !observation.unstable) {
    clearRealtimeStabilityTimers();
    pendingRealtimeState = null;
    renderState(result, { preserveRouteMessage: true });
    return;
  }

  pendingRealtimeState = result;
  if (observation.unstable) {
    routeMessage.className = "route-message is-warning is-unstable";
    routeMessage.textContent = "检测到当前双蓝牙组合正在反复断连或切换模式。页面已保留最近稳定状态，正在确认是否有具体应用拒绝该组合。";
    scheduleSettledRealtimeRender(5_000);
    if (observation.triggered && !multiEndpointInspectionTimer) {
      const device = result.devices.find((item) => item.name === observation.targetOutputName) ??
        lastRenderedDevices.find((item) => item.name === observation.targetOutputName);
      if (device) {
        multiEndpointInspectionTimer = window.setTimeout(() => {
          multiEndpointInspectionTimer = 0;
          recoveryController.inspectRouteConflict(device);
        }, 500);
      }
    }
    return;
  }

  scheduleSettledRealtimeRender(1_200);
}

function renderDevices(devices) {
  lastRenderedDevices = devices;
  const occupiedDevice = devices.find((device) => device.microphoneOccupancy?.isInUse);
  if (occupiedDevice) {
    expandedDevices.clear();
    expandedDevices.add(occupiedDevice.name);
  }
  listElement.replaceChildren();
  if (devices.length === 0) {
    listElement.append(emptyTemplate.content.cloneNode(true));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const device of devices) fragment.append(createDeviceCard(device));
  listElement.append(fragment);
}

async function refreshDevices(options = {}) {
  if (refreshRequestRunning) return;
  refreshRequestRunning = true;
  refreshButton.disabled = true;
  refreshButton.classList.add("is-loading");
  countElement.textContent = "正在刷新设备…";
  statusDot.className = "status-dot";
  try {
    const response = await fetch(`/api/devices?time=${Date.now()}`, { cache: "no-store" });
    const result = await response.json();
    if (response.status === 202 && result.loading) {
      countElement.textContent = "正在读取本机音频设备…";
      timeElement.textContent = "首次扫描完成后会自动更新";
      return;
    }
    if (!response.ok) throw new Error(result.error || "设备读取失败");
    renderState(result, options);
  } catch (error) {
    listElement.replaceChildren(createElement("div", "error-state", `读取失败：${error.message}`));
    countElement.textContent = "设备读取失败";
    timeElement.textContent = "请稍后重试";
    statusDot.className = "status-dot is-error";
  } finally {
    refreshRequestRunning = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-loading");
  }
}

recoveryController = createA2dpRecoveryController({
  createElement,
  expandedDevices,
  getLastRenderedDevices: () => lastRenderedDevices,
  refreshDevices,
  renderDevices,
});

refreshButton.addEventListener("click", refreshDevices);
outputSelect.addEventListener("change", () => changeDefaultDevice(outputSelect));
inputSelect.addEventListener("change", () => changeDefaultDevice(inputSelect));
refreshDevices();

const realtimeEvents = new EventSource("/api/events");
realtimeEvents.addEventListener("message", (event) => {
  try {
    renderRealtimeState(JSON.parse(event.data));
  } catch {
    // A later system event will replace a malformed update.
  }
});
realtimeEvents.addEventListener("recovery", (event) => {
  try {
    const { deviceName, progress } = JSON.parse(event.data);
    recoveryController.handleProgress(deviceName, progress);
  } catch {
    // The request response remains the final source of truth.
  }
});
}
