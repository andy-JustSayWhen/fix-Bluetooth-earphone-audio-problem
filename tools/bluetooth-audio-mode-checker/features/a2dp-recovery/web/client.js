function quotedNames(names) {
  return names.map((name) => `「${name}」`).join("、");
}

function routeActionSummary(result) {
  const detail = result.steps?.find((item) =>
    item.stage === "应用多端点替代组合" && item.status === "成功"
  )?.detail;
  if (!detail) return null;
  const input = detail.match(/麦克风改为“([^”]+)”$/)?.[1] ?? detail.match(/麦克风改为(.+)$/)?.[1];
  if (input) return `已将输入切换为「${input}」`;
  const output = detail.match(/扬声器改为“([^”]+)”$/)?.[1] ?? detail.match(/扬声器改为(.+)$/)?.[1];
  if (output) return `已将输出切换为「${output}」`;
  const both = detail.match(/输入输出都改用“([^”]+)”$/)?.[1] ?? detail.match(/输入输出都改用(.+)$/)?.[1];
  return both ? `已将输入和输出切换为「${both}」` : null;
}

export function successfulRecoverySummary(result, deviceName) {
  const actions = [];
  const guardedPrograms = result.guardedPrograms ?? [];
  if (guardedPrograms.length > 0) {
    actions.push(`已在本次开机期间阻止${quotedNames(guardedPrograms)}自动拉起`);
  }
  const programs = result.releasedPrograms ?? [];
  if (programs.length > 0) {
    if (result.diagnosis.kind === "麦克风占用类") {
      actions.push(`已解除${quotedNames(programs)}的麦克风占用`);
    } else if (result.diagnosis.kind === "链路残留类") {
      actions.push(`已解除${quotedNames(programs)}的输入占用`);
    } else if (result.diagnosis.kind === "格式请求类") {
      actions.push(`已结束${quotedNames(programs)}发起的声音格式请求`);
    } else {
      actions.push(`已结束${quotedNames(programs)}的相关声音会话`);
    }
  }
  const routeAction = routeActionSummary(result);
  if (routeAction) actions.push(routeAction);
  if (result.diagnosis.kind === "链路残留类" && result.recoveryPath === "原因对应处理") {
    actions.push(result.usedReconnect
      ? `已重建「${deviceName}」的蓝牙连接并恢复点击前输入输出`
      : "已解除残留声音链路并恢复点击前输入输出");
  }
  if (actions.length === 0 && result.usedReconnect) {
    actions.push(`已重建「${deviceName}」的蓝牙连接`);
  }
  if (actions.length === 0 && result.recoveryPath === "声音链路重建兜底") {
    actions.push("已重建声音链路并恢复点击前输入输出");
  }
  return actions.join("，并");
}

