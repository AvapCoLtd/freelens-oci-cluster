import type { ClusterOciData } from "../sdk/fetch";
import type { OciLoadBalancer, OciNetworkLoadBalancerSummary, OciWafSummary } from "../sdk/types";
import { type GatewayKind, gatewayKindOf, ocidTypeSegment } from "./gateway-status";
import { type LbCertInfo, lbCertificateRows, managedCertificateIdsOf } from "./lb-certificates";

export type SubnetRole = "lb" | "node" | "endpoint";

export interface WafRow {
  id: string;
  displayName?: string;
  lifecycleState?: string;
  policyId?: string;
  targetLbId: string;
  targetLbName?: string;
}

export interface ListenerInfo {
  name: string;
  port?: number;
  protocol?: string;
}

export interface LbRow {
  id: string;
  kind: "nlb" | "lb";
  displayName?: string;
  lifecycleState?: string;
  ips: string[];
  isPrivate?: boolean;
  subnetIds: string[];
  nsgIds: string[];
  listeners: ListenerInfo[];
  backendSetNames: string[];
  certificates: LbCertInfo[];
  /** Certificatesサービス方式(certificate-ids)のlistener証明書OCID */
  managedCertificateIds: string[];
}

export interface SubnetRow {
  subnetId: string;
  roles: SubnetRole[];
  // 以下はsubnets Recordが未取得/失敗の間undefined(行はOCIDのみで出す)
  vcnId?: string;
  displayName?: string;
  cidrBlock?: string;
  prohibitPublicIpOnVnic?: boolean;
  securityListIds: string[];
  routeTableId?: string;
}

export interface NetworkView {
  wafRows: WafRow[];
  lbRows: LbRow[];
  lbSubnetRows: SubnetRow[];
  nodeSubnetRows: SubnetRow[];
  endpointSubnetRow?: SubnetRow;
  nodeNsgIds: string[];
  endpointNsgIds: string[];
}

function listenersOf(record: Record<string, { port?: number; protocol?: string }> | undefined): ListenerInfo[] {
  return Object.entries(record ?? {}).map(([name, l]) => ({ name, port: l.port, protocol: l.protocol }));
}

function lbRowOfNlb(nlb: OciNetworkLoadBalancerSummary): LbRow {
  return {
    id: nlb.id,
    kind: "nlb",
    displayName: nlb.displayName,
    lifecycleState: nlb.lifecycleState,
    ips: (nlb.ipAddresses ?? []).map((ip) => ip.ipAddress).filter((ip): ip is string => !!ip),
    isPrivate: nlb.isPrivate,
    subnetIds: nlb.subnetId ? [nlb.subnetId] : [],
    nsgIds: nlb.networkSecurityGroupIds ?? [],
    listeners: listenersOf(nlb.listeners),
    backendSetNames: Object.keys(nlb.backendSets ?? {}),
    certificates: [],
    managedCertificateIds: [],
  };
}

function lbRowOfLb(lb: OciLoadBalancer): LbRow {
  return {
    id: lb.id,
    kind: "lb",
    displayName: lb.displayName,
    lifecycleState: lb.lifecycleState,
    ips: (lb.ipAddresses ?? []).map((ip) => ip.ipAddress).filter((ip): ip is string => !!ip),
    isPrivate: lb.isPrivate,
    subnetIds: lb.subnetIds ?? [],
    nsgIds: lb.networkSecurityGroupIds ?? [],
    listeners: listenersOf(lb.listeners),
    backendSetNames: Object.keys(lb.backendSets ?? {}),
    certificates: lbCertificateRows(lb),
    managedCertificateIds: managedCertificateIdsOf(lb),
  };
}

// WebAppFirewallSummaryのloadBalancerIdはLOAD_BALANCERサブタイプのみ持つ(union型のため構造で読む)。
function wafTargetLbId(waf: OciWafSummary): string | undefined {
  const id = (waf as { loadBalancerId?: unknown }).loadBalancerId;
  return typeof id === "string" ? id : undefined;
}

function subnetRow(data: ClusterOciData, subnetId: string, roles: SubnetRole[]): SubnetRow {
  const subnet = data.subnets[subnetId];
  if (!subnet?.ok) {
    return { subnetId, roles, securityListIds: [] };
  }
  return {
    subnetId,
    roles,
    vcnId: subnet.data.vcnId,
    displayName: subnet.data.displayName,
    cidrBlock: subnet.data.cidrBlock,
    prohibitPublicIpOnVnic: subnet.data.prohibitPublicIpOnVnic,
    securityListIds: subnet.data.securityListIds ?? [],
    routeTableId: subnet.data.routeTableId,
  };
}

/** K8s NodeのアドレスからLBバックエンド照合用のIP集合を作る。 */
export function internalIpsOfNodes(
  nodes: { status?: { addresses?: { type?: string; address?: string }[] } }[],
): string[] {
  const ips = new Set<string>();
  for (const node of nodes) {
    for (const address of node.status?.addresses ?? []) {
      if ((address.type === "InternalIP" || address.type === "ExternalIP") && address.address) {
        ips.add(address.address);
      }
    }
  }
  return [...ips];
}

