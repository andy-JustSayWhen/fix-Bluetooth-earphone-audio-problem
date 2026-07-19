export function createA2dpRecoveryController({
  createElement,
  expandedDevices,
  getLastRenderedDevices,
  refreshDevices,
  renderDevices,
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
  const feedbackByDevice = new Map(Object.entries(storedFeedback));
  const runningDevices = new Set();
  for (const deviceName of feedbackByDevice.keys()) expandedDevices.add(deviceName);

  function setFeedback(deviceName, feedback, persist = true) {
    feedbackByDevice.set(deviceName, feedback);
    const stored = readStoredFeedback();
    if (persist) stored[deviceName] = feedback;
    else delete stored[deviceName];
    writeStoredFeedback(stored);
  }

  async function recover(device, action = {}) {
    if (runningDevices.has(device.name)) return;
    runningDevices.add(device.name);
    setFeedback(device.name, {
      kind: "running",
      text: "正在保存现场并按已确证原因路由，请稍候。",
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
      setFeedback(device.name, {
        kind: result.ok ? "success" : result.actionRequired ? "pending" : "error",
        result,
      });
    } catch (error) {
      setFeedback(device.name, { kind: "error", text: `恢复失败：${error.message}` });
    } finally {
      runningDevices.delete(device.name);
      renderDevices(getLastRenderedDevices());
    }
    await refreshDevices({ preserveRouteMessage: true });
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
    section.append(
      createElement("strong", "recovery-title", result.outcome),
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
          if (device) recover(device, { routeChoiceId: choice.id });
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
    setFeedback(deviceName, {
      kind: "running",
      text: `${progress.stage}：${progress.message}`,
    }, false);
    renderDevices(getLastRenderedDevices());
  }

  return {
    feedbackByDevice,
    runningDevices,
    recover,
    resultSection,
    handleProgress,
  };
}
