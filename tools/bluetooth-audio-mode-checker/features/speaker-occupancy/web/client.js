export function createSpeakerOccupancyController({ createElement }) {
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
        inUse ? "正在被应用使用" : device.windowsEvidence && (!device.windowsEvidence.sessionsKnown || device.windowsEvidence.activeOutput) ? "占用归属无法确认" : "未被应用使用",
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
    return container;
  }

  return { section };
}
