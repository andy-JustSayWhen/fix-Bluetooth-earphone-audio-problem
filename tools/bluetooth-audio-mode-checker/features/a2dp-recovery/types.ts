import type { AudioModeAssessment, MicrophoneUser } from "../../shared/audio-device-types/index.ts";
import type { FormatRequestEvent } from "./format-request-diagnosis.ts";

export type RecoveryOutcome = "无需修复" | "完全恢复" | "未恢复" | "等待授权";

export type RecoveryCauseKind =
  | "麦克风占用类"
  | "格式请求类"
  | "多端点会话类"
  | "声音链路类"
  | "证据不足";

export type RecoveryStep = {
  stage: string;
  status: "成功" | "失败" | "跳过";
  detail: string;
  sampleRate?: number | null;
};

export type RecoveryDiagnosis = {
  kind: RecoveryCauseKind;
  confidence: "已确认" | "高度疑似" | "无法确认";
  summary: string;
  evidence: string[];
};

export type RecoveryActionRequired = {
  kind: "relaunch-authorization";
  prompt: string;
  processNames: string[];
  cause: "麦克风占用类" | "格式请求类";
  triggerState: "still-running" | "restarted";
  occupancyEvidence?: "physical-bluetooth-microphone" | "unclosed-format-request";
};

export type RecoveryProgress = {
  stage: "正在保存现场" | "正在检查占用" | "正在切换声音设备" | "正在重建声音链路" | "正在确认稳定";
  message: string;
};

export type RecoveryRequestContext = {
  clickedAt: string;
  defaultInput: string | null;
  defaultOutput: string | null;
  targetSampleRate: number | null;
  targetAssessment: AudioModeAssessment | null;
  deviceAssessments?: AudioModeAssessment[];
  occupancySnapshot?: { capturedAt: string; users: MicrophoneUser[] };
};

export type RecoveryProcessAttempt = {
  cause: "麦克风占用类" | "格式请求类";
  command: string;
  processName: string;
  microphoneDeviceName?: string;
  automaticProcessPid?: number;
  automaticProcessStartedAt?: string;
  automaticAttempted: boolean;
  automaticExitConfirmed?: boolean;
  authorizedAttempted: boolean;
};

export type RecoveryRoundState = {
  context: RecoveryRequestContext;
  nextStep: 1 | 2 | 3 | 4 | 5 | 6;
  processAttempts: RecoveryProcessAttempt[];
  latestFormatRequests?: FormatRequestEvent[];
  releasedPrograms: string[];
  remainingPrograms: string[];
  guardedPrograms: string[];
  steps: RecoveryStep[];
};

export type RelaunchGuardRequest = {
  cause: "麦克风占用类" | "格式请求类";
  command: string;
  processName: string;
  microphoneDeviceName?: string;
  occupancyEvidence?: "physical-bluetooth-microphone" | "unclosed-format-request";
};

export type RecoveryContinuation = {
  roundState: RecoveryRoundState;
  pendingGuards: RelaunchGuardRequest[];
};

export type RecoveryRequest = {
  name: string;
  context?: RecoveryRequestContext;
  authorizeRelaunchBlock?: boolean;
  _roundState?: RecoveryRoundState;
  _approvedRelaunchGuards?: RelaunchGuardRequest[];
};

export type A2dpRecoveryResult = {
  ok: boolean;
  outcome: RecoveryOutcome;
  recoveryPath: "现场复核" | "固定处理顺序";
  handledCause: boolean;
  sampleRate: number | null;
  releasedPrograms: string[];
  remainingPrograms: string[];
  guardedPrograms?: string[];
  diagnosis: RecoveryDiagnosis;
  steps: RecoveryStep[];
  rebuiltAudioChain: boolean;
  actionRequired?: RecoveryActionRequired;
  message: string;
  _continuation?: RecoveryContinuation;
};
