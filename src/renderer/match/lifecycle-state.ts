const NORMAL_LIFECYCLE_STATES = new Set(["AVAILABLE", "RUNNING", "ACTIVE"]);

/** OCIリソースのlifecycle-stateがAVAILABLE/RUNNING/ACTIVE以外の異常値かどうかを判定する(設計: 表示フィールド)。 */
export function isAbnormalLifecycleState(state: string | undefined): boolean {
  return state !== undefined && !NORMAL_LIFECYCLE_STATES.has(state);
}
