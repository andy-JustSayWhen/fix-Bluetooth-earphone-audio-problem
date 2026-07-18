export type RecoveryPolicy =
  | "执行原因对应处理"
  | "停止，不执行处理";

export function selectRecoveryPolicy(confirmedCauseMatched: boolean): RecoveryPolicy {
  return confirmedCauseMatched ? "执行原因对应处理" : "停止，不执行处理";
}
