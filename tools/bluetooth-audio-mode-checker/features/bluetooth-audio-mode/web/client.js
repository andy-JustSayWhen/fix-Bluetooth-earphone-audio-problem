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
  const supportsHighRate = device.availableSampleRateRangesOutput?.some((range) =>
    Number.isFinite(range?.maximum) && range.maximum > 16_000
  );
  return device.isDefaultOutput === true &&
    device.mode === "HFP_HSP" &&
    supportsHighRate &&
    Number.isFinite(device.actualSampleRateOutput) &&
    device.actualSampleRateOutput > 0 &&
    device.actualSampleRateOutput <= 16_000;
}

export function deviceModePresentation(device) {
  if (device.mode === "HFP_HSP") {
    return {
      className: "hfp_hsp",
      text: device.isInputActive
        ? "HFP等模式（低音质语音模式 · 麦克风使用中）"
        : "HFP等模式（低音质语音模式）",
    };
  }
  if (device.mode === "A2DP") {
    return {
      className: "a2dp",
      text: "A2DP等模式（高音质播放模式）",
    };
  }
  return {
    className: "unknown",
    text: device.isInputActive ? "模式无法确认（麦克风使用中）" : "模式无法确认",
  };
}

export function audioLinkTypePresentation(audioLinkType) {
  if (audioLinkType === "tacl") {
    return "tacl（异步传输，用于单向音频播放）";
  }
  if (audioLinkType === "tsco") {
    return "tsco（同步传输，常用于语音通话）";
  }
  return "无法确认";
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

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatRate(rate) {
  if (!rate) return "无法读取";
  const value = rate / 1000;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} kHz`;
}

function formatRateRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return "无法读取";
  return ranges
    .filter((range) => range?.minimum > 0 && range?.maximum > 0)
    .sort((left, right) => left.minimum - right.minimum || left.maximum - right.maximum)
    .map((range) => range.minimum === range.maximum
      ? formatRate(range.minimum)
      : `${formatRate(range.minimum).replace(" kHz", "")}–${formatRate(range.maximum)}`)
    .join("、") || "无法读取";
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

function metricGroup(label, metrics) {
  const group = createElement("fieldset", "metric-group");
  group.append(createElement("legend", "", label));
  const items = createElement("div", "metric-group__items");
  items.append(...metrics);
  group.append(items);
  return group;
}

function audioLinkGroup(device) {
  const linkGroup = createElement("fieldset", "audio-link-group");
  linkGroup.append(createElement("legend", "", `声音链路类型：${audioLinkTypePresentation(device.audioLinkType)}`));
  const directions = createElement("div", "metric-groups");
  if (device.outputChannels > 0) {
    directions.append(metricGroup(
      device.isDefaultOutput ? "输出（当前输出）" : "输出",
      [
        metric("可用采样率", formatRateRanges(device.availableSampleRateRangesOutput)),
        metric("标称采样率", formatRate(device.nominalSampleRateOutput)),
        metric("实际采样率", formatRate(device.actualSampleRateOutput)),
        metric("声道", `${device.outputChannels} 声道`),
      ],
    ));
  }
  if (device.inputChannels > 0) {
    directions.append(metricGroup(
      device.isInputActive ? "输入（正在使用）" : "输入",
      [
        metric("可用采样率", formatRateRanges(device.availableSampleRateRangesInput)),
        metric("标称采样率", formatRate(device.nominalSampleRateInput)),
        metric("实际采样率", formatRate(device.actualSampleRateInput)),
        metric("声道", `${device.inputChannels} 声道`),
      ],
    ));
  }
  if (!directions.childElementCount) {
    directions.append(createElement("p", "audio-link-group__empty", "系统未返回可展示的输入或输出端点。"));
  }
  linkGroup.append(directions);
  return linkGroup;
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
  details.append(audioLinkGroup(device));
  details.append(microphoneOccupancySection(device));
  card.append(header, details);

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

function showConfirmedRouteConflict(result) {
  routeMessage.className = "route-message is-warning";
  routeMessage.textContent = `已确认：${result.diagnosis.summary}。请在目标输出设备卡片中选择保留输入或保留输出。`;
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

function renderRealtimeState(result) {
  if (pendingRouteChange) {
    routeInstabilityState = null;
    renderState(result, { preserveRouteMessage: true });
    return;
  }

  const observation = observeBluetoothRouteInstability(routeInstabilityState, result);
  routeInstabilityState = observation.state;
  const routeConflict = getBluetoothRouteConflict(result.routes) ?? getBluetoothRouteConflict(lastRenderedRoutes ?? { input: [], output: [] });
  if (!routeConflict && !observation.unstable) {
    renderState(result, { preserveRouteMessage: true });
    showRouteGuidance(result.routes);
    return;
  }

  renderState(result, { preserveRouteMessage: true });
  const pendingRouteChoice = recoveryController.getPendingRouteChoice();
  if (pendingRouteChoice) {
    showConfirmedRouteConflict(pendingRouteChoice);
    return;
  }
  if (observation.unstable) {
    routeMessage.className = "route-message is-warning is-unstable";
    routeMessage.textContent = "检测到当前双蓝牙组合正在反复断连或切换模式。页面会继续实时显示每次变化；目标进入 HFP 时可点击一键修复。";
    return;
  }

  showRouteGuidance(result.routes);
}

function renderDevices(devices) {
  lastRenderedDevices = devices;
  const pendingActionDevice = devices.find((device) =>
    recoveryController?.feedbackByDevice.get(device.name)?.result?.actionRequired
  );
  const occupiedDevice = devices.find((device) => device.microphoneOccupancy?.isInUse);
  if (pendingActionDevice) {
    expandedDevices.add(pendingActionDevice.name);
  } else if (occupiedDevice) {
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
