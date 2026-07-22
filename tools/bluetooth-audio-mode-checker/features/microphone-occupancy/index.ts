import {
  readMicrophoneUsers,
  readMicrophoneUsersAsync,
} from "../../core/macos-microphone-usage/index.ts";
import {
  readRunningProcess,
  terminateRunningProcess,
  type RunningProcess,
} from "../../core/macos-running-apps/index.ts";
import type {
  ActiveInputSnapshot,
  AudioModeAssessment,
  MicrophoneUser,
  MicrophoneOccupancy,
} from "../../shared/audio-device-types/index.ts";

function isPhysicalInputAssessment(device: AudioModeAssessment): boolean {
  if (device.inputChannels <= 0 || !device.inputTransport) return false;
  if (["virtual", "aggregate", "unknown"].includes(device.inputTransport)) return false;
  return !/audiotap|audio tap|loopback|soundflower|blackhole/i.test(device.name);
}

function isSystemAudioCapture(user: MicrophoneUser): boolean {
  return user.devices.some((name) => /audiotap|audio tap/i.test(name));
}

function assignedFormatRequestDevice(
  devices: AudioModeAssessment[],
  user: MicrophoneUser,
): string[] {
  if (!user.occupancyEvidenceKinds?.includes("unclosed-format-request")) return [];
  const requestedAt = Date.parse(user.unclosedFormatRequestAt ?? "");
  if (Number.isFinite(requestedAt)) {
    const matches = devices.filter((device) => {
      const observedAt = Date.parse(device.audioLinkTypeObservedAt ?? "");
      return device.inputChannels > 0 &&
        (device.inputTransport === "bluetooth" || device.inputTransport === "bluetooth-le") &&
        device.audioLinkType === "tsco" &&
        Number.isFinite(observedAt) &&
        Math.abs(observedAt - requestedAt) <= 2_000;
    });
    if (matches.length === 1) return [matches[0].name];
  }
  const defaultInput = devices.find((device) => device.isDefaultInput && device.inputChannels > 0);
  return defaultInput ? [defaultInput.name] : [];
}

export function classifyInputActivities(
  devices: AudioModeAssessment[],
  users: MicrophoneUser[],
): MicrophoneUser[] {
  const byName = new Map(devices.map((device) => [device.name, device] as const));
  return users.map((user) => {
    const physicalDeviceNames = [...new Set(user.devices.filter((name) => {
      const device = byName.get(name);
      return device !== undefined && isPhysicalInputAssessment(device);
    }))];
    const physicalBluetoothDeviceNames = physicalDeviceNames.filter((name) => {
      const transport = byName.get(name)?.inputTransport;
      return transport === "bluetooth" || transport === "bluetooth-le";
    });
    const confirmedDeviceNames = [...new Set([
      ...physicalBluetoothDeviceNames,
      ...assignedFormatRequestDevice(devices, user),
    ])];
    const hasUnclosedFormatRequest = user.occupancyEvidenceKinds?.includes("unclosed-format-request") ?? false;
    const inputActivityKind: MicrophoneUser["inputActivityKind"] = confirmedDeviceNames.length > 0 || hasUnclosedFormatRequest
      ? "已确认实体麦克风占用"
      : isSystemAudioCapture(user)
        ? "系统声音采集"
        : "未确认麦克风占用的输入活动";
    return {
      ...user,
      inputActivityKind,
      physicalDeviceNames,
      confirmedDeviceNames,
    };
  });
}

export function mergeMicrophoneUsers(...groups: MicrophoneUser[][]): MicrophoneUser[] {
  const byPid = new Map<number, MicrophoneUser>();
  for (const user of groups.flat()) {
    const current = byPid.get(user.pid);
    if (!current) {
      byPid.set(user.pid, user);
      continue;
    }
    byPid.set(user.pid, {
      ...current,
      ...user,
      bundleId: user.bundleId || current.bundleId,
      devices: [...new Set([...current.devices, ...user.devices])],
      physicalDeviceNames: [...new Set([
        ...(current.physicalDeviceNames ?? []),
        ...(user.physicalDeviceNames ?? []),
      ])],
      confirmedDeviceNames: [...new Set([
        ...(current.confirmedDeviceNames ?? []),
        ...(user.confirmedDeviceNames ?? []),
      ])],
      occupancyEvidenceKinds: [...new Set([
        ...(current.occupancyEvidenceKinds ?? []),
        ...(user.occupancyEvidenceKinds ?? []),
      ])],
      unclosedFormatRequestAt: user.unclosedFormatRequestAt ?? current.unclosedFormatRequestAt,
    });
  }
  return [...byPid.values()];
}

