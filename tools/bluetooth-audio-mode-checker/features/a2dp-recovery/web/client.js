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
    const obsoleteInspection = feedback?.source === "inspection";
    const obsoleteIneligibleTarget = feedback?.result?.diagnosis?.summary === "目标当前不是可处理的低采样率默认输出";
    const obsoleteUnmarkedInspection = feedback?.result?.recoveryPath === "现场复核" &&
      !feedback.result?.actionRequired &&
      feedback.result?.diagnosis?.summary === "尚不能确认具体应用拒绝了当前双蓝牙组合";
    if (obsoleteInspection || obsoleteIneligibleTarget || obsoleteUnmarkedInspection) {
      delete storedFeedback[deviceName];
      removedLegacyInspection = true;
    }
  }
  if (removedLegacyInspection) writeStoredFeedback(storedFeedback);
  const feedbackByDevice = new Map(Object.entries(storedFeedback));
  const runningDevices = new Set();
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
    const authorizingRelaunchBlock = action.authorizeRelaunchBlock === true;
    progressByDevice.set(
      device.name,
      choosingRoute ? "正在切换输入输出…" : authorizingRelaunchBlock ? "正在应用本次开机授权…" : "正在保存现场…",
    );
    setFeedback(device.name, {
      kind: "running",
      text: choosingRoute
        ? "正在按你的选择切换输入输出。"
        : authorizingRelaunchBlock
          ? "正在沿用原修复回合，阻止已列出的进程在本次开机期间自动拉起。"
          : "正在保存点击现场，然后检查并优先解除麦克风占用。",
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
      renderDevices(getLastRenderedDevices());
    }
    schedulePostActionRefresh();
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
          if (device) recover(device, {
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
        processNames.length === 1
          ? `授权本次开机阻止 ${processNames[0]} 自动拉起`
          : "授权本次开机阻止上述进程自动拉起",
      );
      authorize.type = "button";
      authorize.addEventListener("click", () => {
        const device = getLastRenderedDevices().find((item) => item.name === deviceName);
        const confirmation = `涉及进程：${processLabel}\n\n${result.actionRequired.prompt}`;
        if (device && window.confirm(confirmation)) {
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

  return {
    feedbackByDevice,
    runningDevices,
    progressByDevice,
    recentlyReleasedPrograms,
    recover,
    resultSection,
    handleProgress,
    getPendingRouteChoice: () => [...feedbackByDevice.values()]
      .map((feedback) => feedback?.result)
      .find((result) => result?.actionRequired?.kind === "route-choice") ?? null,
  };
}
