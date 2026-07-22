export function shouldContinueAfterOccupancyEnded(feedback, microphoneUsers, occupancyCapturedAt) {
  const action = feedback?.result?.actionRequired;
  if (action?.kind !== "relaunch-authorization" || action.cause !== "麦克风占用类") return false;
  if (action.occupancyEvidence !== "physical-bluetooth-microphone") return false;
  const capturedAt = Date.parse(occupancyCapturedAt);
  const recordedAt = Date.parse(feedback.recordedAt ?? "");
  if (!Number.isFinite(capturedAt) || !Number.isFinite(recordedAt) || capturedAt <= recordedAt) return false;
  const activeNames = new Set((microphoneUsers ?? [])
    .filter((user) => user.inputActivityKind === "已确认实体麦克风占用")
    .map((user) => user.name));
  return !action.processNames.some((name) => activeNames.has(name));
}

export function isA2dpRecoveryTarget(device) {
  return device?.mode === "HFP_HSP" && device.a2dpSupport !== "UNSUPPORTED";
}

export function createA2dpRecoveryController({
  createElement,
  expandedDevices,
  getLastRenderedDevices,
  triggerContainer,
  renderDevices,
  schedulePostActionRefresh,
}) {
  const storageKey = "a2dp-recovery-feedback-v1";
  const batchStorageKey = "a2dp-recovery-batch-v1";
  const terminalDisplayMs = 10_000;

  function readStoredFeedback() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(storageKey) || "{}");
      return stored && typeof stored === "object" ? stored : {};
    } catch {
      return {};
    }
  }

  function writeStoredFeedback(stored) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(stored));
    } catch {
      // The current page still shows the result when browser storage is unavailable.
    }
  }

  function readStoredBatch() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(batchStorageKey) || "null");
      if (!stored || !Array.isArray(stored.queue)) return null;
      return {
        queue: stored.queue.filter((name) => typeof name === "string" && name.length > 0),
        total: Number.isInteger(stored.total) && stored.total >= 0 ? stored.total : 0,
        completed: Number.isInteger(stored.completed) && stored.completed >= 0 ? stored.completed : 0,
        hadError: stored.hadError === true,
        pausedDevice: typeof stored.pausedDevice === "string" && stored.pausedDevice.length > 0
          ? stored.pausedDevice
          : null,
      };
    } catch {
      return null;
    }
  }

  function writeStoredBatch(stored) {
    try {
      if (!stored) window.sessionStorage.removeItem(batchStorageKey);
      else window.sessionStorage.setItem(batchStorageKey, JSON.stringify(stored));
    } catch {
      // Storage failure only disables refresh recovery; the current page can still finish the batch.
    }
  }

  const storedFeedback = readStoredFeedback();
  let removedInvalidFeedback = false;
  for (const [deviceName, feedback] of Object.entries(storedFeedback)) {
    const action = feedback?.result?.actionRequired;
    const invalid = action?.kind !== "relaunch-authorization" ||
      !["still-running", "restarted"].includes(action.triggerState);
    if (invalid) {
      delete storedFeedback[deviceName];
      removedInvalidFeedback = true;
    }
  }
  if (removedInvalidFeedback) writeStoredFeedback(storedFeedback);
  const feedbackByDevice = new Map(Object.entries(storedFeedback));
  const runningDevices = new Set();
  const progressByDevice = new Map();
  const recentlyReleasedPrograms = new Map();
  const storedBatch = readStoredBatch();
  let batchQueue = storedBatch?.queue ?? [];
  let batchTotal = storedBatch?.total ?? 0;
  let batchCompleted = storedBatch?.completed ?? 0;
  let batchHadError = storedBatch?.hadError ?? false;
  let batchRunning = false;
  let batchPausedDevice = storedBatch?.pausedDevice ?? null;
  let batchResumeScheduled = false;
  let terminalBatchState = null;
  let terminalBatchTimer = 0;
  if (batchPausedDevice !== null && !feedbackByDevice.get(batchPausedDevice)?.result?.actionRequired) {
    batchQueue = [];
    batchTotal = 0;
    batchCompleted = 0;
    batchHadError = false;
    batchPausedDevice = null;
    writeStoredBatch(null);
  } else if (batchPausedDevice === null && batchQueue.length > 0) {
    batchQueue = [];
    batchTotal = 0;
    batchCompleted = 0;
    batchHadError = false;
    writeStoredBatch(null);
  }
  for (const [deviceName, feedback] of feedbackByDevice) {
    if (feedback?.result?.actionRequired) expandedDevices.add(deviceName);
  }

  function persistBatchState() {
    if (batchQueue.length === 0 && batchPausedDevice === null) {
      writeStoredBatch(null);
      return;
    }
    writeStoredBatch({
      queue: batchQueue,
      total: batchTotal,
      completed: batchCompleted,
      hadError: batchHadError,
      pausedDevice: batchPausedDevice,
    });
  }

  function removeStoredFeedback(deviceName) {
    if (!feedbackByDevice.delete(deviceName)) return;
    const stored = readStoredFeedback();
    delete stored[deviceName];
    writeStoredFeedback(stored);
  }

  function reconcilePendingDevices(devices) {
    const deviceByName = new Map(devices.map((device) => [device.name, device]));
    const ineligibleNames = new Set(devices
      .filter((device) => !isA2dpRecoveryTarget(device))
      .map((device) => device.name));
    const stalePendingNames = new Set([...feedbackByDevice.entries()]
      .filter(([deviceName, feedback]) =>
        feedback?.result?.actionRequired &&
        (!deviceByName.has(deviceName) || ineligibleNames.has(deviceName))
      )
      .map(([deviceName]) => deviceName));
    for (const deviceName of new Set([...ineligibleNames, ...stalePendingNames])) {
      removeStoredFeedback(deviceName);
    }
    if (batchQueue.length === 0) return;
    const previousLength = batchQueue.length;
    const pausedWasStale = batchPausedDevice !== null && (
      ineligibleNames.has(batchPausedDevice) || stalePendingNames.has(batchPausedDevice)
    );
    batchQueue = batchQueue.filter((deviceName) => !ineligibleNames.has(deviceName));
    batchCompleted = Math.min(batchTotal, batchCompleted + previousLength - batchQueue.length);
    if (pausedWasStale) batchPausedDevice = null;
    if (batchQueue.length === 0 && batchPausedDevice === null) {
      batchTotal = 0;
      batchCompleted = 0;
    }
    persistBatchState();
    if (pausedWasStale && batchQueue.length > 0 && !batchRunning && !batchResumeScheduled) {
      batchResumeScheduled = true;
      queueMicrotask(async () => {
        batchResumeScheduled = false;
        await runBatch();
      });
    }
  }

  function renderAggregateTrigger(devices = getLastRenderedDevices()) {
    reconcilePendingDevices(devices);
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
      const hasPendingAction = [...feedbackByDevice.values()]
        .some((feedback) => Boolean(feedback?.result?.actionRequired));
      const isBusy = batchRunning || runningDevices.size > 0;
      const label = batchRunning
        ? `正在修复 ${Math.min(batchCompleted + 1, batchTotal)}/${batchTotal}`
        : hasPendingAction ? "请先完成当前选择" : "一键修复";
      const button = createElement("button", `recovery-trigger${isBusy ? " is-running" : ""}`, label);
      button.type = "button";
      button.disabled = isBusy || hasPendingAction;
      button.setAttribute("aria-label", "一键修复全部需要修复的 HFP 设备");
      if (!button.disabled) {
        button.addEventListener("click", () => recoverAll(getLastRenderedDevices()));
      }
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

  function setFeedback(deviceName, feedback, persist = true) {
    const nextFeedback = persist && !feedback.recordedAt
      ? { ...feedback, recordedAt: new Date().toISOString() }
      : feedback;
    feedbackByDevice.set(deviceName, nextFeedback);
    const stored = readStoredFeedback();
    if (persist) stored[deviceName] = nextFeedback;
    else delete stored[deviceName];
    writeStoredFeedback(stored);
  }

  async function recover(device, action = {}) {
    if (runningDevices.has(device.name)) return;
    runningDevices.add(device.name);
    const authorizingRelaunchBlock = action.authorizeRelaunchBlock === true;
    const continuingAfterOccupancyEnded = action.continueAfterOccupancyEnded === true;
    progressByDevice.set(
      device.name,
      authorizingRelaunchBlock
          ? "正在复核授权…"
          : continuingAfterOccupancyEnded ? "正在按最新现场继续…" : "正在保存现场…",
    );
    setFeedback(device.name, {
      kind: "running",
      text: authorizingRelaunchBlock
          ? "正在沿用原修复回合，重新确认所列进程仍在读取麦克风。"
          : continuingAfterOccupancyEnded
            ? "较新的占用快照确认相关进程已停止读取，正在撤销过时授权并沿用原回合继续。"
            : "正在保存点击现场，然后按固定顺序执行修复。",
    }, false);
    renderAggregateTrigger();
    try {
      const response = await fetch("/api/a2dp-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: device.name, ...action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "恢复失败");
      for (const program of result.releasedPrograms ?? []) {
        recentlyReleasedPrograms.set(program, Date.now());
      }
      if (result.actionRequired) {
        setFeedback(device.name, { kind: "pending", result });
      } else {
        batchHadError = batchHadError || !result.ok;
        removeStoredFeedback(device.name);
      }
    } catch (error) {
      batchHadError = true;
      removeStoredFeedback(device.name);
    } finally {
      runningDevices.delete(device.name);
      progressByDevice.delete(device.name);
      renderAggregateTrigger();
      renderDevices(getLastRenderedDevices());
    }
    schedulePostActionRefresh();
  }

  async function runBatch() {
    if (batchRunning) return;
    batchRunning = true;
    renderAggregateTrigger();
    while (batchQueue.length > 0) {
      const deviceName = batchQueue[0];
      const device = getLastRenderedDevices().find((item) => item.name === deviceName);
      if (!device || !isA2dpRecoveryTarget(device)) {
        batchQueue.shift();
        batchCompleted += 1;
        persistBatchState();
        continue;
      }
      await recover(device);
      if (feedbackByDevice.get(deviceName)?.result?.actionRequired) {
        batchPausedDevice = deviceName;
        batchRunning = false;
        persistBatchState();
        renderAggregateTrigger();
        return;
      }
      batchQueue.shift();
      batchCompleted += 1;
      persistBatchState();
    }
    batchRunning = false;
    batchPausedDevice = null;
    batchQueue = [];
    batchTotal = 0;
    batchCompleted = 0;
    persistBatchState();
    const terminalKind = batchHadError ? "error" : "success";
    batchHadError = false;
    showTerminalBatchState(terminalKind);
  }

  async function recoverAll(devices) {
    if (batchRunning || batchPausedDevice) return;
    clearTerminalBatchState();
    batchQueue = devices
      .filter(isA2dpRecoveryTarget)
      .map((device) => device.name);
    if (batchQueue.length === 0) {
      renderAggregateTrigger(devices);
      return;
    }
    batchTotal = batchQueue.length;
    batchCompleted = 0;
    batchHadError = false;
    persistBatchState();
    await runBatch();
  }

  async function recoverAndResumeBatch(device, action) {
    await recover(device, action);
    if (batchPausedDevice !== device.name) return;
    if (feedbackByDevice.get(device.name)?.result?.actionRequired) {
      renderAggregateTrigger();
      return;
    }
    if (batchQueue[0] === device.name) {
      batchQueue.shift();
      batchCompleted += 1;
    }
    batchPausedDevice = null;
    persistBatchState();
    await runBatch();
  }

  function actionSection(feedback, deviceName) {
    const section = createElement("section", "recovery-feedback is-pending");
    section.setAttribute("role", "status");
    section.setAttribute("aria-live", "polite");
    const result = feedback.result;
    section.append(createElement("strong", "recovery-title", "需要你选择"));
    if (result.actionRequired?.kind === "relaunch-authorization") {
      const actions = createElement("div", "recovery-actions");
      const processNames = [...new Set((result.actionRequired.processNames ?? [])
        .filter((name) => typeof name === "string" && name.length > 0))];
      const processLabel = processNames.length > 0 ? processNames.join("、") : "名称无法确认的进程";
      actions.append(createElement("p", "recovery-action-prompt", `涉及进程：${processLabel}`));
      actions.append(createElement("p", "recovery-action-prompt", result.actionRequired.prompt));
      const authorize = createElement(
        "button",
        "recovery-action is-danger",
        result.actionRequired.triggerState === "still-running" && processNames.length === 1
          ? `授权本次开机持续阻止 ${processNames[0]} 运行`
          : result.actionRequired.triggerState === "still-running"
            ? "授权本次开机持续阻止上述进程运行"
            : processNames.length === 1
              ? `授权本次开机阻止 ${processNames[0]} 自动拉起`
              : "授权本次开机阻止上述进程自动拉起",
      );
      authorize.type = "button";
      authorize.addEventListener("click", () => {
        const device = getLastRenderedDevices().find((item) => item.name === deviceName);
        const confirmation = `涉及进程：${processLabel}\n\n${result.actionRequired.prompt}`;
        if (device && window.confirm(confirmation)) {
          recoverAndResumeBatch(device, { authorizeRelaunchBlock: true });
        }
      });
      actions.append(authorize);
      section.append(actions);
    }
    return section;
  }

  function handleProgress(deviceName, progress) {
    if (!runningDevices.has(deviceName)) return;
    progressByDevice.set(deviceName, `${progress.stage}…`);
    setFeedback(deviceName, {
      kind: "running",
      text: `${progress.stage}：${progress.message}`,
    }, false);
    renderAggregateTrigger();
  }

  function reconcilePendingAuthorizations(devices, microphoneUsers, occupancyCapturedAt) {
    for (const [deviceName, feedback] of feedbackByDevice) {
      if (runningDevices.has(deviceName) || !shouldContinueAfterOccupancyEnded(feedback, microphoneUsers, occupancyCapturedAt)) continue;
      const device = devices.find((item) => item.name === deviceName);
      if (device) recoverAndResumeBatch(device, { continueAfterOccupancyEnded: true });
    }
  }

  return {
    feedbackByDevice,
    runningDevices,
    progressByDevice,
    recentlyReleasedPrograms,
    recover,
    recoverAll,
    renderAggregateTrigger,
    actionSection,
    handleProgress,
    reconcilePendingAuthorizations,
  };
}