interface BackendSetsLike {
  [name: string]: { backends?: { ipAddress?: string }[] } | undefined;
}

interface LbEntry {
  id: string;
  ips: string[];
  backendIps: string[];
}

function toLbEntry(
  id: string,
  ips: ({ ipAddress?: string } | undefined)[] | undefined,
  backendSets: BackendSetsLike | undefined,
): LbEntry {
  return {
    id,
    ips: (ips ?? []).map((ip) => ip?.ipAddress).filter((ip): ip is string => !!ip),
    backendIps: Object.values(backendSets ?? {}).flatMap((set) =>
      (set?.backends ?? []).map((backend) => backend.ipAddress).filter((ip): ip is string => !!ip),
    ),
  };
}

/**
 * クラスタ関連LB/NLBの判定(compartment内の無関係なLBを経路表示から除外する)。
 * 判定は3経路の和集合。
 * 1. CreatedByタグ=クラスタOCID(既存設計の経路4)
 * 2. ServiceのingressIP照合(経路2)
 * 3. バックエンドIPがノードまたは判定済みクラスタ関連LBのIPを指すLB(2段LB構成: 手動WAF用LB→ingress NLB→ノード。
 *    FujitaKankoで実在確認)。連鎖があるため固定点まで展開する
 */
export function clusterLbIds(
  data: Pick<ClusterOciData, "taggedResources" | "nlbs" | "lbs">,
  serviceIngressIps: readonly string[],
  nodeIps: readonly string[] = [],
): Set<string> {
  const tagged = new Set(
    data.taggedResources.ok
      ? data.taggedResources.data.map((r) => r.identifier).filter((id): id is string => !!id)
      : [],
  );
  const serviceIpSet = new Set(serviceIngressIps);
  const entries: LbEntry[] = [
    ...(data.nlbs.ok
      ? data.nlbs.data.map((nlb) => toLbEntry(nlb.id, nlb.ipAddresses, nlb.backendSets as BackendSetsLike))
      : []),
    ...(data.lbs.ok
      ? data.lbs.data.map((lb) => toLbEntry(lb.id, lb.ipAddresses, lb.backendSets as BackendSetsLike))
      : []),
  ];

  const related = new Set<string>();
  const relatedIps = new Set<string>(nodeIps);
  const markRelated = (entry: LbEntry) => {
    related.add(entry.id);
    for (const ip of entry.ips) relatedIps.add(ip);
  };

  for (const entry of entries) {
    if (tagged.has(entry.id) || entry.ips.some((ip) => serviceIpSet.has(ip))) markRelated(entry);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (related.has(entry.id)) continue;
      if (entry.backendIps.some((ip) => relatedIps.has(ip))) {
        markRelated(entry);
        changed = true;
      }
    }
  }
  return related;
}

function filterByLbIds<T extends { id: string }>(items: T[], lbIds: ReadonlySet<string> | undefined): T[] {
  return lbIds ? items.filter((item) => lbIds.has(item.id)) : items;
}

/** ノードプール由来のsubnet OCID集合(pool.subnetIds + placementConfigs.subnetId)。 */
function nodePoolSubnetIds(nodePools: ClusterOciData["nodePools"]): Set<string> {
  const ids = new Set<string>();
  if (!nodePools.ok) return ids;
  for (const pool of nodePools.data) {
    for (const id of pool.subnetIds ?? []) ids.add(id);
    for (const placement of pool.nodeConfigDetails?.placementConfigs ?? []) {
      if (placement.subnetId) ids.add(placement.subnetId);
    }
  }
  return ids;
}

/** ノードプール由来のNSG OCID集合。 */
function nodePoolNsgIds(nodePools: ClusterOciData["nodePools"]): Set<string> {
  const ids = new Set<string>();
  if (!nodePools.ok) return ids;
  for (const pool of nodePools.data) {
    for (const id of pool.nodeConfigDetails?.nsgIds ?? []) ids.add(id);
  }
  return ids;
}

/** networkページで取得すべきsubnet OCIDの全集合(endpoint / ノードプール / クラスタ関連LB・NLB由来)。storeの取得起点。 */
export function collectSubnetIds(
  data: Pick<ClusterOciData, "cluster" | "nodePools" | "nlbs" | "lbs">,
  lbIds?: ReadonlySet<string>,
): string[] {
  const ids = nodePoolSubnetIds(data.nodePools);
  if (data.cluster.ok && data.cluster.data.endpointConfig?.subnetId) ids.add(data.cluster.data.endpointConfig.subnetId);
  if (data.nlbs.ok) for (const nlb of filterByLbIds(data.nlbs.data, lbIds)) if (nlb.subnetId) ids.add(nlb.subnetId);
  if (data.lbs.ok)
    for (const lb of filterByLbIds(data.lbs.data, lbIds)) for (const id of lb.subnetIds ?? []) ids.add(id);
  return [...ids];
}

