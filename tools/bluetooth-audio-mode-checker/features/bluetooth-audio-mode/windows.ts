import type {
  AudioModeAssessment,
  WindowsA2dpStreamEvidence,
} from "../../shared/audio-device-types/index.ts";

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

const a2dpCodecNames: Record<number, string> = {0: "SBC", 1: "MPEG-1,2 音频", 2: "AAC", 3: "ATRAC"};

export function describeNegotiatedA2dpStream(stream: WindowsA2dpStreamEvidence | null | undefined, voiceLinkActive = false): string {
  // The voice link is the active radio path during HFP; stale A2DP notes only confuse here.
  if (voiceLinkActive) return "语音链路传输中（编码尚未取得）";
  if (!stream || (stream.negotiatedAt === null && !stream.streaming)) return "尚未取得";
  const parts: string[] = [];
  if (stream.codec !== null) {
    parts.push(stream.codec === 4
      ? (stream.vendorId ? `厂商编码 0x${stream.vendorId.toString(16).toUpperCase().padStart(8, "0")}` : "厂商自定义编码")
      : a2dpCodecNames[stream.codec] ?? `编码 ${stream.codec}`);
  }
  if (stream.sampleRate) parts.push(`${stream.sampleRate / 1000} kHz`);
  if (stream.channels) parts.push(stream.channels === 1 ? "单声道" : `${stream.channels} 声道`);
  const description = parts.join(" · ");
  return stream.streaming
    ? (description || "传输中（协商参数尚未取得）")
    : `未在传输${description ? `，最近协商 ${description}` : ""}`;
}
