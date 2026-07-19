export function createA2dpRecoveryController({
  createElement,
  expandedDevices,
  getLastRenderedDevices,
  refreshDevices,
  renderDevices,
}) {
  const feedbackByDevice = new Map();
  const runningDevices = new Set();

  async function recover(device, action = {}) {
    if (runningDevices.has(device.name)) return;
    runningDevices.add(device.name);
    feedbackByDevice.set(device.name, {
      kind: "running",
      text: "正在保存现场并按已确证原因路由，请稍候。",
    });
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
      feedbackByDevice.set(device.name, {
        kind: result.ok ? "success" : result.actionRequired ? "pending" : "error",
        result,
      });
    } catch (error) {
      feedbackByDevice.set(device.name, { kind: "error", text: `恢复失败：${error.message}` });
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
    feedbackByDevice.set(deviceName, {
      kind: "running",
      text: `${progress.stage}：${progress.message}`,
    });
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
