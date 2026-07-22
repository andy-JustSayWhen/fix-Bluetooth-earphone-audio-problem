import assert from "node:assert/strict";
import test from "node:test";

import {
  composeMicrophoneOccupancyState,
  composeSpeakerOccupancyState,
} from "./state-composition.ts";
import type { AudioModeAssessment, AudioModeState } from "../shared/audio-device-types/index.ts";

function assessment(): AudioModeAssessment {
  return {
    name: "REDMI",
    mode: "HFP_HSP",
    a2dpSupport: "SUPPORTED",
    label: "HFP",
    confidence: "高",
    evidence: [],
    explanation: "",
    isActive: true,
    isInputActive: true,
    inputTransport: "bluetooth",
    bluetoothAddress: "50-C0-F0-F3-6A-66",
    audioLinkType: "tsco",
    audioLinkTypeObservedAt: "2026-07-22T12:00:00.000Z",
    sampleRateOutput: 16_000,
    availableSampleRateRangesOutput: [{ minimum: 16_000, maximum: 44_100 }],
    nominalSampleRateOutput: 16_000,
    actualSampleRateOutput: 16_000,
    maxSupportedOutputRate: 44_100,
    outputChannels: 1,
    sampleRateInput: 16_000,
    availableSampleRateRangesInput: [{ minimum: 16_000, maximum: 16_000 }],
    nominalSampleRateInput: 16_000,
    actualSampleRateInput: 16_000,
    inputChannels: 1,
    isDefaultInput: true,
    isDefaultOutput: true,
    isDefaultSystemOutput: false,
  };
}

test("重新组合占用时保留当前模式和采样率事实", () => {
  const current = assessment();
  const source: AudioModeState = { devices: [current], routes: { input: [], output: [] } };
  const composed = composeMicrophoneOccupancyState(source, [
    { pid: 42, name: "Codex", bundleId: "com.openai.codex", devices: ["REDMI"] },
  ]);

  assert.equal(composed.state.devices[0].mode, "HFP_HSP");
  assert.equal(composed.state.devices[0].actualSampleRateOutput, 16_000);
  assert.equal(composed.state.devices[0].microphoneOccupancy?.isInUse, true);
  assert.equal(composed.classifiedUsers[0].confirmedDeviceNames?.[0], "REDMI");
});

test("重新组合扬声器占用时也保留当前模式和链路事实", () => {
  const current = assessment();
  const source: AudioModeState = { devices: [current], routes: { input: [], output: [] } };
  const composed = composeSpeakerOccupancyState(source, [{
    sessionId: "session-1",
    pid: process.pid,
    name: "音乐应用",
    deviceUid: "50C0F0F36A66:output",
    bluetoothAddress: "50C0F0F36A66",
    observedAt: new Date().toISOString(),
  }]);

  assert.equal(composed.devices[0].mode, "HFP_HSP");
  assert.equal(composed.devices[0].audioLinkType, "tsco");
  assert.equal(composed.devices[0].speakerOccupancy?.isInUse, true);
});
