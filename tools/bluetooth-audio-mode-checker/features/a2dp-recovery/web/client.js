export function isA2dpRecoveryTarget(device) {
  return device?.a2dpRecoveryEligible === true;
}

export function createA2dpRecoveryController({
  createElement,
  getLastRenderedDevices,
  triggerContainer,
  renderDevices,
  schedulePostActionRefresh,
  postJson,
}) {
  const terminalDisplayMs = 10_000;
  const runningDevices = new Set();
  const progressByDevice = new Map();
  const recentlyReleasedPrograms = new Map();
  let batchQueue = [];
  let batchTotal = 0;
  let batchCompleted = 0;
  let batchHadError = false;
  let batchRunning = false;
  let terminalBatchState = null;
  let terminalBatchTimer = 0;

  function renderAggregateTrigger(devices = getLastRenderedDevices()) {
    const repairableDevices = devices.filter(isA2dpRecoveryTarget);
    const overview = createElement("div", "recovery-overview");
    overview.append(createElement(
      "span",
      "recovery-overview__count",
      `识别到有 ${repairableDevices.length} 个设备处于 HFP`,
    ));
    if (terminalBatchState) {
      const result = createElement(
        "button",
        `recovery-trigger is-${terminalBatchState}`,
        terminalBatchState === "success" ? "成功" : "错误",
      );
      result.type = "button";
      result.disabled = true;
      result.setAttribute("role", "status");
      result.setAttribute("aria-live", "polite");
      overview.append(result);
    } else if (repairableDevices.length > 0) {
      const isBusy = batchRunning || runningDevices.size > 0;
      const progress = [...progressByDevice.values()][0];
      const label = isBusy
        ? progress ?? `正在修复 ${Math.min(batchCompleted + 1, batchTotal)}/${batchTotal}`
        : "一键修复";
      const button = createElement("button", `recovery-trigger${isBusy ? " is-running" : ""}`, label);
      button.type = "button";
      button.disabled = isBusy;
      button.setAttribute("aria-label", "一键修复全部需要修复的 HFP 设备");
      if (!button.disabled) button.addEventListener("click", () => recoverAll(getLastRenderedDevices()));
      overview.append(button);
    }
    triggerContainer.replaceChildren(overview);
  }

  function clearTerminalBatchState() {
    if (terminalBatchTimer) window.clearTimeout(terminalBatchTimer);
    terminalBatchTimer = 0;
    terminalBatchState = null;
  }

  function showTerminalBatchState(kind) {
    clearTerminalBatchState();
    terminalBatchState = kind;
    renderAggregateTrigger();
    terminalBatchTimer = window.setTimeout(() => {
      terminalBatchTimer = 0;
      terminalBatchState = null;
      renderAggregateTrigger();
    }, terminalDisplayMs);
  }

  async function recover(device) {
    if (runningDevices.has(device.name)) return;
    runningDevices.add(device.name);
    progressByDevice.set(device.name, "正在修复…");
    renderAggregateTrigger();
    try {
      const result = await postJson("/api/a2dp-recovery", { name: device.name }, "恢复失败");
      for (const program of result.releasedPrograms ?? []) recentlyReleasedPrograms.set(program, Date.now());
      batchHadError = batchHadError || !result.ok;
    } catch {
      batchHadError = true;
    } finally {
      runningDevices.delete(device.name);
      progressByDevice.delete(device.name);
      renderAggregateTrigger();
      renderDevices(getLastRenderedDevices());
      schedulePostActionRefresh();
    }
  }

  async function runBatch() {
    if (batchRunning) return;
    batchRunning = true;
    renderAggregateTrigger();
    while (batchQueue.length > 0) {
      const deviceName = batchQueue[0];
      const device = getLastRenderedDevices().find((item) => item.name === deviceName);
      if (device && isA2dpRecoveryTarget(device)) await recover(device);
      batchQueue.shift();
      batchCompleted += 1;
    }
    batchRunning = false;
    batchQueue = [];
    batchTotal = 0;
    batchCompleted = 0;
    const terminalKind = batchHadError ? "error" : "success";
    batchHadError = false;
    showTerminalBatchState(terminalKind);
  }

  async function recoverAll(devices) {
    if (batchRunning || runningDevices.size > 0) return;
    clearTerminalBatchState();
    batchQueue = devices.filter(isA2dpRecoveryTarget).map((device) => device.name);
    if (batchQueue.length === 0) {
      renderAggregateTrigger(devices);
      return;
    }
    batchTotal = batchQueue.length;
    batchCompleted = 0;
    batchHadError = false;
    await runBatch();
  }

  function handleProgress(deviceName, progress) {
    if (!runningDevices.has(deviceName)) return;
    progressByDevice.set(deviceName, `${progress.stage}…`);
    renderAggregateTrigger();
  }

  return {
    recentlyReleasedPrograms,
    recoverAll,
    renderAggregateTrigger,
    handleProgress,
  };
}
