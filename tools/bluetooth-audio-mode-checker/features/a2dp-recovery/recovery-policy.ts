export type RecoveryPolicy =
  | "执行原因对应方法"
  | "直接进入最后兜底"
  | "按方法清单逐项尝试";

export function selectRecoveryPolicy(
  confirmedCauseMatched: boolean,
  confirmedMethodAvailable: boolean,
): RecoveryPolicy {
  if (!confirmedCauseMatched) return "按方法清单逐项尝试";
  return confirmedMethodAvailable ? "执行原因对应方法" : "直接进入最后兜底";
}
