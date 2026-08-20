import type { ClusterOciData } from "../fetch/fetch";
import type { OciResult } from "../oci/result";
import type { OciFssExport, OciSubnet, OciVcn } from "../oci/types";
import { buildConsoleUrl, type OciConsoleResourceType } from "./console-url";
import {
  type GatewayKind,
  gatewayHealth,
  gatewayIdsOfRouteTables,
  gatewayKindOf,
  isSupportedGatewayId,
} from "./gateway-status";
import { isAbnormalLifecycleState } from "./lifecycle-state";
import {
  backendIpsOf,
  buildNetworkView,
  clusterLbIds,
  internalIpsOfNodes,
  type LbRow,
  routeEntityKind,
} from "./network-path";
import { extractRegionFromOcid } from "./ocid-region";
import { TOPOLOGY_SECTIONS, type TopologySection } from "./page-sections";
import { parseProviderId } from "./provider-id";
import {
  type CsiSource,
  fileSystemOcidOf,
  getCsiSource,
  isOrphanedPvStorage,
  type PvStorageOrphanKind,
  type PvStorageResolution,
  resolvePvStorage,
} from "./pv-storage";
import {
  ingressIpsOfServices,
  type LoadBalancerCandidate,
  matchServicesToLoadBalancers,
  type ServiceLbMatchInput,
} from "./service-lb";

/** 描画順・ソートの安定キーを兼ねる種別の並び。 */
export const TOPOLOGY_NODE_KINDS = [
  "vcn",
  "subnet",
  "subnet-summary",
  "instance-group",
  "instance",
  "lb",
  "nlb",
  "gateway",
  "waf",
  "k8s-service",
  "k8s-pv",
  "volume",
  "filesystem",
  "backup-policy",
  "snapshot-policy",
] as const;

export type TopologyNodeKind = (typeof TOPOLOGY_NODE_KINDS)[number];

export const TOPOLOGY_EDGE_KINDS = [
  "backend",
  "waf-lb",
  "service-lb",
  "pv-storage",
  "volume-backup",
  "fss-snapshot",
  "route",
] as const;

export type TopologyEdgeKind = (typeof TOPOLOGY_EDGE_KINDS)[number];

export type TopologyNodeStatus = "ok" | "warning" | "unknown";

export type TopologyDetailRole = "ocid" | "cidr";

export interface TopologyDetail {
  label: string;
  /** 配列値は改行区切りの1エントリで持つ */
  value: string;
  role?: TopologyDetailRole;
}

export interface TopologyNode {
  id: string;
  kind: TopologyNodeKind;
  label: string;
  /** 包含の親(VCN / Subnet)。持たないノードは図の最上位に置かれる */
  parentId?: string;
  status?: TopologyNodeStatus;
  detail: TopologyDetail[];
  consoleUrl?: string;
  /** instance-groupのみ: 畳んだInstanceノードのOCID */
  memberIds?: string[];
  /** instance-group / subnet-summaryのみ: 畳んだ件数 */
  count?: number;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  kind: TopologyEdgeKind;
}

/** 取得失敗で図に出せなかった種別。sectionsは由来する失敗セクション(TOPOLOGY_SECTIONS順)。 */
export interface TopologyMissing {
  target: "node" | "edge";
  kind: TopologyNodeKind | TopologyEdgeKind;
  sections: TopologySection[];
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  missing: TopologyMissing[];
}

export interface TopologyK8sNode {
  metadata: { name: string };
  spec?: { providerID?: string | null };
  status?: { addresses?: { type?: string; address?: string }[] };
}

export interface TopologyK8sService {
  metadata: { name: string; namespace: string };
  spec: { type?: string; externalTrafficPolicy?: string };
  status?: { loadBalancer?: { ingress?: { ip?: string }[] } };
}

export interface TopologyK8sPv {
  metadata: { name: string };
  spec: { csi?: CsiSource; capacity?: { storage?: string } };
}

export interface TopologyGraphInput {
  data: ClusterOciData;
  nodes?: readonly TopologyK8sNode[];
  services?: readonly TopologyK8sService[];
  persistentVolumes?: readonly TopologyK8sPv[];
  /** 集約ノードを展開して個々のInstanceを出すSubnet OCID */
  expandedSubnetIds?: ReadonlySet<string>;
  /** list自体の失敗などClusterOciDataのエントリからは読めない失敗セクション */
  failedSections?: readonly TopologySection[];
}

/** Subnet内Instanceをこの件数より多く抱えると集約ノードへ畳む。 */
const AGGREGATE_THRESHOLD = 10;

