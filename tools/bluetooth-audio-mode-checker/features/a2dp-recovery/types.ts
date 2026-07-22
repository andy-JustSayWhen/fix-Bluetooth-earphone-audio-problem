export type RecoveryOutcome = "无需修复" | "完全恢复" | "未恢复";

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
};

export type RecoveryDiagnosis = {
  kind: RecoveryCauseKind;
  confidence: "已确认" | "高度疑似" | "无法确认";
  summary: string;
  evidence: string[];
};

export type RecoveryProgress = {
  stage: "正在检查占用" | "正在切换声音设备" | "正在重建声音链路" | "正在确认稳定";
  message: string;
};

export type RecoveryRequestContext = {
  clickedAt: string;
};

export type RecoveryRequest = {
  name: string;
  context?: RecoveryRequestContext;
};

export type A2dpRecoveryResult = {
  ok: boolean;
  outcome: RecoveryOutcome;
  recoveryPath: "现场复核" | "固定处理顺序";
  handledCause: boolean;
  sampleRate: number | null;
  releasedPrograms: string[];
  remainingPrograms: string[];
  diagnosis: RecoveryDiagnosis;
  steps: RecoveryStep[];
  rebuiltAudioChain: boolean;
  message: string;
};
