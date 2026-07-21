import {
  readMicrophoneUsers,
  readMicrophoneUsersAsync,
  releaseMicrophoneUser,
} from "../../core/macos-microphone-usage/index.ts";
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
    const confirmedDeviceNames = physicalDeviceNames.filter((name) => {
      const transport = byName.get(name)?.inputTransport;
      return transport === "bluetooth" || transport === "bluetooth-le";
    });
    const inputActivityKind: MicrophoneUser["inputActivityKind"] = confirmedDeviceNames.length > 0
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

export async function releaseMicrophoneUsers(pids: number[]): Promise<MicrophoneReleaseResult> {
  const activePids = new Set(readMicrophoneUsers().map((user) => user.pid));
  const requestedPids = [...new Set(pids)].filter((pid) => activePids.has(pid));
  for (const pid of requestedPids) {
    if (!activePids.has(pid)) continue;
    releaseMicrophoneUser(pid);
  }
  let remainingPids = requestedPids;
  for (let attempt = 0; attempt < 15 && remainingPids.length > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stillUsingInput = new Set(readMicrophoneUsers().map((user) => user.pid));
    remainingPids = requestedPids.filter((pid) => stillUsingInput.has(pid));
  }
  return {
    requestedPids,
    releasedPids: requestedPids.filter((pid) => !remainingPids.includes(pid)),
    remainingPids,
  };
}
