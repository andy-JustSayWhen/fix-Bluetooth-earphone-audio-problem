import {
  attachMicrophoneOccupancyFromUsers,
  classifyInputActivities,
} from "../features/microphone-occupancy/index.ts";
import { attachSpeakerOccupancy } from "../features/speaker-occupancy/index.ts";
import type {
  AudioModeState,
  MicrophoneUser,
  SpeakerOutputUser,
} from "../shared/audio-device-types/index.ts";

export function composeMicrophoneOccupancyState(
  state: AudioModeState,
  users: MicrophoneUser[],
): { state: AudioModeState; classifiedUsers: MicrophoneUser[] } {
  const devices = attachMicrophoneOccupancyFromUsers(state.devices, users);
  return {
    state: { ...state, devices },
    classifiedUsers: classifyInputActivities(devices, users),
  };
}

export function composeSpeakerOccupancyState(
  state: AudioModeState,
  users: SpeakerOutputUser[],
): AudioModeState {
  return { ...state, devices: attachSpeakerOccupancy(state.devices, users) };
}
