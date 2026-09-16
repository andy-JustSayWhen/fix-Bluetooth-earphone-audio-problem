import { readMicrophoneUsersAsync } from "../features/microphone-occupancy/index.ts";
import {
  confirmAndReleaseMicrophoneOccupancy,
  mergeMicrophoneUsers,
  type ConfirmedMicrophoneReleaseResult,
  type MicrophoneReleaseEvidenceScope,
  type MicrophoneReleaseRuntime,
} from "../features/microphone-occupancy/index.ts";
import type { AudioModeAssessment, MicrophoneUser } from "../shared/audio-device-types/index.ts";

export type CurrentMicrophoneReleaseResult = {
  physicalUsers: MicrophoneUser[];
  release: ConfirmedMicrophoneReleaseResult & {
    restartedProcesses: Array<{
      name: string;
      previousPid: number;
      currentPid: number;
    }>;
  };
};

function sameProcessName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export async function releaseCurrentMicrophoneOccupancy(options: {
  devices: AudioModeAssessment[];
  formatRequestUsers: MicrophoneUser[];
  deviceName: string;
  requestedPids: number[] | null;
  evidenceScope: MicrophoneReleaseEvidenceScope;
  readPhysicalUsers?: () => Promise<MicrophoneUser[]>;
  releaseRuntime?: MicrophoneReleaseRuntime;
}): Promise<CurrentMicrophoneReleaseResult> {
  const readPhysicalUsers = options.readPhysicalUsers ?? readMicrophoneUsersAsync;
  const physicalUsersBeforeRelease = await readPhysicalUsers();
  const users = mergeMicrophoneUsers(physicalUsersBeforeRelease, options.formatRequestUsers);
  const release = await confirmAndReleaseMicrophoneOccupancy(
    options.devices,
    users,
    options.deviceName,
    options.requestedPids,
    options.evidenceScope,
    options.releaseRuntime,
  );
  let physicalUsers = physicalUsersBeforeRelease;
  let restartedProcesses: CurrentMicrophoneReleaseResult["release"]["restartedProcesses"] = [];
  if (release.releasedPids.length > 0) {
    const wait = options.releaseRuntime?.wait ?? ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    await wait(500);
    physicalUsers = await readPhysicalUsers();
    const previousPids = new Set(physicalUsersBeforeRelease.map((user) => user.pid));
    const releasedUsers = release.users.filter((user) => release.releasedPids.includes(user.pid));
    restartedProcesses = physicalUsers.flatMap((currentUser) => {
      if (previousPids.has(currentUser.pid) || !currentUser.devices.includes(options.deviceName)) return [];
      const previousUser = releasedUsers.find((user) => sameProcessName(user.name, currentUser.name));
      return previousUser ? [{
        name: currentUser.name,
        previousPid: previousUser.pid,
        currentPid: currentUser.pid,
      }] : [];
    });
  }
  return { physicalUsers, release: {...release, restartedProcesses} };
}
