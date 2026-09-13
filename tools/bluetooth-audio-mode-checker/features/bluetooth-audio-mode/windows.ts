import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";

type AssessmentFacts = Omit<AudioModeAssessment, "mode" | "a2dpSupport" | "label" | "confidence" | "evidence" | "explanation">;

// Platform metadata describes activity, not the device's current audio mode.
// The caller applies the shared output/link rules to the preserved facts.
export function prepareWindowsFacts(base: AssessmentFacts): AssessmentFacts {
  const facts = base.windowsEvidence!;
  return {
    ...base,
    isActive: facts.activeOutput || facts.activeCapture || base.isDefaultOutput,
    isInputActive: facts.activeCapture,
  };
}
