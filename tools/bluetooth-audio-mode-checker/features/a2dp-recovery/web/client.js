export function createA2dpRecoveryController({
  createElement,
  expandedDevices,
  getLastRenderedDevices,
  renderDevices,
  schedulePostActionRefresh,
}) {
  const storageKey = "a2dp-recovery-feedback-v1";

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

  const storedFeedback = readStoredFeedback();
  let removedLegacyInspection = false;
  for (const [deviceName, feedback] of Object.entries(storedFeedback)) {
    const obsoleteInspection = feedback?.source === "inspection" && !feedback.result?.actionRequired;
    const obsoleteIneligibleTarget = feedback?.result?.diagnosis?.summary === "目标当前不是可处理的低采样率默认输出";
    if (obsoleteInspection || obsoleteIneligibleTarget) {
      delete storedFeedback[deviceName];
      removedLegacyInspection = true;
    }
  }
  if (removedLegacyInspection) writeStoredFeedback(storedFeedback);
  const feedbackByDevice = new Map(Object.entries(storedFeedback));
  const runningDevices = new Set();
  const inspectingDevices = new Set();
  const progressByDevice = new Map();
  const recentlyReleasedPrograms = new Map();
  for (const [deviceName, feedback] of feedbackByDevice) {
    if (feedback?.result?.actionRequired) expandedDevices.add(deviceName);
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
    progressByDevice.set(device.name, choosingRoute ? "正在切换输入输出…" : "正在检查麦克风占用…");
    setFeedback(device.name, {
      kind: "running",
      text: choosingRoute ? "正在按你的授权切换输入输出。" : "正在检查并优先解除麦克风占用。",
    }, false);
    expandedDevices.add(device.name);
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
        kind: result.ok ? "success" : result.actionRequired ? "pending" : "error",
        result,
      });
    } catch (error) {
      setFeedback(device.name, { kind: "error", text: `恢复失败：${error.message}` });
    } finally {
      runningDevices.delete(device.name);
      progressByDevice.delete(device.name);
      renderDevices(getLastRenderedDevices());
    }
    schedulePostActionRefresh();
  }

  function resultSection(feedback, deviceName) {
    const section = createElement("section", `recovery-feedback is-${feedback.kind}`);
    section.setAttribute("role", "status");
    section.setAttribute("aria-live", "polite");
    if (!feedback.result) {
      if (feedback.kind === "running") section.append(createElement("strong", "recovery-title", "正在修复，请稍候…"));
      section.append(createElement("p", "recovery-summary", feedback.text));
      return section;
    }
    const result = feedback.result;
    const resultPrefix = feedback.source === "inspection"
      ? "自动只读复核"
      : result.actionRequired ? "需要你选择" : "最近一次修复";
    section.append(
      createElement("strong", "recovery-title", `${resultPrefix}：${result.outcome}`),
      ...(feedback.recordedAt ? [createElement(
        "p",
        "recovery-time",
        new Date(feedback.recordedAt).toLocaleString("zh-CN", { hour12: false }),
      )] : []),
      createElement("p", "recovery-path", `工作流：${result.recoveryPath}`),
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
    if (result.releasedPrograms?.some((name) => /WeType|微信输入法/i.test(name))) {
      section.append(createElement(
        "p",
        "recovery-input-method-note",
        "微信输入法进程已经停止读取麦克风，但进程自动重启不代表语音快捷键已恢复。本机实测如无法再次唤起语音，请切换一次输入法，或在微信输入法的语音设置中关闭再开启免提模式。",
      ));
    }
    if (result.actionRequired?.kind === "route-choice") {
      const actions = createElement("div", "recovery-actions");
      actions.append(createElement("p", "recovery-action-prompt", result.actionRequired.prompt));
      for (const choice of result.actionRequired.choices) {
        const button = createElement("button", "recovery-action", choice.label);
        button.type = "button";
        button.addEventListener("click", () => {
          const device = getLastRenderedDevices().find((item) => item.name === deviceName);
          if (device) recover(device, { inspectMultiEndpoint: true, routeChoiceId: choice.id });
        });
        actions.append(button);
      }
      section.append(actions);
    }
    if (result.actionRequired?.kind === "relaunch-authorization") {
      const actions = createElement("div", "recovery-actions");
      actions.append(createElement("p", "recovery-action-prompt", result.actionRequired.prompt));
      const authorize = createElement("button", "recovery-action is-danger", "授权本次开机阻止自动拉起");
      authorize.type = "button";
      authorize.addEventListener("click", () => {
        const device = getLastRenderedDevices().find((item) => item.name === deviceName);
        if (device && window.confirm(result.actionRequired.prompt)) {
          recover(device, { authorizeRelaunchBlock: true });
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

  async function inspectRouteConflict(device) {
    if (inspectingDevices.has(device.name) || runningDevices.has(device.name)) return;
    const existing = feedbackByDevice.get(device.name)?.result;
    if (existing?.actionRequired?.kind === "route-choice") return;
    inspectingDevices.add(device.name);
    try {
      const response = await fetch("/api/a2dp-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: device.name, inspectMultiEndpoint: true }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "复核失败");
      if (runningDevices.has(device.name)) return;
      if (!result.actionRequired) return;
      setFeedback(device.name, {
        kind: "pending",
        source: "inspection",
        result,
      });
      expandedDevices.add(device.name);
      renderDevices(getLastRenderedDevices());
    } catch {
      // 自动只读复核失败不得阻止用户主动修复。
    } finally {
      inspectingDevices.delete(device.name);
    }
  }

  return {
    feedbackByDevice,
    runningDevices,
    progressByDevice,
    recentlyReleasedPrograms,
    recover,
    inspectRouteConflict,
    resultSection,
    handleProgress,
  };
}
