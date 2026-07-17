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
let lastRenderedStateFingerprint = "";
const recoveryFeedback = new Map();

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
  if (device.isDefaultSystemOutput && routes.length === 0) routes.push("系统提示音输出");
  return routes.length ? routes.join(" · ") : "已连接，非默认设备";
}

function metric(label, value) {
  const item = createElement("div", "metric");
  item.append(createElement("span", "", label), createElement("strong", "", value));
  return item;
}

function metricGroup(label, firstMetric, secondMetric) {
  const group = createElement("fieldset", "metric-group");
  group.append(createElement("legend", "", label));
  const items = createElement("div", "metric-group__items");
  items.append(firstMetric, secondMetric);
  group.append(items);
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
      occupancyFeedback.set(deviceName, {
        kind: "success",
        text: "系统已确认：相关程序不再读取此麦克风。程序自己的语音图标可能需要片刻才会复位。",
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
    const releaseAll = createElement("button", "occupancy-release-all", "一键解除全部本机占用");
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

async function recoverA2dp(device, badge) {
  if (!window.confirm("工具会先诊断原因并从低扰动方案开始；其他方案全部失败后，最后可能断开并重新连接目标设备。是否继续？")) return;
  badge.classList.add("is-recovering");
  badge.textContent = "正在诊断与恢复…";
  try {
    const response = await fetch("/api/a2dp-recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: device.name }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "恢复失败");
    recoveryFeedback.set(device.name, { kind: result.ok ? "success" : "error", result });
    await refreshDevices({ preserveRouteMessage: true });
  } catch (error) {
    recoveryFeedback.set(device.name, { kind: "error", text: `恢复失败：${error.message}` });
    await refreshDevices({ preserveRouteMessage: true });
  }
}

function recoveryResultSection(feedback) {
  const section = createElement("section", `recovery-feedback is-${feedback.kind}`);
  if (!feedback.result) {
    section.append(createElement("p", "recovery-summary", feedback.text));
    return section;
  }
  const result = feedback.result;
  section.append(
    createElement("strong", "recovery-title", result.ok ? "A2DP 恢复成功" : "A2DP 恢复失败"),
    createElement("p", "recovery-path", `恢复路径：${result.recoveryPath}`),
    createElement("p", "recovery-diagnosis", `${result.diagnosis.confidence}：${result.diagnosis.summary}`),
  );
  if (result.diagnosis.evidence?.length) {
    const evidence = createElement("ul", "recovery-evidence");
    for (const item of result.diagnosis.evidence) evidence.append(createElement("li", "", item));
    section.append(evidence);
  }
  const steps = createElement("ol", "recovery-steps");
  for (const item of result.steps ?? []) {
    const row = createElement("li", `is-${item.status}`);
    row.append(
      createElement("strong", "", `${item.stage}：${item.status}`),
      createElement("span", "", item.detail),
    );
    steps.append(row);
  }
  section.append(steps, createElement("p", "recovery-summary", result.message));
  if (result.usedReconnect) section.append(createElement("p", "recovery-reconnect-note", "本次已使用最后兜底：断开并重新连接目标设备。"));
  return section;
}

function createDeviceCard(device) {
  if (device.microphoneOccupancy?.isInUse) recoveryFeedback.delete(device.name);
  const card = createElement("article", "device-card");
  const summary = createElement("button", "device-card__summary");
  summary.type = "button";
  summary.setAttribute("aria-expanded", "false");

  const icon = createElement("span", "device-icon");
  icon.setAttribute("aria-hidden", "true");
  const title = createElement("div", "device-title");
  title.append(createElement("h2", "", device.name), createElement("p", "", routeText(device)));
  const badge = createElement("span", `mode-badge mode-badge--${device.mode.toLowerCase()}`, device.label);
  if (device.mode === "HFP_HSP") {
    badge.classList.add("is-recoverable");
    badge.dataset.modeLabel = device.label;
    badge.dataset.recoveryLabel = "一键恢复 A2DP";
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    const activateRecovery = (event) => {
      event.preventDefault();
      event.stopPropagation();
      recoverA2dp(device, badge);
    };
    badge.addEventListener("click", activateRecovery);
    badge.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activateRecovery(event);
    });
  }
  const chevron = createElement("span", "chevron");
  chevron.setAttribute("aria-hidden", "true");
  summary.append(icon, title, badge, chevron);

  const details = createElement("div", "device-card__details");
  if (!device.isDefaultOutput) {
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
    card.append(summary, details);
  } else {
  const metrics = createElement("div", "metric-groups");
  metrics.append(
    metricGroup(
      "输出",
      metric("采样率", formatRate(device.sampleRateOutput)),
      metric("声道", device.outputChannels ? `${device.outputChannels} 声道` : "无"),
    ),
    metricGroup(
      "输入",
      metric("采样率", formatRate(device.sampleRateInput)),
      metric("声道", device.inputChannels ? `${device.inputChannels} 声道` : "无"),
    ),
  );
  details.append(metrics, microphoneOccupancySection(device));
  const recovery = recoveryFeedback.get(device.name);
  if (recovery) details.append(recoveryResultSection(recovery));
  card.append(summary, details);
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

async function changeDefaultDevice(select) {
  const direction = select.dataset.direction;
  const name = select.value;
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
    routeMessage.className = "route-message is-success";
    routeMessage.textContent = `已切换为“${name}”，系统设置已生效。`;
    outputSelect.disabled = false;
    inputSelect.disabled = false;
    if (direction === "input") {
      setTimeout(() => refreshDevices({ preserveRouteMessage: true }), 0);
    }
  } catch (error) {
    routeMessage.className = "route-message is-error";
    routeMessage.textContent = `切换失败：${error.message}`;
    outputSelect.disabled = false;
    inputSelect.disabled = false;
  }
}

function renderState(result, options = {}) {
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
  if (!options.preserveRouteMessage) {
    routeMessage.className = "route-message";
    routeMessage.textContent = "选择其他设备后会立即写入系统。";
  }
}

function renderDevices(devices) {
  lastRenderedDevices = devices;
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
  refreshButton.disabled = true;
  refreshButton.classList.add("is-loading");
  countElement.textContent = "正在刷新设备…";
  statusDot.className = "status-dot";
  try {
    const response = await fetch(`/api/devices?time=${Date.now()}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "设备读取失败");
    renderState(result, options);
  } catch (error) {
    listElement.replaceChildren(createElement("div", "error-state", `读取失败：${error.message}`));
    countElement.textContent = "设备读取失败";
    timeElement.textContent = "请稍后重试";
    statusDot.className = "status-dot is-error";
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-loading");
  }
}

refreshButton.addEventListener("click", refreshDevices);
outputSelect.addEventListener("change", () => changeDefaultDevice(outputSelect));
inputSelect.addEventListener("change", () => changeDefaultDevice(inputSelect));
refreshDevices();

const realtimeEvents = new EventSource("/api/events");
realtimeEvents.addEventListener("message", (event) => {
  try {
    renderState(JSON.parse(event.data), { preserveRouteMessage: true });
  } catch {
    // A later system event will replace a malformed update.
  }
});
