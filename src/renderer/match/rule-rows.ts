import type { OciNsgRule, OciPortOptions, OciRouteTable, OciSecurityList } from "../oci/types";
import { routeEntityKind } from "./network-path";

export interface RuleRow {
  direction: "ingress" | "egress";
  protocol: string;
  /** ingressならsource、egressならdestination */
  peer: string;
  ports: string;
  stateless: boolean;
  description?: string;
}

export interface RouteRow {
  destination: string;
  entityKind: string;
  entityId?: string;
  description?: string;
}

// IPプロトコル番号は膨大にあるが、SL/NSGルールで実用上現れるものだけ名前にする。
const PROTOCOL_LABELS: Record<string, string> = {
  all: "all",
  "1": "ICMP",
  "6": "TCP",
  "17": "UDP",
  "58": "ICMPv6",
};

export function protocolLabel(protocol: string | undefined): string {
  if (!protocol) return "-";
  return PROTOCOL_LABELS[protocol] ?? protocol;
}

function portsLabel(tcpOptions?: OciPortOptions | null, udpOptions?: OciPortOptions | null): string {
  const range = tcpOptions?.["destination-port-range"] ?? udpOptions?.["destination-port-range"];
  if (!range || range.min === undefined) return "-";
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
}

/** SLの ingress/egress ルールを表示行に平坦化する(取得済みSL get応答にルールは含まれている)。 */
export function securityListRuleRows(sl: OciSecurityList): RuleRow[] {
  const ingress: RuleRow[] = (sl["ingress-security-rules"] ?? []).map((rule) => ({
    direction: "ingress",
    protocol: protocolLabel(rule.protocol),
    peer: rule.source ?? "-",
    ports: portsLabel(rule["tcp-options"], rule["udp-options"]),
    stateless: rule["is-stateless"] ?? false,
    description: rule.description ?? undefined,
  }));
  const egress: RuleRow[] = (sl["egress-security-rules"] ?? []).map((rule) => ({
    direction: "egress",
    protocol: protocolLabel(rule.protocol),
    peer: rule.destination ?? "-",
    ports: portsLabel(rule["tcp-options"], rule["udp-options"]),
    stateless: rule["is-stateless"] ?? false,
    description: rule.description ?? undefined,
  }));
  return [...ingress, ...egress];
}

export function nsgRuleRows(rules: OciNsgRule[]): RuleRow[] {
  return rules.map((rule) => ({
    direction: rule.direction === "EGRESS" ? "egress" : "ingress",
    protocol: protocolLabel(rule.protocol),
    peer: (rule.direction === "EGRESS" ? rule.destination : rule.source) ?? "-",
    ports: portsLabel(rule["tcp-options"], rule["udp-options"]),
    stateless: rule["is-stateless"] ?? false,
    description: rule.description ?? undefined,
  }));
}

export function routeRows(rt: OciRouteTable): RouteRow[] {
  return (rt["route-rules"] ?? []).map((rule) => ({
    destination: rule.destination ?? rule["cidr-block"] ?? "-",
    entityKind: routeEntityKind(rule["network-entity-id"]),
    entityId: rule["network-entity-id"],
    description: rule.description ?? undefined,
  }));
}