export function attachMicrophoneOccupancy(devices: AudioModeAssessment[]): AudioModeAssessment[] {
  const users = readMicrophoneUsers();
  return attachOccupancy(devices, users);
}

export async function attachMicrophoneOccupancyAsync(
  devices: AudioModeAssessment[],
): Promise<AudioModeAssessment[]> {
  return attachOccupancy(devices, await readAllMicrophoneUsersAsync());
}

export function readAllMicrophoneUsersAsync() {
  return readMicrophoneUsersAsync();
}

export function attachMicrophoneOccupancyFromUsers(
  devices: AudioModeAssessment[],
  users: ReturnType<typeof readMicrophoneUsers>,
): AudioModeAssessment[] {
  return attachOccupancy(devices, users);
}

export function attachEmptyMicrophoneOccupancy(
  devices: AudioModeAssessment[],
): AudioModeAssessment[] {
  return attachOccupancy(devices, []);
}

export function shouldContinueOccupancyScanning(
  devices: AudioModeAssessment[],
  allUsers: ReturnType<typeof readMicrophoneUsers> = [],
): boolean {
  return allUsers.length > 0 || devices.some((device) => (device.microphoneOccupancy?.users.length ?? 0) > 0);
}

export function shouldStartOccupancyScanForInputActivity(
  previous: ActiveInputSnapshot | null,
  current: ActiveInputSnapshot,
): boolean {
  if (!current.isRunning || current.name === null) return false;
  return previous === null || !previous.isRunning || previous.name !== current.name;
}

export function mergeMicrophoneOccupancy(
  currentDevices: AudioModeAssessment[],
  occupancySnapshot: AudioModeAssessment[],
): AudioModeAssessment[] {
  const occupancyByName = new Map(
    occupancySnapshot
      .filter((device) => device.microphoneOccupancy !== undefined)
      .map((device) => [device.name, device.microphoneOccupancy] as const),
  );
  return currentDevices.map((device) => {
    const microphoneOccupancy = occupancyByName.get(device.name);
    return microphoneOccupancy === undefined ? device : { ...device, microphoneOccupancy };
  });
}

function attachOccupancy(
  devices: AudioModeAssessment[],
  users: ReturnType<typeof readMicrophoneUsers>,
): AudioModeAssessment[] {
  const activities = classifyInputActivities(devices, users);
  return devices.map((device) => {
    const matchingUsers = activities.filter((user) =>
      user.inputActivityKind === "已确认实体麦克风占用" &&
      user.confirmedDeviceNames?.includes(device.name)
    );
    const microphoneOccupancy: MicrophoneOccupancy = {
      isInUse: matchingUsers.length > 0,
      users: matchingUsers,
      multipointSupport: "unknown",
      multipointExplanation: "macOS 未提供可靠的双设备连接能力字段，蓝牙服务列表也不足以证明是否支持。",
      remoteReleaseSupported: false,
      remoteReleaseExplanation: "本工具只能解除本机程序的占用；其他手机或电脑上的占用需要在对应设备上关闭麦克风、通话或断开蓝牙。",
    };
    return { ...device, microphoneOccupancy };
  });
}

export type MicrophoneReleaseResult = {
  requestedPids: number[];
  releasedPids: number[];
  remainingPids: number[];
};

export type ConfirmedMicrophoneReleaseResult = MicrophoneReleaseResult & {
  users: MicrophoneUser[];
  processes: RunningProcess[];
};

