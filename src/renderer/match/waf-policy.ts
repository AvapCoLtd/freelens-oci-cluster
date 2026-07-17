import type { OciWafPolicy } from "../sdk/types";

export interface WafRuleRow {
  /** どの検査段階のルールか(リクエスト制御/レート制限/リクエスト保護/レスポンス制御/レスポンス保護) */
  module: string;
  name: string;
  /** アクション名(ポリシーのactions定義がある場合は「名前 (種別)」) */
  action: string;
  /** 条件(JMESPath)またはルール内容の要約 */
  detail: string;
}

interface RuleLike {
  name: string;
  actionName: string;
  condition?: string;
}

function actionLabel(policy: OciWafPolicy, actionName: string | undefined): string {
  if (!actionName) return "-";
  const type = (policy.actions ?? []).find((action) => action.name === actionName)?.type;
  return type ? `${actionName} (${type})` : actionName;
}

/**
 * WAFポリシーの全モジュールのルールを表示行に平坦化する。
 * 「なぜ繋がらないか」の調査対象は主にアクセス制御ルールのcondition(JMESPath)と保護ルールの有効capability。
 */
export function wafPolicyRuleRows(policy: OciWafPolicy): WafRuleRow[] {
  const rows: WafRuleRow[] = [];
  const push = (module: string, rule: RuleLike, detail?: string) => {
    rows.push({
      module,
      name: rule.name,
      action: actionLabel(policy, rule.actionName),
      detail: detail ?? rule.condition ?? "-",
    });
  };

  for (const rule of policy.requestAccessControl?.rules ?? []) push("リクエスト制御", rule);
  for (const rule of policy.requestRateLimiting?.rules ?? []) {
    const limits = (rule.configurations ?? [])
      .map(
        (config) =>
          `${config.requestsLimit}req/${config.periodInSeconds}s` +
          (config.actionDurationInSeconds ? ` (block ${config.actionDurationInSeconds}s)` : ""),
      )
      .join(", ");
    push("レート制限", rule, [rule.condition, limits].filter(Boolean).join(" / ") || "-");
  }
  for (const rule of policy.requestProtection?.rules ?? []) {
    const capabilities = (rule.protectionCapabilities ?? []).map((cap) => cap.key).join(", ");
    push("リクエスト保護", rule, [rule.condition, capabilities].filter(Boolean).join(" / ") || "-");
  }
  for (const rule of policy.responseAccessControl?.rules ?? []) push("レスポンス制御", rule);
  for (const rule of policy.responseProtection?.rules ?? []) {
    const capabilities = (rule.protectionCapabilities ?? []).map((cap) => cap.key).join(", ");
    push("レスポンス保護", rule, [rule.condition, capabilities].filter(Boolean).join(" / ") || "-");
  }
  return rows;
}

/** 既定アクション(どのルールにも一致しないリクエストの扱い)。ブロック調査の起点。 */
export function wafDefaultAction(policy: OciWafPolicy): string {
  return actionLabel(policy, policy.requestAccessControl?.defaultActionName);
}