/** networkページで取得すべきNSG OCIDの全集合(endpoint / ノードプール / クラスタ関連LB・NLB由来)。storeの取得起点。 */
export function collectNsgIds(
  data: Pick<ClusterOciData, "cluster" | "nodePools" | "nlbs" | "lbs">,
  lbIds?: ReadonlySet<string>,
): string[] {
  const ids = nodePoolNsgIds(data.nodePools);
  if (data.cluster.ok) for (const id of data.cluster.data.endpointConfig?.nsgIds ?? []) ids.add(id);
  if (data.nlbs.ok)
    for (const nlb of filterByLbIds(data.nlbs.data, lbIds))
      for (const id of nlb.networkSecurityGroupIds ?? []) ids.add(id);
  if (data.lbs.ok)
    for (const lb of filterByLbIds(data.lbs.data, lbIds))
      for (const id of lb.networkSecurityGroupIds ?? []) ids.add(id);
  return [...ids];
}

/**
 * 経路軸ビュー(外→内: WAF → LB/NLB → LBサブネット → ノードサブネット → endpoint)の組み立て。
 * lbIdsを渡すとLB/NLBをクラスタ関連(clusterLbIds)に絞る(compartment全体のLBを並べない)。
 * WAFはクラスタ関連のclassic LBに紐付くもののみ表示する。
 */
export function buildNetworkView(data: ClusterOciData, lbIds?: ReadonlySet<string>): NetworkView {
  const lbRows: LbRow[] = [
    ...(data.nlbs.ok ? filterByLbIds(data.nlbs.data, lbIds).map(lbRowOfNlb) : []),
    ...(data.lbs.ok ? filterByLbIds(data.lbs.data, lbIds).map(lbRowOfLb) : []),
  ];
  const lbById = new Map(lbRows.map((row) => [row.id, row]));

  const wafRows: WafRow[] = (data.wafs.ok ? data.wafs.data : [])
    .map((waf) => ({ waf, targetLbId: wafTargetLbId(waf) }))
    .filter(
      (entry): entry is { waf: OciWafSummary; targetLbId: string } =>
        !!entry.targetLbId && lbById.has(entry.targetLbId),
    )
    .map(({ waf, targetLbId }) => ({
      id: waf.id,
      displayName: waf.displayName,
      lifecycleState: waf.lifecycleState,
      policyId: waf.webAppFirewallPolicyId,
      targetLbId,
      targetLbName: lbById.get(targetLbId)?.displayName,
    }));

  const endpointSubnetId = data.cluster.ok ? data.cluster.data.endpointConfig?.subnetId : undefined;

  const nodeSubnetIds = nodePoolSubnetIds(data.nodePools);
  const lbSubnetIds = new Set<string>(lbRows.flatMap((row) => row.subnetIds));

  const rolesOf = (subnetId: string): SubnetRole[] => {
    const roles: SubnetRole[] = [];
    if (lbSubnetIds.has(subnetId)) roles.push("lb");
    if (nodeSubnetIds.has(subnetId)) roles.push("node");
    if (subnetId === endpointSubnetId) roles.push("endpoint");
    return roles;
  };

  return {
    wafRows,
    lbRows,
    lbSubnetRows: [...lbSubnetIds].map((id) => subnetRow(data, id, rolesOf(id))),
    nodeSubnetRows: [...nodeSubnetIds]
      .filter((id) => !lbSubnetIds.has(id))
      .map((id) => subnetRow(data, id, rolesOf(id))),
    endpointSubnetRow:
      endpointSubnetId && !lbSubnetIds.has(endpointSubnetId) && !nodeSubnetIds.has(endpointSubnetId)
        ? subnetRow(data, endpointSubnetId, ["endpoint"])
        : undefined,
    nodeNsgIds: [...nodePoolNsgIds(data.nodePools)],
    endpointNsgIds: data.cluster.ok ? (data.cluster.data.endpointConfig?.nsgIds ?? []) : [],
  };
}

const GATEWAY_KIND_LABEL: Record<GatewayKind, string> = {
  natgateway: "NAT Gateway",
  internetgateway: "Internet Gateway",
  servicegateway: "Service Gateway",
  drg: "DRG",
  localpeeringgateway: "Local Peering Gateway",
};

/** RTのルート宛先エンティティ種別をOCIDプレフィックスから表示名に変換する(名前解決の追加取得はしない)。 */
export function routeEntityKind(networkEntityId: string | undefined): string {
  if (!networkEntityId) return "-";
  const kind = gatewayKindOf(networkEntityId);
  if (kind) return GATEWAY_KIND_LABEL[kind];
  const type = ocidTypeSegment(networkEntityId);
  if (type === "privateip") return "Private IP";
  return type ?? "-";
}