export type MicrophoneReleaseRuntime = {
  now?: () => number;
  readProcess: (pid: number) => RunningProcess | null;
  terminateProcess: (processInfo: RunningProcess) => void;
  wait: (milliseconds: number) => Promise<void>;
};

const systemReleaseRuntime: MicrophoneReleaseRuntime = {
  now: Date.now,
  readProcess: readRunningProcess,
  terminateProcess: terminateRunningProcess,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function isConfirmedReleaseUser(user: MicrophoneUser): boolean {
  return user.inputActivityKind === "已确认实体麦克风占用" && (
    (user.confirmedDeviceNames?.length ?? 0) > 0 ||
    (user.occupancyEvidenceKinds?.includes("unclosed-format-request") ?? false)
  );
}

async function releaseMicrophoneUsersDetailed(
  users: MicrophoneUser[],
  pids: number[],
  runtime: MicrophoneReleaseRuntime,
): Promise<ConfirmedMicrophoneReleaseResult> {
  const confirmedPids = new Set(users.filter(isConfirmedReleaseUser).map((user) => user.pid));
  const expectedProcesses = new Map<number, RunningProcess>();
  for (const pid of [...new Set(pids)]) {
    if (!confirmedPids.has(pid)) continue;
    const processInfo = runtime.readProcess(pid);
    if (processInfo) expectedProcesses.set(pid, processInfo);
  }
  const processes = [...expectedProcesses.values()];
  const requestedPids = [...expectedProcesses.keys()];
  for (const processInfo of processes) runtime.terminateProcess(processInfo);

  let remainingPids = requestedPids;
  const now = runtime.now ?? Date.now;
  const deadline = now() + 2_000;
  for (let attempt = 0; attempt < 20 && remainingPids.length > 0; attempt += 1) {
    const remainingTime = deadline - now();
    if (remainingTime <= 0) break;
    await runtime.wait(Math.min(100, remainingTime));
    remainingPids = requestedPids.filter((pid) => {
      const expected = expectedProcesses.get(pid);
      const current = runtime.readProcess(pid);
      return expected !== undefined && current !== null &&
        current.startedAt === expected.startedAt && current.command === expected.command;
    });
  }
  return {
    users: users.filter((user) => requestedPids.includes(user.pid)),
    processes,
    requestedPids,
    releasedPids: requestedPids.filter((pid) => !remainingPids.includes(pid)),
    remainingPids,
  };
}

export async function confirmAndReleaseMicrophoneOccupancy(
  devices: AudioModeAssessment[],
  users: MicrophoneUser[],
  deviceName: string,
  requestedPids: number[] | null,
  evidenceScope: "全部已确认占用" | "实体端点占用",
  runtime: MicrophoneReleaseRuntime = systemReleaseRuntime,
): Promise<ConfirmedMicrophoneReleaseResult> {
  const activities = classifyInputActivities(devices, users);
  const confirmedUsers = activities.filter((user) =>
    user.inputActivityKind === "已确认实体麦克风占用" &&
    user.confirmedDeviceNames?.includes(deviceName) &&
    (evidenceScope === "全部已确认占用" || user.physicalDeviceNames?.includes(deviceName))
  );
  const confirmedPids = new Set(confirmedUsers.map((user) => user.pid));
  const selectedPids = requestedPids === null ? [...confirmedPids] : [...new Set(requestedPids)];
  if (selectedPids.some((pid) => !confirmedPids.has(pid))) {
    throw new Error("当前没有仍有效且已确认的占用或格式请求，未结束任何进程");
  }
  return releaseMicrophoneUsersDetailed(confirmedUsers, selectedPids, runtime);
}

export async function releaseMicrophoneUsers(
  users: MicrophoneUser[],
  pids: number[],
  runtime: MicrophoneReleaseRuntime = systemReleaseRuntime,
): Promise<MicrophoneReleaseResult> {
  const result = await releaseMicrophoneUsersDetailed(users, pids, runtime);
  return {
    requestedPids: result.requestedPids,
    releasedPids: result.releasedPids,
    remainingPids: result.remainingPids,
  };
}