/** 図に出さないSubnetの件数だけを示す合成ノードのid(OCIDを持たないため詳細もコンソールリンクも無い)。 */
export const SUBNET_SUMMARY_ID = "topology-other-subnets";

const NODE_KIND_SECTIONS: Partial<Record<TopologyNodeKind, readonly TopologySection[]>> = {
  // VCNボックスはvcn取得失敗でもvcn-idラベルで成立する。列挙元はcluster応答のvcn-id。
  vcn: ["cluster"],
  subnet: ["subnets"],
  instance: ["instances"],
  // LB/NLB/WAFはタグ検索が決めたcompartment集合の中でしか見つからない(経路4)。
  lb: ["taggedResources", "lbs"],
  nlb: ["taggedResources", "nlbs"],
  gateway: ["routeTables", "gateways"],
  waf: ["taggedResources", "wafs"],
  volume: ["volumes"],
  filesystem: ["fileSystems"],
  "backup-policy": ["volumeBackupPolicies"],
  "snapshot-policy": ["fssSnapshotPolicies"],
};

const EDGE_KIND_SECTIONS: Record<TopologyEdgeKind, readonly TopologySection[]> = {
  backend: ["taggedResources", "lbs", "nlbs", "instances"],
  "waf-lb": ["taggedResources", "wafs", "lbs"],
  "service-lb": ["taggedResources", "lbs", "nlbs"],
  "pv-storage": ["volumes", "fileSystems"],
  "volume-backup": ["volumes", "volumeBackupPolicies"],
  "fss-snapshot": ["fileSystems", "fssSnapshotPolicies"],
  route: ["subnets", "routeTables", "gateways"],
};

const KIND_ORDER = new Map<TopologyNodeKind, number>(TOPOLOGY_NODE_KINDS.map((kind, index) => [kind, index]));

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNodes(a: TopologyNode, b: TopologyNode): number {
  const byKind = (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0);
  return byKind !== 0 ? byKind : compareText(a.id, b.id);
}

interface ParsedIp {
  family: 4 | 6;
  value: bigint;
}

interface ParsedCidr extends ParsedIp {
  network: bigint;
  mask: bigint;
}

function parseIpv4(text: string): bigint | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6Groups(part: string): bigint[] | undefined {
  if (part === "") return [];
  const tokens = part.split(":");
  const groups: bigint[] = [];
  for (const [index, token] of tokens.entries()) {
    // 末尾のIPv4記法(::ffff:10.0.0.1)は16bit×2として畳む
    if (token.includes(".")) {
      if (index !== tokens.length - 1) return undefined;
      const embedded = parseIpv4(token);
      if (embedded === undefined) return undefined;
      groups.push(embedded >> 16n, embedded & 0xffffn);
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(token)) return undefined;
    groups.push(BigInt(`0x${token}`));
  }
  return groups;
}

function parseIpv6(text: string): bigint | undefined {
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = parseIpv6Groups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseIpv6Groups(halves[1] ?? "") : [];
  if (!head || !tail) return undefined;
  const total = head.length + tail.length;
  if (halves.length === 2 ? total > 7 : total !== 8) return undefined;
  const groups = [...head, ...new Array<bigint>(8 - total).fill(0n), ...tail];
  return groups.reduce((acc, group) => (acc << 16n) | group, 0n);
}

function parseIp(text: string | undefined | null): ParsedIp | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (trimmed.includes(":")) {
    const value = parseIpv6(trimmed);
    return value === undefined ? undefined : { family: 6, value };
  }
  const value = parseIpv4(trimmed);
  return value === undefined ? undefined : { family: 4, value };
}

function parseCidr(text: string | undefined | null): ParsedCidr | undefined {
  if (!text) return undefined;
  const slash = text.indexOf("/");
  if (slash < 0) return undefined;
  const address = parseIp(text.slice(0, slash));
  const prefixText = text.slice(slash + 1).trim();
  if (!address || !/^\d{1,3}$/.test(prefixText)) return undefined;
  const prefix = Number(prefixText);
  const width = address.family === 4 ? 32 : 128;
  if (prefix > width) return undefined;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(width - prefix);
  return { ...address, network: address.value & mask, mask };
}

/** IPがCIDRに含まれるか。アドレスファミリ不一致・不正表記はfalse(例外にしない)。 */
export function ipInCidr(ip: string | undefined | null, cidr: string | undefined | null): boolean {
  const address = parseIp(ip);
  const block = parseCidr(cidr);
  if (!address || !block || address.family !== block.family) return false;
  return (address.value & block.mask) === block.network;
}

