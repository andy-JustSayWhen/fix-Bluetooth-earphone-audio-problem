import test from "node:test";
import assert from "node:assert/strict";

import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";
import { mergeMicrophoneOccupancy } from "./index.ts";

function device(overrides: Partial<AudioModeAssessment>): AudioModeAssessment {
  return {
    name: "REDMI",
    mode: "A2DP",
    label: "A2DP",
    confidence: "high",
    evidence: [],
    explanation: "",
    sampleRateOutput: 44_100,
    maxSupportedOutputRate: 44_100,
    outputChannels: 2,
    sampleRateInput: 16_000,
    inputChannels: 1,
    isDefaultInput: true,
    isDefaultOutput: true,
    isDefaultSystemOutput: false,
    ...overrides,
  };
}

test("占用扫描不得用旧 A2DP 状态覆盖实时 HFP 状态", () => {
  const current = device({ mode: "HFP_HSP", label: "HFP", sampleRateOutput: 16_000, outputChannels: 1 });
  const staleScan = device({
    mode: "A2DP",
    sampleRateOutput: 44_100,
    microphoneOccupancy: {
      isInUse: true,
      users: [{ pid: 42, name: "Codex", bundleId: "com.openai.codex", devices: ["REDMI"] }],
      multipointSupport: "unknown",
      multipointExplanation: "",
      remoteReleaseSupported: false,
      remoteReleaseExplanation: "",
    },
  });

  const [merged] = mergeMicrophoneOccupancy([current], [staleScan]);

  assert.equal(merged.mode, "HFP_HSP");
  assert.equal(merged.sampleRateOutput, 16_000);
  assert.equal(merged.outputChannels, 1);
  assert.equal(merged.microphoneOccupancy?.isInUse, true);
});
