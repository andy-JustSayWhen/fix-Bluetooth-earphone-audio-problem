export function createSpeakerOccupancyController({
  createElement,
  getLastRenderedDevices,
  renderDevices,
  schedulePostActionRefresh,
  postJson,
}) {
  const busyDevices = new Set();
  const feedbackByDevice = new Map();

  async function reconnect(device) {
    busyDevices.add(device.name);
    feedbackByDevice.set(device.name, {
      kind: "pending",
      text: "正在断开并立即重连该设备…",
    });
    renderDevices(getLastRenderedDevices());
    try {
      const result = await postJson(
        "/api/speaker-occupancy/reconnect",
        { name: device.name },
        "断开重连失败",
      );
      feedbackByDevice.set(device.name, {
        kind: "success",
        text: `设备已完成断开重连，用时 ${(result.durationMs / 1_000).toFixed(1)} 秒。请重新播放声音确认设备端是否恢复。`,
      });
    } catch (error) {
      feedbackByDevice.set(device.name, {
        kind: "error",
        text: `断开重连失败：${error.message}`,
      });
    } finally {
      busyDevices.delete(device.name);
      renderDevices(getLastRenderedDevices());
      schedulePostActionRefresh();
    }
  }

  function section(device) {
    const occupancy = device.speakerOccupancy;
    const users = occupancy?.users ?? [];
    const inUse = users.length > 0;
    const container = createElement("section", "speaker-occupancy-section");
    const heading = createElement("div", "speaker-occupancy-heading");
    heading.append(
      createElement("h3", "", "扬声器占用"),
      createElement(
        "span",
        inUse ? "speaker-occupancy-status is-busy" : "speaker-occupancy-status is-free",
        inUse ? "正在被应用使用" : "未被应用使用",
      ),
    );
    container.append(heading);

    if (inUse) {
      const list = createElement("div", "speaker-occupancy-users");
      for (const user of users) {
        const row = createElement("div", "speaker-occupancy-user");
        row.append(
          createElement("strong", "", user.name),
          createElement("span", "", `进程 ${user.pid} · 正在通过本设备播放声音`),
        );
        list.append(row);
      }
      container.append(list);
    } else {
      container.append(createElement(
        "p",
        "speaker-occupancy-empty",
        "没有检测到正在通过本设备播放声音的本机应用。仅设为系统默认输出不算应用级占用。",
      ));
    }

    const button = createElement(
      "button",
      "speaker-reconnect-button",
      busyDevices.has(device.name) ? "正在断开重连…" : "一键断开重连",
    );
    button.type = "button";
    button.disabled = busyDevices.has(device.name);
    button.addEventListener("click", () => reconnect(device));
    container.append(button);

    container.append(createElement(
      "p",
      "speaker-occupancy-note",
      "若当前设备处于A2DP，音频能正常播放但设备端没有声音，可以点击“一键断开重连”尝试修复",
    ));
    const feedback = feedbackByDevice.get(device.name);
    if (feedback) {
      const message = createElement(
        "p",
        `speaker-occupancy-feedback is-${feedback.kind}`,
        feedback.text,
      );
      message.setAttribute("role", "status");
      container.append(message);
    }
    return container;
  }

  return { section };
}