function subnetCidrs(subnet: OciSubnet): string[] {
  const cidrs = new Set<string>();
  for (const cidr of [
    subnet["cidr-block"],
    ...(subnet["ipv4-cidr-blocks"] ?? []),
    subnet["ipv6-cidr-block"],
    ...(subnet["ipv6-cidr-blocks"] ?? []),
  ]) {
    if (cidr) cidrs.add(cidr);
  }
  return [...cidrs];
}

/** 件数サマリの一覧行に使う「name cidr, ...」表記。 */
function subnetRowLabel(subnetId: string, subnet: OciSubnet): string {
  const name = subnet["display-name"] ?? subnetId;
  const cidrs = subnetCidrs(subnet);
  return cidrs.length > 0 ? `${name} ${cidrs.join(", ")}` : name;
}

function vcnCidrs(vcn: OciVcn): string[] {
  const cidrs = new Set<string>();
  for (const cidr of [vcn["cidr-block"], ...(vcn["cidr-blocks"] ?? []), ...(vcn["ipv6-cidr-blocks"] ?? [])]) {
    if (cidr) cidrs.add(cidr);
  }
  return [...cidrs];
}

function statusOf(lifecycleState: string | undefined): TopologyNodeStatus {
  if (lifecycleState === undefined) return "unknown";
  return isAbnormalLifecycleState(lifecycleState) ? "warning" : "ok";
}

/** 集約ノードに畳んだInstance 1件分の値(表示・検索とも改行区切りの1エントリで持つ)。 */
function memberDetailValue(member: TopologyNode): string {
  return [...new Set([member.label, ...member.detail.map((row) => row.value)])].join("\n");
}

function detailOf(rows: (TopologyDetail | undefined)[]): TopologyDetail[] {
  return rows.filter((row): row is TopologyDetail => !!row && row.value !== "");
}

function text(label: string, value: string | undefined, role?: TopologyDetailRole): TopologyDetail | undefined {
  return value ? { label, value, role } : undefined;
}

function list(label: string, values: readonly string[], role?: TopologyDetailRole): TopologyDetail | undefined {
  return values.length > 0 ? { label, value: values.join("\n"), role } : undefined;
}

function consoleUrlOf(type: OciConsoleResourceType, ocid: string, parentId?: string): string | undefined {
  const region = extractRegionFromOcid(ocid);
  return region ? buildConsoleUrl(type, ocid, region, parentId) : undefined;
}

const GATEWAY_CONSOLE_TYPE: Record<GatewayKind, OciConsoleResourceType> = {
  internetgateway: "internet-gateway",
  natgateway: "nat-gateway",
  servicegateway: "service-gateway",
  localpeeringgateway: "local-peering-gateway",
  drg: "drg",
};

function gatewayConsoleUrlOf(gatewayId: string, vcnParentId: string | undefined): string | undefined {
  const kind = gatewayKindOf(gatewayId);
  if (!kind) return undefined;
  // DRGはVCN配下でないためparentId不要。他4種はVCN未解決ならボタンを出さない
  if (kind === "drg") return consoleUrlOf("drg", gatewayId);
  return vcnParentId ? consoleUrlOf(GATEWAY_CONSOLE_TYPE[kind], gatewayId, vcnParentId) : undefined;
}

// 実体なし(resource_not_found)は取得の失敗ではなく孤立PVの観測結果。欠落バナーへ載せない。
function isFailed(result: OciResult<unknown> | undefined): boolean {
  return !!result && !result.ok && result.kind !== "loading" && result.kind !== "resource_not_found";
}

function hasFailedEntry(record: Record<string, OciResult<unknown>>): boolean {
  return Object.values(record).some(isFailed);
}

function failedSectionsOf(data: ClusterOciData, extra: readonly TopologySection[] | undefined): Set<TopologySection> {
  const failed = new Set<TopologySection>();
  const mark = (section: TopologySection, condition: boolean) => {
    if (condition) failed.add(section);
  };
  mark("cluster", isFailed(data.cluster));
  mark("taggedResources", isFailed(data.taggedResources));
  mark("instances", isFailed(data.instances));
  mark("nodePools", isFailed(data.nodePools));
  mark("lbs", isFailed(data.lbs));
  mark("nlbs", isFailed(data.nlbs));
  mark("wafs", isFailed(data.wafs));
  mark("volumes", isFailed(data.volumes));
  mark("volumeBackupPolicies", hasFailedEntry(data.volumeBackupPolicies));
  mark("fileSystems", hasFailedEntry(data.fileSystems) || hasFailedEntry(data.fssExports));
  mark("fssSnapshotPolicies", hasFailedEntry(data.fssSnapshotPolicies));
  mark("vcn", hasFailedEntry(data.vcns));
  mark("subnets", hasFailedEntry(data.subnets));
  mark("routeTables", hasFailedEntry(data.routeTables));
  mark("gateways", hasFailedEntry(data.gateways));
  for (const section of extra ?? []) failed.add(section);
  return failed;
}

