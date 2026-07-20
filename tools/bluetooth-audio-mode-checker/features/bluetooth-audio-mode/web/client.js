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
    ? "⚠️注意：当前输入和输出来自两个不同的蓝牙设备，微信输入法等App的语音功能可能无法正常处理这种组合。"
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
  const inputActive = Boolean(conflict && result.devices.find((device) =>
    device.name === conflict.input.name
  )?.isInputActive);
  if (!previous || previous.key !== key) {
    const mode = result.devices.find((device) => device.name === targetOutputName)?.mode ?? "断开";
    return {
      state: {
        key,
        targetOutputName,
        lastSignal: conflict ? `已连接:${mode}` : "断开",
        changes: [],
        unstable: false,
        inputActive,
        lastConflictAt: conflict ? now : 0,
      },
      triggered: inputActive,
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
  const inputStarted = inputActive && !previous.inputActive;
  return {
    state: {
      key,
      targetOutputName,
      lastSignal: signal,
      changes,
      unstable,
      inputActive,
      lastConflictAt: conflict ? now : previous.lastConflictAt,
    },
    triggered: (unstable && !previous.unstable) || inputStarted,
    unstable,
    targetOutputName,
  };
}

export function isRecoverableOutputDevice(device) {
  return device.isDefaultOutput === true &&
    device.maxSupportedOutputRate > 16_000 &&
    device.sampleRateOutput !== null &&
    device.sampleRateOutput <= 16_000;
}

export function deviceModePresentation(device) {
  if (device.isInputActive && !isRecoverableOutputDevice(device)) {
    const inputValue = device.sampleRateInput / 1_000;
    const inputRate = device.sampleRateInput === null
      ? "采样率未知"
      : `${Number.isInteger(inputValue) ? inputValue.toFixed(0) : inputValue.toFixed(1)} kHz 输入`;
    return {
      className: "microphone",
      text: `蓝牙麦克风使用中（${inputRate}）`,
    };
  }
  if (device.mode === "INACTIVE") {
    return {
      className: "inactive",
      text: "未活动（当前未承担声音输出）",
    };
  }
  return {
    className: device.mode.toLowerCase(),
    text: device.mode === "HFP_HSP" && device.isInputActive
      ? "HFP/HSP模式（麦克风使用中）"
      : device.label,
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
const occupancyBusyDevices = new Set();
let lastRenderedDevices = [];
let lastRenderedRoutes = null;
let lastRenderedStateFingerprint = "";
let lastOccupancyCapturedAt = 0;
let recoveryController;
let refreshRequestRunning = false;
let pendingRouteChange = null;
let pendingRouteTimer = 0;
let routeInstabilityState = null;
let multiEndpointInspectionTimer = 0;
let lastMultiEndpointInspectionKey = "";

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

function schedulePostActionRefresh() {
  for (const delay of [350, 900, 1_800]) {
    window.setTimeout(() => refreshDevices({ preserveRouteMessage: true, silent: true }), delay);
  }
}

async function releaseOccupancy(deviceName, users) {
  const pids = users.map((user) => user.pid);
  const label = users.length === 1 ? users[0].name : "全部占用程序";
  if (!pids.length || !window.confirm(`确定要结束“${label}”并解除麦克风占用吗？未保存的内容可能丢失。`)) return;
  occupancyBusyDevices.add(deviceName);
  occupancyFeedback.set(deviceName, { kind: "pending", text: "正在请求程序退出并复查麦克风，通常在 1 秒左右完成…" });
  renderDevices(lastRenderedDevices);
  try {
    const response = await fetch("/api/microphone-occupancy/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pids }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "解除失败");
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
        releasedAt: Date.now(),
        releasedNames: users
          .filter((user) => result.releasedPids.includes(user.pid))
          .map((user) => user.name),
      });
    } else {
      occupancyFeedback.set(deviceName, {
        kind: "neutral",
        text: "操作前占用已经消失，无需解除。",
      });
    }
  } catch (error) {
    occupancyFeedback.set(deviceName, { kind: "error", text: `解除失败：${error.message}` });
  } finally {
    occupancyBusyDevices.delete(deviceName);
    renderDevices(lastRenderedDevices);
    schedulePostActionRefresh();
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
      close.disabled = occupancyBusyDevices.has(device.name);
      close.addEventListener("click", () => releaseOccupancy(device.name, [user]));
      row.append(copy, close);
      list.append(row);
    }
    section.append(list);
    const releaseAll = createElement(
      "button",
      "occupancy-release-all",
      occupancyBusyDevices.has(device.name) ? "正在解除并复查…" : "解除全部占用",
    );
    releaseAll.type = "button";
    releaseAll.disabled = occupancyBusyDevices.has(device.name);
    releaseAll.addEventListener("click", () => releaseOccupancy(device.name, occupancy.users));
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
  let feedback = occupancyFeedback.get(device.name);
  const reoccupied = feedback?.kind === "success" && lastOccupancyCapturedAt > feedback.releasedAt
    ? occupancy?.users.filter((user) => feedback.releasedNames.includes(user.name)) ?? []
    : [];
  if (reoccupied.length > 0) {
    feedback = {
      kind: "warning",
      text: `${reoccupied.map((user) => user.name).join("、")} 曾短暂释放麦克风，但现在已重新占用。`,
    };
    occupancyFeedback.set(device.name, feedback);
  }
  const recoveryReoccupied = occupancy?.users.filter((user) => {
    const releasedAt = recoveryController?.recentlyReleasedPrograms.get(user.name);
    return releasedAt && lastOccupancyCapturedAt > releasedAt && Date.now() - releasedAt <= 30_000;
  }) ?? [];
  if (recoveryReoccupied.length > 0) {
    section.append(createElement(
      "p",
      "occupancy-feedback is-warning",
      `${recoveryReoccupied.map((user) => user.name).join("、")} 在一键修复中曾释放麦克风，但现在已重新占用。`,
    ));
  }
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
  const modePresentation = deviceModePresentation(device);
  const badge = createElement("span", `mode-badge mode-badge--${modePresentation.className}`, modePresentation.text);
  const modeActions = createElement("div", "device-card__mode-actions");
  modeActions.append(badge);
  if (recoveryController.runningDevices.has(device.name)) {
    const runningButton = createElement(
      "button",
      "recovery-trigger is-running",
      recoveryController.progressByDevice.get(device.name) ?? "正在修复…",
    );
    runningButton.type = "button";
    runningButton.disabled = true;
    modeActions.append(runningButton);
  } else if (isRecoverableOutputDevice(device)) {
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
    const inputOnlyIdle = device.isDefaultInput;
    inactiveState.append(
      createElement("strong", "", inputOnlyIdle ? "默认蓝牙麦克风当前未采集" : "当前未刷新输入输出参数"),
      createElement(
        "p",
        "",
        inputOnlyIdle
          ? "当前没有本机应用实际读取此麦克风。系统声明但未播放的同名输出端点不参与修复判断，也不证明设备具有物理扬声器。"
          : "此设备当前未承担声音输出，因此不显示采样率和声道。将它切换为默认输出后，页面会自动显示实际参数。",
      ),
    );
    details.append(inactiveState, microphoneOccupancySection(device));
    card.append(header, details);
  } else {
  const metrics = createElement("div", "metric-groups");
  if (device.isDefaultOutput) {
    metrics.append(metricGroup(
      device.isDefaultOutput ? "系统输出端点（当前输出）" : "系统输出端点（当前未播放）",
      metric("采样率", formatRate(device.sampleRateOutput)),
      metric("声道", device.outputChannels ? `${device.outputChannels} 声道` : "无"),
      "这是系统暴露的输出端点，不代表设备具有物理扬声器。",
    ));
  }
  metrics.append(metricGroup(
      device.isInputActive ? "输入（正在使用）" : "输入",
      metric("采样率", formatRate(device.sampleRateInput)),
      metric("声道", device.inputChannels ? `${device.inputChannels} 声道` : "无"),
  ));
  details.append(metrics);
  if (device.isInputActive && !device.isDefaultOutput) {
    details.append(createElement(
      "p",
      "input-only-note",
      "当前只使用此设备的麦克风。16 kHz 可以是蓝牙输入的正常规格；系统声明但未播放的同名输出端点不参与修复判断，也不代表设备具有物理扬声器。",
    ));
  }
  details.append(microphoneOccupancySection(device));
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
  lastOccupancyCapturedAt = Date.parse(result.occupancyCapturedAt) || lastOccupancyCapturedAt;
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

function clearMultiEndpointInspectionTimer() {
  if (multiEndpointInspectionTimer) window.clearTimeout(multiEndpointInspectionTimer);
  multiEndpointInspectionTimer = 0;
  lastMultiEndpointInspectionKey = "";
}

function scheduleRouteConflictInspection(result, { force = false, lookbackSeconds = 2 } = {}) {
  const routeConflict = getBluetoothRouteConflict(result.routes);
  if (!routeConflict) {
    lastMultiEndpointInspectionKey = "";
    return;
  }
  const inputActive = Boolean(result.devices.find((device) =>
    device.name === routeConflict.input.name
  )?.isInputActive);
  if (!inputActive && !force) {
    if (lastMultiEndpointInspectionKey.endsWith("\n输入采集中")) {
      lastMultiEndpointInspectionKey = "";
    }
    return;
  }
  const inspectionKey = `${routeConflict.key}\n${inputActive ? "输入采集中" : "路由抖动"}`;
  if (inspectionKey === lastMultiEndpointInspectionKey || multiEndpointInspectionTimer) return;
  const device = result.devices.find((item) => item.name === routeConflict.output.name) ??
    lastRenderedDevices.find((item) => item.name === routeConflict.output.name);
  if (!device) return;
  lastMultiEndpointInspectionKey = inspectionKey;
  multiEndpointInspectionTimer = window.setTimeout(() => {
    multiEndpointInspectionTimer = 0;
    recoveryController.inspectRouteConflict(device, {
      inputName: routeConflict.input.name,
      outputName: routeConflict.output.name,
      observedAt: new Date().toISOString(),
      lookbackSeconds,
    });
  }, 500);
}

function renderRealtimeState(result) {
  if (pendingRouteChange) {
    clearMultiEndpointInspectionTimer();
    routeInstabilityState = null;
    renderState(result, { preserveRouteMessage: true });
    return;
  }

  const observation = observeBluetoothRouteInstability(routeInstabilityState, result);
  routeInstabilityState = observation.state;
  const routeConflict = getBluetoothRouteConflict(result.routes) ?? getBluetoothRouteConflict(lastRenderedRoutes ?? { input: [], output: [] });
  if (!routeConflict && !observation.unstable) {
    clearMultiEndpointInspectionTimer();
    renderState(result, { preserveRouteMessage: true });
    showRouteGuidance(result.routes);
    return;
  }

  scheduleRouteConflictInspection(result, {
    force: observation.triggered && observation.unstable,
  });
  renderState(result, { preserveRouteMessage: true });
  if (observation.unstable) {
    routeMessage.className = "route-message is-warning is-unstable";
    routeMessage.textContent = "检测到当前双蓝牙组合正在反复断连或切换模式。页面会继续实时显示每次变化，正在确认是否有具体应用拒绝该组合。";
    return;
  }

  showRouteGuidance(result.routes);
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
  if (!options.silent) {
    refreshButton.disabled = true;
    refreshButton.classList.add("is-loading");
    countElement.textContent = "正在刷新设备…";
    statusDot.className = "status-dot";
  }
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
    scheduleRouteConflictInspection(result, { lookbackSeconds: 300 });
  } catch (error) {
    if (options.silent) return;
    listElement.replaceChildren(createElement("div", "error-state", `读取失败：${error.message}`));
    countElement.textContent = "设备读取失败";
    timeElement.textContent = "请稍后重试";
    statusDot.className = "status-dot is-error";
  } finally {
    refreshRequestRunning = false;
    if (!options.silent) {
      refreshButton.disabled = false;
      refreshButton.classList.remove("is-loading");
    }
  }
}

recoveryController = createA2dpRecoveryController({
  createElement,
  expandedDevices,
  getLastRenderedDevices: () => lastRenderedDevices,
  renderDevices,
  schedulePostActionRefresh,
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
