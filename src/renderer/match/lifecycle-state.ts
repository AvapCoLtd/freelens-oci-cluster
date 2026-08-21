const NORMAL_LIFECYCLE_STATES = new Set(["AVAILABLE", "RUNNING", "ACTIVE"]);

/** OCIリソースのlifecycle-stateがAVAILABLE/RUNNING/ACTIVE以外の異常値かどうかを判定する。 */
export function isAbnormalLifecycleState(state: string | undefined): boolean {
  return state !== undefined && !NORMAL_LIFECYCLE_STATES.has(state);
}

/** attachment(VNIC / Volume)のlifecycle-stateが現在の接続を表すか。欠落は判定材料が無いので採用側に倒す。 */
export function isAttachedState(state: string | undefined): boolean {
  return state === undefined || state === "ATTACHED";
}