function missingOf(failed: ReadonlySet<TopologySection>): TopologyMissing[] {
  const missing: TopologyMissing[] = [];
  const push = (
    target: "node" | "edge",
    kind: TopologyNodeKind | TopologyEdgeKind,
    sections: readonly TopologySection[],
  ) => {
    const hit = TOPOLOGY_SECTIONS.filter((section) => sections.includes(section) && failed.has(section));
    if (hit.length > 0) missing.push({ target, kind, sections: hit });
  };
  for (const kind of TOPOLOGY_NODE_KINDS) {
    const sections = NODE_KIND_SECTIONS[kind];
    if (sections) push("node", kind, sections);
  }
  for (const kind of TOPOLOGY_EDGE_KINDS) push("edge", kind, EDGE_KIND_SECTIONS[kind]);
  return missing;
}

function internalIpsOf(node: TopologyK8sNode): string[] {
  const ips: string[] = [];
  for (const address of node.status?.addresses ?? []) {
    if (address.type === "InternalIP" && address.address) ips.push(address.address);
  }
  return ips;
}

function allIpsOf(node: TopologyK8sNode): string[] {
  const ips: string[] = [];
  for (const address of node.status?.addresses ?? []) {
    if (address.address) ips.push(address.address);
  }
  return ips;
}

function serviceMatchInput(service: TopologyK8sService): ServiceLbMatchInput {
  return {
    namespace: service.metadata.namespace,
    name: service.metadata.name,
    ingressIps: (service.status?.loadBalancer?.ingress ?? [])
      .map((ingress) => ingress.ip)
      .filter((ip): ip is string => !!ip),
    externalTrafficPolicy: service.spec.externalTrafficPolicy,
  };
}

function okEntries<T>(record: Record<string, OciResult<T>>): [string, T][] {
  const entries: [string, T][] = [];
  for (const [id, result] of Object.entries(record)) {
    if (result.ok) entries.push([id, result.data]);
  }
  return entries;
}

const ORPHAN_DETAIL_LABEL = "Status";

// OCIは権限不足と不在に同じ応答を返すため、不在と断定せず両方を読める文言にする。
const ORPHAN_DETAIL_VALUE: Record<PvStorageOrphanKind, string> = {
  volume: "Referenced volume not found in OCI or not accessible (orphaned PV)",
  filesystem: "Referenced file system not found in OCI or not accessible (orphaned PV)",
  export: "Referenced FSS export not found or not accessible (file system may still exist)",
};

/** PVの参照先ストレージのコンソールURL。孤立PVは呼び出し元で除く(実体が無いのでコンソールも404になる)。 */
function pvStorageConsoleUrlOf(
  resolution: PvStorageResolution,
  fssExports: Record<string, OciResult<OciFssExport>>,
): string | undefined {
  const ocid = resolution.ocid;
  if (!ocid) return undefined;
  if (resolution.kind === "block_volume") return consoleUrlOf("volume", ocid);
  if (resolution.kind !== "file_system") return undefined;
  const fileSystemId = fileSystemOcidOf(ocid, fssExports);
  return fileSystemId ? consoleUrlOf("filesystem", fileSystemId) : undefined;
}

/** per-OCID Mapの成功データ(未取得・失敗はundefined)。 */
function okEntry<T>(record: Record<string, OciResult<T>>, id: string | undefined): T | undefined {
  if (!id) return undefined;
  const result = record[id] as OciResult<T> | undefined;
  return result?.ok ? result.data : undefined;
}

/**
 * 確定済みClusterOciDataとK8s側の入力からトポロジーのノード・エッジ集合を導出する。
 * 同一入力に対し同一出力(配列順を含む)を返す純粋関数。
 */
