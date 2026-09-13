import type { AudioModeAssessment } from "../../shared/audio-device-types/index.ts";

export function assessWindowsFacts(base: Omit<AudioModeAssessment, "mode" | "a2dpSupport" | "label" | "confidence" | "evidence" | "explanation">): AudioModeAssessment {
  const facts = base.windowsEvidence!;
  const classic = facts.transport === "bluetooth";
  const handsfree = classic && (facts.activeCapture || facts.activeHandsfreeOutput);
  const stereo = classic && facts.sessionsKnown && facts.splitStereoActive === true && !handsfree;
  return {
    ...base,
    isActive: facts.activeOutput || facts.activeCapture || base.isDefaultOutput,
    isInputActive: facts.activeCapture,
    a2dpSupport: stereo ? "SUPPORTED" : "UNKNOWN",
    mode: handsfree ? "HFP_HSP" : stereo ? "A2DP" : "UNKNOWN",
    label: handsfree ? "HFP等模式（低音质语音模式）" : stereo ? "A2DP 高音质模式" : "无法确认当前蓝牙模式",
    confidence: handsfree || stereo ? "高" : "低",
    actualSampleRateOutput: null,
    actualSampleRateInput: null,
    availableSampleRateRangesOutput: [],
    maxSupportedOutputRate: null,
    evidence: [
      `Windows 共享混音采样率：${facts.mixRate ?? "无法读取"}（不是无线传输采样率）`,
      `目标输入活动会话：${facts.activeCapture ? "有" : facts.sessionsKnown ? "未发现" : "无法读取"}`,
      `独立免提输出活动会话：${facts.activeHandsfreeOutput ? "有" : "未发现"}`,
      `声音会话读取：${facts.sessionsKnown ? "成功" : "部分端点无法读取"}`,
    ],
    explanation: handsfree
      ? "系统在该传统蓝牙设备的麦克风或独立免提输出端点上报告了活动会话，符合 Windows 通话模式选择条件。"
      : stereo ? "系统在独立立体声端点报告活动输出会话，独立免提输出与麦克风没有活动会话。"
      : facts.transport === "bluetooth-le"
        ? "这是低功耗蓝牙设备，传统蓝牙的通话与高音质规则不适用。"
        : "Windows 可自动转换混音采样率。当前证据无法排除通信类别播放，不能只凭混音格式确认高音质模式。",
  };
}
