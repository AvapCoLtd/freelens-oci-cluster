import type { OciWafPolicy } from "../oci/types";

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
  "action-name"?: string;
  condition?: string | null;
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
      action: actionLabel(policy, rule["action-name"]),
      detail: detail ?? rule.condition ?? "-",
    });
  };

  for (const rule of policy["request-access-control"]?.rules ?? []) push("Request Control", rule);
  for (const rule of policy["request-rate-limiting"]?.rules ?? []) {
    const limits = (rule.configurations ?? [])
      .map(
        (config) =>
          `${config["requests-limit"]}req/${config["period-in-seconds"]}s` +
          (config["action-duration-in-seconds"] ? ` (block ${config["action-duration-in-seconds"]}s)` : ""),
      )
      .join(", ");
    push("Rate Limiting", rule, [rule.condition, limits].filter(Boolean).join(" / ") || "-");
  }
  for (const rule of policy["request-protection"]?.rules ?? []) {
    const capabilities = (rule["protection-capabilities"] ?? []).map((cap) => cap.key).join(", ");
    push("Request Protection", rule, [rule.condition, capabilities].filter(Boolean).join(" / ") || "-");
  }
  for (const rule of policy["response-access-control"]?.rules ?? []) push("Response Control", rule);
  for (const rule of policy["response-protection"]?.rules ?? []) {
    const capabilities = (rule["protection-capabilities"] ?? []).map((cap) => cap.key).join(", ");
    push("Response Protection", rule, [rule.condition, capabilities].filter(Boolean).join(" / ") || "-");
  }
  return rows;
}

/** 既定アクション(どのルールにも一致しないリクエストの扱い)。ブロック調査の起点。 */
export function wafDefaultAction(policy: OciWafPolicy): string {
  return actionLabel(policy, policy["request-access-control"]?.["default-action-name"]);
}