export function buildTopologyGraph(input: TopologyGraphInput): TopologyGraph {
  const { data } = input;
  const expanded = input.expandedSubnetIds ?? new Set<string>();
  const k8sNodes = [...(input.nodes ?? [])].sort((a, b) => compareText(a.metadata.name, b.metadata.name));
  const services = [...(input.services ?? [])].sort((a, b) =>
    compareText(`${a.metadata.namespace}/${a.metadata.name}`, `${b.metadata.namespace}/${b.metadata.name}`),
  );
  const pvs = [...(input.persistentVolumes ?? [])].sort((a, b) => compareText(a.metadata.name, b.metadata.name));

  const nodeById = new Map<string, TopologyNode>();
  const putNode = (node: TopologyNode) => {
    if (!nodeById.has(node.id)) nodeById.set(node.id, node);
  };

  const vcnId = data.cluster.ok ? data.cluster.data["vcn-id"] : undefined;
  if (vcnId) {
    const vcn = okEntry(data.vcns, vcnId);
    putNode({
      id: vcnId,
      kind: "vcn",
      label: vcn?.["display-name"] ?? vcnId,
      status: statusOf(vcn?.["lifecycle-state"]),
      detail: detailOf([
        text("Name", vcn?.["display-name"]),
        text("OCID", vcnId, "ocid"),
        text("State", vcn?.["lifecycle-state"]),
        vcn ? list("CIDR", vcnCidrs(vcn), "cidr") : undefined,
      ]),
      consoleUrl: consoleUrlOf("vcn", vcnId),
    });
  }

  const vcnParentId = vcnId && nodeById.has(vcnId) ? vcnId : undefined;
  const subnets = okEntries(data.subnets)
    .filter(([, subnet]) => !vcnId || !subnet["vcn-id"] || subnet["vcn-id"] === vcnId)
    .sort((a, b) => compareText(a[0], b[0]));
  const subnetById = new Map(subnets);

  const k8sNodeByInstanceId = new Map<string, TopologyK8sNode>();
  for (const node of k8sNodes) {
    const parsed = parseProviderId(node.spec?.providerID);
    if (parsed.isOke && !k8sNodeByInstanceId.has(parsed.instanceId)) {
      k8sNodeByInstanceId.set(parsed.instanceId, node);
    }
  }
  const instances = (data.instances.ok ? data.instances.data : [])
    .filter((instance) => k8sNodeByInstanceId.has(instance.id))
    .sort((a, b) => compareText(a.id, b.id));
  const instanceIps = new Map<string, string[]>();
  const instanceParent = new Map<string, string>();
  for (const instance of instances) {
    const k8sNode = k8sNodeByInstanceId.get(instance.id);
    const internalIps = k8sNode ? internalIpsOf(k8sNode) : [];
    const matchedSubnets = subnets
      .filter(([, subnet]) => subnetCidrs(subnet).some((cidr) => internalIps.some((ip) => ipInCidr(ip, cidr))))
      .map(([subnetId]) => subnetId);
    instanceIps.set(instance.id, k8sNode ? allIpsOf(k8sNode) : []);
    // 0件一致・複数一致はどちらも配置根拠が立たない(Unplaced領域へ落とす)
    const placed = matchedSubnets.length === 1 ? matchedSubnets[0] : undefined;
    if (placed) instanceParent.set(instance.id, placed);
  }

  const nodeIps = internalIpsOfNodes(k8sNodes);
  const serviceInputs = services.filter((service) => service.spec.type === "LoadBalancer").map(serviceMatchInput);
  const lbIds = clusterLbIds(data, ingressIpsOfServices(services), nodeIps);
  const view = buildNetworkView(data, lbIds);
  const lbRows = [...view.lbRows].sort((a, b) => compareText(a.id, b.id));
  const placeLb = (row: LbRow): string | undefined =>
    row.subnetIds.filter((subnetId) => subnetById.has(subnetId)).sort(compareText)[0];
  const lbParent = new Map<string, string>();
  for (const row of lbRows) {
    const placed = placeLb(row);
    if (placed) lbParent.set(row.id, placed);
  }

  const endpointSubnetId = data.cluster.ok ? data.cluster.data["endpoint-config"]?.["subnet-id"] : undefined;
  const shownSubnetIds = new Set<string>([...instanceParent.values(), ...lbParent.values()]);
  if (endpointSubnetId && subnetById.has(endpointSubnetId)) shownSubnetIds.add(endpointSubnetId);
  const shownSubnets = subnets.filter(([subnetId]) => shownSubnetIds.has(subnetId));
  for (const [subnetId, subnet] of shownSubnets) {
    putNode({
      id: subnetId,
      kind: "subnet",
      label: subnet["display-name"] ?? subnetId,
      parentId: vcnParentId,
      status: statusOf(subnet["lifecycle-state"]),
      detail: detailOf([
        text("Name", subnet["display-name"]),
        text("OCID", subnetId, "ocid"),
        text("State", subnet["lifecycle-state"]),
        list("CIDR", subnetCidrs(subnet), "cidr"),
        text("Route Table", subnet["route-table-id"]),
        list("Security Lists", subnet["security-list-ids"] ?? []),
      ]),
      consoleUrl: vcnId ? consoleUrlOf("subnet", subnetId, vcnId) : undefined,
    });
  }
  const otherSubnets = subnets.filter(([subnetId]) => !shownSubnetIds.has(subnetId));
  if (vcnParentId && otherSubnets.length > 0) {
    putNode({
      id: SUBNET_SUMMARY_ID,
      kind: "subnet-summary",
      label: `${otherSubnets.length} subnets not shown`,
      parentId: vcnParentId,
      status: "unknown",
      // 1 Subnet = 1行
      detail: detailOf(
        [...otherSubnets]
          .sort((a, b) => compareText(a[1]["display-name"] ?? a[0], b[1]["display-name"] ?? b[0]))
          .map(([subnetId, subnet]) => text(subnetRowLabel(subnetId, subnet), subnetId, "ocid")),
      ),
      count: otherSubnets.length,
    });
  }

  for (const instance of instances) {
    const k8sNode = k8sNodeByInstanceId.get(instance.id);
    putNode({
      id: instance.id,
      kind: "instance",
      label: instance["display-name"] ?? instance.id,
      parentId: instanceParent.get(instance.id),
      status: statusOf(instance["lifecycle-state"]),
      detail: detailOf([
        text("Name", instance["display-name"]),
        text("OCID", instance.id, "ocid"),
        text("State", instance["lifecycle-state"]),
        text("Shape", instance.shape),
        text("Node", k8sNode?.metadata.name),
        text("Availability Domain", instance["availability-domain"]),
      ]),
      consoleUrl: consoleUrlOf("instance", instance.id),
    });
  }

  for (const row of lbRows) {
    putNode({
      id: row.id,
      kind: row.kind,
      label: row.displayName ?? row.id,
      parentId: lbParent.get(row.id),
      status: statusOf(row.lifecycleState),
      detail: detailOf([
        text("Name", row.displayName),
        text("OCID", row.id, "ocid"),
        text("State", row.lifecycleState),
        list("IP Addresses", row.ips),
        list("Subnets", row.subnetIds),
        list("NSGs", row.nsgIds),
      ]),
      consoleUrl: consoleUrlOf(row.kind, row.id),
    });
  }
  for (const waf of [...view.wafRows].sort((a, b) => compareText(a.id, b.id))) {
    putNode({
      id: waf.id,
      kind: "waf",
      label: waf.displayName ?? waf.id,
      status: statusOf(waf.lifecycleState),
      detail: detailOf([
        text("Name", waf.displayName),
        text("OCID", waf.id, "ocid"),
        text("State", waf.lifecycleState),
        text("Policy", waf.policyId),
        text("Target LB", waf.targetLbName ?? waf.targetLbId),
      ]),
      consoleUrl: waf.policyId ? consoleUrlOf("waf", waf.id, waf.policyId) : undefined,
    });
  }

  const routeTableById = new Map(okEntries(data.routeTables));
  // 図に出すSubnetのRTから辿れるゲートウェイだけをノード化する(共有VCNでは無関係なRTが大量に来る)。
  const shownRouteTables = [
    ...new Set(shownSubnets.map(([, subnet]) => subnet["route-table-id"]).filter((id): id is string => !!id)),
  ]
    .sort(compareText)
    .map((routeTableId) => routeTableById.get(routeTableId))
    .filter((routeTable) => routeTable !== undefined);
  const gatewayIds = gatewayIdsOfRouteTables(shownRouteTables).sort(compareText);
  for (const gatewayId of gatewayIds) {
    const gateway = okEntry(data.gateways, gatewayId);
    putNode({
      id: gatewayId,
      kind: "gateway",
      label: gateway?.displayName ?? gatewayId,
      parentId: vcnParentId,
      status: statusOf(gateway?.lifecycleState),
      detail: detailOf([
        text("Name", gateway?.displayName),
        text("OCID", gatewayId, "ocid"),
        text("State", gateway?.lifecycleState),
        text("Type", gateway?.kind ?? routeEntityKind(gatewayId)),
        gateway ? text("Health", gatewayHealth(gateway).label) : undefined,
      ]),
      consoleUrl: gatewayConsoleUrlOf(gatewayId, vcnParentId),
    });
  }

  for (const service of serviceInputs) {
    putNode({
      id: `k8s-service:${service.namespace}/${service.name}`,
      kind: "k8s-service",
      label: `${service.namespace}/${service.name}`,
      status: "unknown",
      detail: detailOf([
        text("Name", service.name),
        text("Namespace", service.namespace),
        list("Ingress IPs", service.ingressIps),
        text("External Traffic Policy", service.externalTrafficPolicy),
      ]),
    });
  }

  interface PvLink {
    pvNodeId: string;
    storageNodeId?: string;
  }
  const pvLinks: PvLink[] = [];
  for (const pv of pvs) {
    const csi = getCsiSource(pv.spec);
    const resolution = resolvePvStorage(csi?.driver, csi?.volumeHandle);
    if (resolution.kind === "unsupported" || !resolution.ocid) continue;
    const pvNodeId = `k8s-pv:${pv.metadata.name}`;
    const orphaned = isOrphanedPvStorage(resolution, data);
    putNode({
      id: pvNodeId,
      kind: "k8s-pv",
      label: pv.metadata.name,
      status: orphaned ? "warning" : "unknown",
      detail: detailOf([
        text("Name", pv.metadata.name),
        text("Kind", resolution.kind === "block_volume" ? "Block Volume" : "FSS"),
        orphaned ? { label: ORPHAN_DETAIL_LABEL, value: ORPHAN_DETAIL_VALUE[orphaned] } : undefined,
        text("Volume Handle", csi?.volumeHandle),
        text("Capacity", pv.spec.capacity?.storage),
      ]),
      consoleUrl: orphaned ? undefined : pvStorageConsoleUrlOf(resolution, data.fssExports),
    });
    const ocid = resolution.ocid;
    if (resolution.kind === "block_volume") {
      const volume = data.volumes.ok ? data.volumes.data.find((candidate) => candidate.id === ocid) : undefined;
      if (!volume) {
        pvLinks.push({ pvNodeId });
        continue;
      }
      const assignment = okEntry(data.volumeBackupPolicies, ocid);
      const policyId = assignment?.policyId;
      putNode({
        id: ocid,
        kind: "volume",
        label: volume["display-name"] ?? ocid,
        status: statusOf(volume["lifecycle-state"]),
        detail: detailOf([
          text("Name", volume["display-name"]),
          text("OCID", ocid, "ocid"),
          text("State", volume["lifecycle-state"]),
          text("Size", volume["size-in-gbs"] === undefined ? undefined : `${volume["size-in-gbs"]} GB`),
          text("Backup Policy", assignment ? (assignment.policyName ?? "None") : undefined),
        ]),
        consoleUrl: consoleUrlOf("volume", ocid),
      });
      if (policyId) {
        putNode({
          id: policyId,
          kind: "backup-policy",
          label: assignment?.policyName ?? policyId,
          status: "unknown",
          detail: detailOf([text("Name", assignment?.policyName), text("OCID", policyId, "ocid")]),
          consoleUrl: consoleUrlOf("volume-backup-policy", policyId),
        });
      }
      pvLinks.push({ pvNodeId, storageNodeId: ocid });
      continue;
    }
    // volumeHandleがExport OCIDのPVはexport応答経由でしかFileSystem OCIDに辿り着けない。
    const fileSystemId = fileSystemOcidOf(ocid, data.fssExports);
    const fileSystem = fileSystemId ? okEntry(data.fileSystems, fileSystemId) : undefined;
    if (!fileSystemId || !fileSystem) {
      pvLinks.push({ pvNodeId });
      continue;
    }
    const policyId = fileSystem["filesystem-snapshot-policy-id"];
    const policyName = okEntry(data.fssSnapshotPolicies, policyId)?.policyName;
    putNode({
      id: fileSystemId,
      kind: "filesystem",
      label: fileSystem["display-name"] ?? fileSystemId,
      status: statusOf(fileSystem["lifecycle-state"]),
      detail: detailOf([
        text("Name", fileSystem["display-name"]),
        text("OCID", fileSystemId, "ocid"),
        text("State", fileSystem["lifecycle-state"]),
        text("Snapshot Policy", policyId ? (policyName ?? policyId) : "None"),
      ]),
      consoleUrl: consoleUrlOf("filesystem", fileSystemId),
    });
    if (policyId) {
      putNode({
        id: policyId,
        kind: "snapshot-policy",
        label: policyName ?? policyId,
        status: "unknown",
        detail: detailOf([text("Name", policyName), text("OCID", policyId, "ocid")]),
        consoleUrl: consoleUrlOf("fss-snapshot-policy", policyId),
      });
    }
    pvLinks.push({ pvNodeId, storageNodeId: fileSystemId });
  }

  const groupOf = new Map<string, string>();
  for (const [subnetId] of shownSubnets) {
    if (expanded.has(subnetId)) continue;
    const memberIds = instances
      .filter((instance) => nodeById.get(instance.id)?.parentId === subnetId)
      .map((instance) => instance.id);
    if (memberIds.length <= AGGREGATE_THRESHOLD) continue;
    const members = memberIds.map((memberId) => nodeById.get(memberId)).filter((node) => node !== undefined);
    for (const memberId of memberIds) nodeById.delete(memberId);
    const groupId = `instance-group:${subnetId}`;
    for (const memberId of memberIds) groupOf.set(memberId, groupId);
    putNode({
      id: groupId,
      kind: "instance-group",
      label: `${memberIds.length} nodes`,
      parentId: subnetId,
      status: "unknown",
      detail: [
        { label: "Instances", value: String(memberIds.length) },
        // 畳んだInstanceの値を持たせない場合、その名前・OCIDで集約ノードを検索できなくなる。
        ...members.map((member) => ({ label: "Member", value: memberDetailValue(member) })),
      ],
      memberIds,
      count: memberIds.length,
    });
  }

  const edgeById = new Map<string, TopologyEdge>();
  const putEdge = (kind: TopologyEdgeKind, source: string, target: string) => {
    const from = groupOf.get(source) ?? source;
    const to = groupOf.get(target) ?? target;
    if (from === to || !nodeById.has(from) || !nodeById.has(to)) return;
    const id = `${kind}|${from}|${to}`;
    if (!edgeById.has(id)) edgeById.set(id, { id, source: from, target: to, kind });
  };

  const targetsByIp = new Map<string, string[]>();
  const addTarget = (ip: string, nodeId: string) => {
    const targets = targetsByIp.get(ip);
    if (targets) {
      if (!targets.includes(nodeId)) targets.push(nodeId);
      return;
    }
    targetsByIp.set(ip, [nodeId]);
  };
  for (const instance of instances) {
    for (const ip of instanceIps.get(instance.id) ?? []) addTarget(ip, instance.id);
  }
  for (const row of lbRows) {
    for (const ip of row.ips) addTarget(ip, row.id);
  }

  const backendIpsById = new Map<string, string[]>();
  if (data.lbs.ok) for (const lb of data.lbs.data) backendIpsById.set(lb.id, backendIpsOf(lb["backend-sets"]));
  if (data.nlbs.ok) for (const nlb of data.nlbs.data) backendIpsById.set(nlb.id, backendIpsOf(nlb["backend-sets"]));
  for (const row of lbRows) {
    const backendIps = [...new Set(backendIpsById.get(row.id) ?? [])].sort(compareText);
    for (const ip of backendIps) {
      for (const targetId of [...(targetsByIp.get(ip) ?? [])].sort(compareText)) putEdge("backend", row.id, targetId);
    }
  }

  for (const waf of view.wafRows) putEdge("waf-lb", waf.id, waf.targetLbId);

  const candidates: LoadBalancerCandidate[] = lbRows.map((row) => ({ ocid: row.id, kind: row.kind, ips: row.ips }));
  for (const match of matchServicesToLoadBalancers(serviceInputs, candidates)) {
    if (!match.loadBalancer) continue;
    putEdge("service-lb", `k8s-service:${match.service.namespace}/${match.service.name}`, match.loadBalancer.ocid);
  }

  for (const link of pvLinks) {
    if (link.storageNodeId) putEdge("pv-storage", link.pvNodeId, link.storageNodeId);
  }
  for (const node of [...nodeById.values()].sort(compareNodes)) {
    if (node.kind === "volume") {
      const policyId = okEntry(data.volumeBackupPolicies, node.id)?.policyId;
      if (policyId) putEdge("volume-backup", node.id, policyId);
    }
    if (node.kind === "filesystem") {
      const policyId = okEntry(data.fileSystems, node.id)?.["filesystem-snapshot-policy-id"];
      if (policyId) putEdge("fss-snapshot", node.id, policyId);
    }
  }

  for (const [subnetId, subnet] of shownSubnets) {
    const routeTableId = subnet["route-table-id"];
    const routeTable = routeTableId ? routeTableById.get(routeTableId) : undefined;
    for (const rule of routeTable?.["route-rules"] ?? []) {
      const entityId = rule["network-entity-id"];
      if (isSupportedGatewayId(entityId)) putEdge("route", subnetId, entityId);
    }
  }

  return {
    nodes: [...nodeById.values()].sort(compareNodes),
    edges: [...edgeById.values()].sort((a, b) => compareText(a.id, b.id)),
    missing: missingOf(failedSectionsOf(data, input.failedSections)),
  };
}
