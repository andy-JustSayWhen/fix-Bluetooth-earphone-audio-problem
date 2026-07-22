import { readMicrophoneUsersAsync } from "../core/macos-microphone-usage/index.ts";
import {
  confirmAndReleaseMicrophoneOccupancy,
  mergeMicrophoneUsers,
  type ConfirmedMicrophoneReleaseResult,
  type MicrophoneReleaseRuntime,
} from "../features/microphone-occupancy/index.ts";
import type { AudioModeAssessment, MicrophoneUser } from "../shared/audio-device-types/index.ts";

export type CurrentMicrophoneReleaseResult = {
  physicalUsers: MicrophoneUser[];
  release: ConfirmedMicrophoneReleaseResult;
};

export async function releaseCurrentMicrophoneOccupancy(options: {
  devices: AudioModeAssessment[];
  formatRequestUsers: MicrophoneUser[];
  deviceName: string;
  requestedPids: number[] | null;
  evidenceScope: "全部已确认占用" | "实体端点占用";
  readPhysicalUsers?: () => Promise<MicrophoneUser[]>;
  releaseRuntime?: MicrophoneReleaseRuntime;
}): Promise<CurrentMicrophoneReleaseResult> {
  const physicalUsers = await (options.readPhysicalUsers ?? readMicrophoneUsersAsync)();
  const users = mergeMicrophoneUsers(physicalUsers, options.formatRequestUsers);
  const release = await confirmAndReleaseMicrophoneOccupancy(
    options.devices,
    users,
    options.deviceName,
    options.requestedPids,
    options.evidenceScope,
    options.releaseRuntime,
  );
  return { physicalUsers, release };
}