export function shouldContinueAfterOccupancyEnded(feedback, microphoneUsers, occupancyCapturedAt) {
  const action = feedback?.result?.actionRequired;
  if (action?.kind !== "relaunch-authorization" || action.cause !== "麦克风占用类") return false;
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
  let removedLegacyInspection = false;
  for (const [deviceName, feedback] of Object.entries(storedFeedback)) {
    const obsoleteInspection = feedback?.source === "inspection";
    const obsoleteIneligibleTarget = feedback?.result?.diagnosis?.summary === "目标当前不是可处理的低采样率默认输出";
    const obsoleteUnmarkedInspection = feedback?.result?.recoveryPath === "现场复核" &&
      !feedback.result?.actionRequired &&
      feedback.result?.diagnosis?.summary === "尚不能确认具体应用拒绝了当前双蓝牙组合";
    const obsoleteAuthorization = feedback?.result?.actionRequired?.kind === "relaunch-authorization" &&
      !["still-running", "restarted"].includes(feedback.result.actionRequired.triggerState);
    if (obsoleteInspection || obsoleteIneligibleTarget || obsoleteUnmarkedInspection || obsoleteAuthorization) {
      delete storedFeedback[deviceName];
      removedLegacyInspection = true;
    }
  }
  if (removedLegacyInspection) writeStoredFeedback(storedFeedback);
  const feedbackByDevice = new Map(Object.entries(storedFeedback));
  const runningDevices = new Set();
  const progressByDevice = new Map();
  const recentlyReleasedPrograms = new Map();
  const storedBatch = readStoredBatch();
  let batchQueue = storedBatch?.queue ?? [];
  let batchTotal = storedBatch?.total ?? 0;
  let batchCompleted = storedBatch?.completed ?? 0;
  let batchRunning = false;
  let batchPausedDevice = storedBatch?.pausedDevice ?? null;
  let batchResumeScheduled = false;
  if (batchPausedDevice !== null && !feedbackByDevice.get(batchPausedDevice)?.result?.actionRequired) {
    batchQueue = [];
    batchTotal = 0;
    batchCompleted = 0;
    batchPausedDevice = null;
    writeStoredBatch(null);
  } else if (batchPausedDevice === null && batchQueue.length > 0) {
    batchQueue = [];
    batchTotal = 0;
    batchCompleted = 0;
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
      pausedDevice: batchPausedDevice,
    });
  }

  function removeStoredFeedback(deviceName) {
    if (!feedbackByDevice.delete(deviceName)) return;
    const stored = readStoredFeedback();
    delete stored[deviceName];
    writeStoredFeedback(stored);
  }

  function reconcileUnsupportedDevices(devices) {
    const unsupportedNames = new Set(devices
      .filter((device) => device.a2dpSupport === "UNSUPPORTED")
      .map((device) => device.name));
    for (const deviceName of unsupportedNames) removeStoredFeedback(deviceName);
    if (unsupportedNames.size === 0 || batchQueue.length === 0) return;
    const previousLength = batchQueue.length;
    const pausedWasUnsupported = batchPausedDevice !== null && unsupportedNames.has(batchPausedDevice);
    batchQueue = batchQueue.filter((deviceName) => !unsupportedNames.has(deviceName));
    batchCompleted = Math.min(batchTotal, batchCompleted + previousLength - batchQueue.length);
    if (pausedWasUnsupported) batchPausedDevice = null;
    if (batchQueue.length === 0 && batchPausedDevice === null) {
      batchTotal = 0;
      batchCompleted = 0;
    }
    persistBatchState();
    if (pausedWasUnsupported && batchQueue.length > 0 && !batchRunning && !batchResumeScheduled) {
      batchResumeScheduled = true;
      queueMicrotask(async () => {
        batchResumeScheduled = false;
        await runBatch();
      });
    }
  }

  function renderAggregateTrigger(devices = getLastRenderedDevices()) {
    reconcileUnsupportedDevices(devices);
    const hfpDevices = devices.filter((device) => device.mode === "HFP_HSP");
    const repairableDevices = hfpDevices.filter(isA2dpRecoveryTarget);
    const overview = createElement("div", "recovery-overview");
    overview.append(createElement(
      "span",
      "recovery-overview__count",
      hfpDevices.length === repairableDevices.length
        ? `识别到有 ${hfpDevices.length} 个设备处于 HFP`
        : `识别到有 ${hfpDevices.length} 个设备处于 HFP，其中 ${repairableDevices.length} 个需要修复`,
    ));
    if (repairableDevices.length > 0) {
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
    const choosingRoute = Boolean(action.routeChoiceId);
    const authorizingRelaunchBlock = action.authorizeRelaunchBlock === true;
    const continuingAfterOccupancyEnded = action.continueAfterOccupancyEnded === true;
    progressByDevice.set(
      device.name,
      choosingRoute
        ? "正在切换输入输出…"
        : authorizingRelaunchBlock
          ? "正在复核授权…"
          : continuingAfterOccupancyEnded ? "正在按最新现场继续…" : "正在保存现场…",
    );
    setFeedback(device.name, {
      kind: "running",
      text: choosingRoute
        ? "正在按你的选择切换输入输出。"
        : authorizingRelaunchBlock
          ? "正在沿用原修复回合，重新确认所列进程仍在读取麦克风。"
          : continuingAfterOccupancyEnded
            ? "较新的占用快照确认相关进程已停止读取，正在撤销过时授权并沿用原回合继续。"
            : "正在保存点击现场，然后依次检查多端点与 tsco、实体麦克风占用和链路残留。",
    }, false);
    expandedDevices.add(device.name);
    renderAggregateTrigger();
    renderDevices(getLastRenderedDevices());
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
      setFeedback(device.name, {
        kind: result.actionRequired
          ? "pending"
          : result.outcome === "无需修复"
            ? "neutral"
            : result.ok ? "success" : "error",
        result,
      });
    } catch (error) {
      setFeedback(device.name, { kind: "error", text: `恢复失败：${error.message}` });
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
    renderAggregateTrigger();
  }

  async function recoverAll(devices) {
    if (batchRunning || batchPausedDevice) return;
    batchQueue = devices
      .filter(isA2dpRecoveryTarget)
      .map((device) => device.name);
    if (batchQueue.length === 0) {
      renderAggregateTrigger(devices);
      return;
    }
    batchTotal = batchQueue.length;
    batchCompleted = 0;
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

  function resultSection(feedback, deviceName) {
    const displayKind = feedback.result?.outcome === "无需修复" ? "neutral" : feedback.kind;
    const section = createElement("section", `recovery-feedback is-${displayKind}`);
    section.setAttribute("role", "status");
    section.setAttribute("aria-live", "polite");
    if (!feedback.result) {
      if (feedback.kind === "running") section.append(createElement("strong", "recovery-title", "正在修复，请稍候…"));
      section.append(createElement("p", "recovery-summary", feedback.text));
      return section;
    }
    const result = feedback.result;
    if (!result.actionRequired) {
      const succeeded = result.outcome === "完全恢复" || result.outcome === "绕过成功";
      const status = succeeded
        ? "修复成功"
        : result.outcome === "无需修复" ? "未执行修复" : "修复失败";
      const header = createElement("div", "recovery-result-header");
      header.append(
        createElement("strong", "recovery-title", status),
        createElement(
          "time",
          "recovery-time",
          feedback.recordedAt
            ? new Date(feedback.recordedAt).toLocaleString("zh-CN", { hour12: false })
            : "时间未知",
        ),
      );
      section.append(header);
      if (succeeded) {
        section.append(createElement(
          "p",
          "recovery-summary",
          successfulRecoverySummary(result, deviceName) || "已恢复目标设备的高音质播放",
        ));
      }
      return section;
    }

    section.append(createElement("strong", "recovery-title", "需要你选择"));
    if (result.actionRequired?.kind === "route-choice") {
      const actions = createElement("div", "recovery-actions");
      actions.append(createElement("p", "recovery-action-prompt", result.actionRequired.prompt));
      for (const choice of result.actionRequired.choices) {
        const button = createElement("button", "recovery-action", choice.label);
        button.type = "button";
        button.addEventListener("click", () => {
          const device = getLastRenderedDevices().find((item) => item.name === deviceName);
          if (device) recoverAndResumeBatch(device, {
            routeChoiceId: choice.id,
          });
        });
        actions.append(button);
      }
      section.append(actions);
    }
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
    renderDevices(getLastRenderedDevices());
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
    resultSection,
    handleProgress,
    reconcilePendingAuthorizations,
    getPendingRouteChoice: () => [...feedbackByDevice.values()]
      .map((feedback) => feedback?.result)
      .find((result) => result?.actionRequired?.kind === "route-choice") ?? null,
  };
}
