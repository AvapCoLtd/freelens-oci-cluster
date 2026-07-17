import type { OciRouteTable } from "../sdk/types";

/** ゲートウェイ種別を問わない状態の共通形(sdk/fetch.fetchGatewayStatusが各getの応答から詰める)。 */
export interface OciGatewayStatusView {
  kind: string;
  displayName?: string;
  lifecycleState?: string;
  /** IGWのみ。falseだと経路表があっても外に出られない */
  isEnabled?: boolean;
  /** NAT GW / Service GWのみ。trueだと遮断中 */
  blockTraffic?: boolean;
  /** LPGのみ。PEERED以外は対向未接続 */
  peeringStatus?: string;
}

export type GatewayKind = "natgateway" | "internetgateway" | "servicegateway" | "localpeeringgateway" | "drg";

const GATEWAY_KINDS: readonly GatewayKind[] = [
  "natgateway",
  "internetgateway",
  "servicegateway",
  "localpeeringgateway",
  "drg",
];

/** OCIDの種別セグメント("ocid1.<type>.oc1...")。 */
export function ocidTypeSegment(ocid: string): string | undefined {
  return ocid.split(".")[1];
}

/** 状態取得(fetchGatewayStatus)に対応するゲートウェイ種別か。対応外(privateip等)はundefined。 */
export function gatewayKindOf(networkEntityId: string | undefined): GatewayKind | undefined {
  if (!networkEntityId) return undefined;
  const type = ocidTypeSegment(networkEntityId);
  return (GATEWAY_KINDS as readonly string[]).includes(type ?? "") ? (type as GatewayKind) : undefined;
}

export function isSupportedGatewayId(networkEntityId: string | undefined): networkEntityId is string {
  return gatewayKindOf(networkEntityId) !== undefined;
}

/** RT群のルートから状態取得対象のゲートウェイOCIDを重複なしで集める(storeの取得起点)。 */
export function gatewayIdsOfRouteTables(routeTables: OciRouteTable[]): string[] {
  const ids = new Set<string>();
  for (const rt of routeTables) {
    for (const rule of rt.routeRules ?? []) {
      if (isSupportedGatewayId(rule.networkEntityId)) ids.add(rule.networkEntityId);
    }
  }
  return [...ids];
}

export interface GatewayHealth {
  label: string;
  healthy: boolean;
}

/** ゲートウェイの生死判定。「経路表は正しいのに通らない」の原因(無効化/遮断/未接続)を表に出す。 */
export function gatewayHealth(view: OciGatewayStatusView): GatewayHealth {
  const problems: string[] = [];
  if (view.isEnabled === false) problems.push("Disabled");
  if (view.blockTraffic === true) problems.push("Blocking");
  if (view.peeringStatus && view.peeringStatus !== "PEERED") problems.push(`peering: ${view.peeringStatus}`);
  if (view.lifecycleState && view.lifecycleState !== "AVAILABLE" && view.lifecycleState !== "ATTACHED") {
    problems.push(view.lifecycleState);
  }
  if (problems.length > 0) return { label: problems.join(" / "), healthy: false };
  return { label: "Healthy", healthy: true };
}
