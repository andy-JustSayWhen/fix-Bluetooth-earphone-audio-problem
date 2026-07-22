import type {
  AudioModeAssessment,
  MicrophoneUser,
} from "../../shared/audio-device-types/index.ts";
import type { FormatRequestEvent } from "./format-request-diagnosis.ts";

export type RecoveryOutcome =
  | "无需修复"
  | "完全恢复"
  | "绕过成功"
  | "原组合复发"
  | "未恢复"
  | "等待选择"
  | "等待授权";

export type RecoveryCauseKind =
  | "麦克风占用类"
  | "链路残留类"
  | "多端点会话类"
  | "格式请求类"
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

export type RecoveryRouteChoice = {
  id: string;
  direction: "input" | "output";
  deviceName: string;
  label: string;
  preserves: "输入" | "输出";
};

export type RecoveryActionRequired =
  | {
      kind: "route-choice";
      prompt: string;
      choices: RecoveryRouteChoice[];
    }
  | {
      kind: "relaunch-authorization";
      prompt: string;
      processNames: string[];
      cause: "麦克风占用类" | "格式请求类";
      triggerState: "still-running" | "restarted";
      occupancyEvidence?: "physical-bluetooth-microphone" | "unclosed-format-request" | "mixed";
    };

export type RecoveryProgress = {
  stage: "正在保存现场" | "正在定位原因" | "正在执行处理" | "正在确认稳定";
  message: string;
};

export type RecoveryRequestContext = {
  clickedAt: string;
  defaultInput: string | null;
  defaultOutput: string | null;
  targetSampleRate: number | null;
  targetAssessment: AudioModeAssessment | null;
  deviceAssessments?: AudioModeAssessment[];
  occupancySnapshot?: {
    capturedAt: string;
    users: MicrophoneUser[];
  };
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
  initialOccupancyChecked: boolean;
  causeReviewCount: number;
  processAttempts: RecoveryProcessAttempt[];
  linkResidualAttempted: boolean;
  fallbackInputAttempted: boolean;
  reconnectAttempted: boolean;
  initialEvidenceRead: boolean;
  evidenceSinceMs: number | null;
  latestFormatRequests?: FormatRequestEvent[];
  releasedBluetoothInputPrograms: string[];
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
  occupancyEvidence?: "physical-bluetooth-microphone" | "unclosed-format-request" | "mixed";
};

export type RecoveryContinuation = {
  roundState: RecoveryRoundState;
  pendingGuards: RelaunchGuardRequest[];
};

export type RecoveryRequest = {
  name: string;
  context?: RecoveryRequestContext;
  routeChoiceId?: string;
  authorizeRelaunchBlock?: boolean;
  _confirmedRouteChoice?: {
    choice: RecoveryRouteChoice;
    diagnosis: RecoveryDiagnosis;
  };
  _roundState?: RecoveryRoundState;
  _approvedRelaunchGuards?: RelaunchGuardRequest[];
};

export type A2dpRecoveryResult = {
  ok: boolean;
  outcome: RecoveryOutcome;
  recoveryPath: "现场复核" | "原因对应处理" | "多端点路由组合" | "声音链路重建兜底";
  handledCause: boolean;
  sampleRate: number | null;
  releasedPrograms: string[];
  remainingPrograms: string[];
  guardedPrograms?: string[];
  diagnosis: RecoveryDiagnosis;
  steps: RecoveryStep[];
  usedReconnect: boolean;
  actionRequired?: RecoveryActionRequired;
  message: string;
  _continuation?: RecoveryContinuation;
};
