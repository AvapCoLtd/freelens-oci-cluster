import type { OciNsgRule, OciRouteTable, OciSecurityList } from "../sdk/types";
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

interface PortRangeLike {
  min?: number;
  max?: number;
}

interface PortOptionsLike {
  destinationPortRange?: PortRangeLike;
  sourcePortRange?: PortRangeLike;
}

function portsLabel(tcpOptions?: PortOptionsLike, udpOptions?: PortOptionsLike): string {
  const range = tcpOptions?.destinationPortRange ?? udpOptions?.destinationPortRange;
  if (!range || range.min === undefined) return "-";
  return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
}

/** SLの ingress/egress ルールを表示行に平坦化する(取得済みSL get応答にルールは含まれている)。 */
export function securityListRuleRows(sl: OciSecurityList): RuleRow[] {
  const ingress: RuleRow[] = (sl.ingressSecurityRules ?? []).map((rule) => ({
    direction: "ingress",
    protocol: protocolLabel(rule.protocol),
    peer: rule.source ?? "-",
    ports: portsLabel(rule.tcpOptions, rule.udpOptions),
    stateless: rule.isStateless ?? false,
    description: rule.description,
  }));
  const egress: RuleRow[] = (sl.egressSecurityRules ?? []).map((rule) => ({
    direction: "egress",
    protocol: protocolLabel(rule.protocol),
    peer: rule.destination ?? "-",
    ports: portsLabel(rule.tcpOptions, rule.udpOptions),
    stateless: rule.isStateless ?? false,
    description: rule.description,
  }));
  return [...ingress, ...egress];
}

export function nsgRuleRows(rules: OciNsgRule[]): RuleRow[] {
  return rules.map((rule) => ({
    direction: rule.direction === "EGRESS" ? "egress" : "ingress",
    protocol: protocolLabel(rule.protocol),
    peer: (rule.direction === "EGRESS" ? rule.destination : rule.source) ?? "-",
    ports: portsLabel(rule.tcpOptions, rule.udpOptions),
    stateless: rule.isStateless ?? false,
    description: rule.description,
  }));
}

export function routeRows(rt: OciRouteTable): RouteRow[] {
  return (rt.routeRules ?? []).map((rule) => ({
    destination: rule.destination ?? rule.cidrBlock ?? "-",
    entityKind: routeEntityKind(rule.networkEntityId),
    entityId: rule.networkEntityId,
    description: rule.description,
  }));
}
