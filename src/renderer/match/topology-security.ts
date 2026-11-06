import type { OciSecurityRule } from "../oci/types";
import { cidrContains, cidrOverlaps, cidrPrefixLength, ipInCidr } from "./cidr";

export const SECURITY_EDGE_KINDS = ["sl-allow", "nsg-allow"] as const;

export type SecurityEdgeKind = (typeof SECURITY_EDGE_KINDS)[number];

export interface SecurityPeer {
  nodeId: string;
  /** Subnetノードのみ: そのSubnetのCIDR */
  cidrs?: readonly string[];
  nsgIds?: readonly string[];
  /** ノードが持つIP(NSGルールのsourceがCIDRのときの突合先) */
  ips?: readonly string[];
}

export interface SecurityRuleSet {
  nodeId: string;
  /** NSG由来のみ: ルールを持つNSGのOCID */
  nsgId?: string;
  rules: readonly OciSecurityRule[];
}

export interface SecurityGraphInput {
  peers: readonly SecurityPeer[];
  /** Subnetノードのingressルール(そのSubnetのsecurity list由来) */
  subnetIngress: readonly SecurityRuleSet[];
  /** NSGを付けたノードのingressルール(付いているNSG 1件ごとに1エントリ) */
  nsgIngress: readonly SecurityRuleSet[];
  /** 「広すぎるsource」の基準になるVCNのCIDR */
  vcnCidrs: readonly string[];
}

export interface SecurityLink {
  kind: SecurityEdgeKind;
  source: string;
  target: string;
  /** ラベル要素(`tcp/443`)。プロトコルのみのルールは`tcp`のように port を持たない */
  port: string;
}

const NSG_OCID_PREFIX = "ocid1.networksecuritygroup.";

// IPプロトコル番号は膨大にあるが、SL/NSGルールで実用上現れるものだけ名前にする。
const PROTOCOL_TOKEN: Record<string, string> = {
  all: "all",
  "1": "icmp",
  "6": "tcp",
  "17": "udp",
  "58": "icmpv6",
};

const PROTOCOL_ORDER: readonly string[] = ["tcp", "udp", "icmp", "icmpv6", "all"];

const PORT_SUMMARY_LIMIT = 4;

export function portToken(rule: OciSecurityRule): string {
  const protocol = rule.protocol ?? "all";
  const name = PROTOCOL_TOKEN[protocol] ?? protocol;
  const range = rule["tcp-options"]?.["destination-port-range"] ?? rule["udp-options"]?.["destination-port-range"];
  if (!range || range.min === undefined) return name;
  return range.max === undefined || range.min === range.max
    ? `${name}/${range.min}`
    : `${name}/${range.min}-${range.max}`;
}

function tokenParts(token: string): { protocol: string; port: number } {
  const slash = token.indexOf("/");
  if (slash < 0) return { protocol: token, port: -1 };
  return { protocol: token.slice(0, slash), port: Number.parseInt(token.slice(slash + 1), 10) };
}

function protocolRank(protocol: string): number {
  const index = PROTOCOL_ORDER.indexOf(protocol);
  return index < 0 ? PROTOCOL_ORDER.length : index;
}

function compareTokens(a: string, b: string): number {
  const left = tokenParts(a);
  const right = tokenParts(b);
  const byProtocol = protocolRank(left.protocol) - protocolRank(right.protocol);
  if (byProtocol !== 0) return byProtocol;
  if (left.protocol !== right.protocol) return left.protocol < right.protocol ? -1 : 1;
  if (left.port !== right.port) return left.port - right.port;
  return a === b ? 0 : a < b ? -1 : 1;
}

export function summarizePorts(ports: readonly string[]): string {
  const unique = [...new Set(ports)].sort(compareTokens);
  const head = unique[0];
  if (head === undefined) return "";
  return unique.length <= PORT_SUMMARY_LIMIT ? unique.join(", ") : `${head} +${unique.length - 1}`;
}

function isTooBroad(source: string, vcnCidrs: readonly string[]): boolean {
  if (cidrPrefixLength(source) === 0) return true;
  return vcnCidrs.some((cidr) => cidrContains(source, cidr));
}

/** 同一入力に対し同一出力(配列順を含む)を返す純粋関数で、集約は呼び出し側が行う。 */
export function securityLinksOf(input: SecurityGraphInput): SecurityLink[] {
  const links: SecurityLink[] = [];
  const peerById = new Map(input.peers.map((peer) => [peer.nodeId, peer]));
  const subnetPeersBySource = new Map<string, string[]>();
  const ipPeersBySource = new Map<string, string[]>();
  const peersByNsgId = new Map<string, string[]>();

  for (const ruleSet of input.subnetIngress) {
    for (const rule of ruleSet.rules) {
      const source = rule.source;
      if (!source || isTooBroad(source, input.vcnCidrs)) continue;
      const port = portToken(rule);
      let matches = subnetPeersBySource.get(source);
      if (matches === undefined) {
        matches = input.peers
          .filter((peer) => (peer.cidrs ?? []).some((cidr) => cidrOverlaps(cidr, source)))
          .map((peer) => peer.nodeId);
        subnetPeersBySource.set(source, matches);
      }
      for (const nodeId of matches) {
        if (nodeId === ruleSet.nodeId) continue;
        links.push({ kind: "sl-allow", source: nodeId, target: ruleSet.nodeId, port });
      }
    }
  }

  for (const ruleSet of input.nsgIngress) {
    const ownNsgIds = peerById.get(ruleSet.nodeId)?.nsgIds ?? [];
    for (const rule of ruleSet.rules) {
      const source = rule.source;
      if (!source) continue;
      const port = portToken(rule);
      if (source.startsWith(NSG_OCID_PREFIX)) {
        // 適用先自身が属するNSGからの許可は、そのNSGの全メンバ間に総当たりの線を張るだけで何も絞れない。
        if (ownNsgIds.includes(source)) continue;
        let matches = peersByNsgId.get(source);
        if (matches === undefined) {
          matches = input.peers.filter((peer) => (peer.nsgIds ?? []).includes(source)).map((peer) => peer.nodeId);
          peersByNsgId.set(source, matches);
        }
        for (const nodeId of matches) {
          if (nodeId === ruleSet.nodeId) continue;
          links.push({ kind: "nsg-allow", source: nodeId, target: ruleSet.nodeId, port });
        }
        continue;
      }
      if (isTooBroad(source, input.vcnCidrs)) continue;
      let matches = ipPeersBySource.get(source);
      if (matches === undefined) {
        matches = input.peers
          .filter((peer) => (peer.ips ?? []).some((ip) => ipInCidr(ip, source)))
          .map((peer) => peer.nodeId);
        ipPeersBySource.set(source, matches);
      }
      for (const nodeId of matches) {
        if (nodeId === ruleSet.nodeId) continue;
        links.push({ kind: "nsg-allow", source: nodeId, target: ruleSet.nodeId, port });
      }
    }
  }

  return links;
}
