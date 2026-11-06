import type { ClusterOciData } from "../fetch/fetch";
import type { OciResult } from "../oci/result";
import type {
  OciBackendSetHealthView,
  OciBackupPolicyView,
  OciInstance,
  OciNodePoolSummary,
  OciSubnet,
  OciVcn,
  OciVnic,
  OciVolume,
} from "../oci/types";
import {
  backendHealthByIp,
  backendHealthKey,
  type EdgeHealthLevel,
  NO_LOCAL_POD_HEALTH,
  unlistedBackendHealth,
  worseBackendHealth,
} from "./backend-health";
import { ipInCidr } from "./cidr";
import {
  CLUSTER_TAG_MISMATCH_LABEL,
  type ClusterTagMismatch,
  type ClusterTagSource,
  clusterTagMismatchesOf,
} from "./cluster-tag";
import { buildConsoleUrl, type OciConsoleResourceType } from "./console-url";
import {
  type GatewayKind,
  gatewayHealth,
  gatewayIdsOfRouteTables,
  gatewayKindOf,
  isSupportedGatewayId,
} from "./gateway-status";
import { placementSummary, shapeSummary, shapeText } from "./instance-shape";
import { isAbnormalLifecycleState, isAttachedState } from "./lifecycle-state";
import {
  type EndpointSliceInput,
  isLocalTrafficPolicy,
  isNoLocalPod,
  readyEndpointNodesOf,
  serviceKey,
} from "./local-traffic-policy";
import { pushToMap, pushUniqueToMap } from "./map-list";
import {
  backendSetIpsOf,
  buildNetworkView,
  clusterLbIds,
  internalIpsOfNodes,
  type LbRow,
  routeEntityKind,
} from "./network-path";
import { nodePoolIdsByInstance, resolveNodePoolId } from "./node-pool";
import { extractRegionFromOcid } from "./ocid-region";
import { TOPOLOGY_SECTIONS, type TopologySection } from "./page-sections";
import { parseProviderId } from "./provider-id";
import {
  type CsiSource,
  type FssFileSystemRef,
  fssFileSystemRefOf,
  getCsiSource,
  isFssExportOcid,
  isOrphanedPvStorage,
  type PvStorageOrphan,
  type PvStorageResolution,
  resolvePvStorage,
} from "./pv-storage";
import {
  ingressIpsOfServices,
  type LoadBalancerCandidate,
  matchServicesToLoadBalancers,
  type ServiceLbMatch,
  type ServiceLbMatchInput,
} from "./service-lb";
import { compareNodes, compareText, TOPOLOGY_NODE_KINDS, type TopologyNodeKind } from "./topology-order";
import {
  SECURITY_EDGE_KINDS,
  type SecurityGraphInput,
  type SecurityPeer,
  type SecurityRuleSet,
  securityLinksOf,
  summarizePorts,
} from "./topology-security";

export const TOPOLOGY_EDGE_KINDS = [
  "backend",
  "waf-lb",
  "service-lb",
  "pv-storage",
  "attachment",
  "volume-backup",
  "fss-snapshot",
  "route",
  ...SECURITY_EDGE_KINDS,
] as const;

export type TopologyEdgeKind = (typeof TOPOLOGY_EDGE_KINDS)[number];

export type TopologyEdgeHealth = EdgeHealthLevel;

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
  /** ラベルに添える1行の要約。読むのはMermaid出力だけで、画面のコンテナ副題はdetailのCIDRから別に組む */
  summary?: string;
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
  /** backendエッジのみ: 対応するbackend set healthの状態(ヘルス未取得はundefined) */
  health?: TopologyEdgeHealth;
  /** 種別名の代わりに線へ添える文言。持たないエッジは種別名で描かれる */
  label?: string;
}

export interface TopologySecurityStats {
  /** 集約前: ルール1件 × 相手ノード1件 で数えたリンク数 */
  links: number;
  /** 集約後のエッジ数 */
  edges: number;
}

/**
 * 取得失敗で図に出せなかった種別。sectionsは由来する失敗セクション(TOPOLOGY_SECTIONS順)。
 * target="detail"はノード自体は出るが詳細・配置根拠が欠ける劣化を表す。
 */
export interface TopologyMissing {
  target: "node" | "edge" | "detail";
  kind: TopologyNodeKind | TopologyEdgeKind;
  sections: TopologySection[];
}

export interface TopologyLocalTrafficStats {
  /** 判定材料として読めたEndpointSliceの件数 */
  endpointSlices: number;
  /** LBに対応づいたServiceのうちexternalTrafficPolicyがLocalの数(namespace/name重複排除) */
  localServices: number;
  /** critical/warningからno-local-podへ格下げしたbackendエッジ数 */
  downgraded: number;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  missing: TopologyMissing[];
  /** 通信許可エッジの集約前後の本数 */
  security?: TopologySecurityStats;
  /** backendエッジ格下げの成立度合い(不発動時の切り分け用) */
  localTraffic?: TopologyLocalTrafficStats;
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

export type TopologyK8sEndpointSlice = EndpointSliceInput;

export interface TopologyGraphInput {
  data: ClusterOciData;
  nodes?: readonly TopologyK8sNode[];
  services?: readonly TopologyK8sService[];
  persistentVolumes?: readonly TopologyK8sPv[];
  /** backendエッジの格下げ判定材料。省略・空ならcritical/warningは格下げされない */
  endpointSlices?: readonly TopologyK8sEndpointSlice[];
  /** 集約ノードを展開して個々のInstanceを出すSubnet OCID */
  expandedSubnetIds?: ReadonlySet<string>;
  /** list自体の失敗などClusterOciDataのエントリからは読めない失敗セクション */
  failedSections?: readonly TopologySection[];
  /** 省略時は別クラスタを指すタグを判定しない */
  clusterId?: string;
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
  volume: ["volumes", "volumeAttachments"],
  filesystem: ["fileSystems"],
  "backup-policy": ["volumeBackupPolicies"],
  "snapshot-policy": ["fssSnapshotPolicies"],
};

const EDGE_KIND_SECTIONS: Record<TopologyEdgeKind, readonly TopologySection[]> = {
  backend: ["taggedResources", "lbs", "nlbs", "instances"],
  "waf-lb": ["taggedResources", "wafs", "lbs"],
  "service-lb": ["taggedResources", "lbs", "nlbs"],
  "pv-storage": ["volumes", "fileSystems"],
  attachment: ["instances", "volumeAttachments"],
  "volume-backup": ["volumes", "volumeBackupPolicies"],
  "fss-snapshot": ["fileSystems", "fssSnapshotPolicies"],
  route: ["subnets", "routeTables", "gateways"],
  // vcn: CIDRが読めない間は通信許可エッジを出さない(広すぎるsourceを捨てられない)。
  "sl-allow": ["vcn", "subnets", "securityLists"],
  "nsg-allow": ["vcn", "taggedResources", "instances", "lbs", "nlbs", "nodePools", "nsgs"],
};

/** ノードは出るが情報が欠ける種別と、その根拠セクション。 */
const DETAIL_KIND_SECTIONS: Partial<Record<TopologyNodeKind, readonly TopologySection[]>> = {
  // VNICはInstanceの配置(所属Subnet)とIP表示の根拠。欠けてもInstanceノード自体はinstances listで出る。
  instance: ["vnics"],
};

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

/** 1行に収めるCIDR要約。IPv6併記などで複数あるときは先頭CIDR + 残り件数にする。 */
export function cidrSummary(cidrs: readonly string[]): string | undefined {
  const head = cidrs[0];
  if (head === undefined) return undefined;
  return cidrs.length > 1 ? `${head} +${cidrs.length - 1}` : head;
}

function statusOf(lifecycleState: string | undefined): TopologyNodeStatus {
  if (lifecycleState === undefined) return "unknown";
  return isAbnormalLifecycleState(lifecycleState) ? "warning" : "ok";
}

interface ClusterTagView {
  status: TopologyNodeStatus;
  detail: TopologyDetail[];
}

const INSTANCE_CLUSTER_TAG_SOURCES: readonly ClusterTagSource[] = ["system-tag"];

function clusterTagViewOf(
  lifecycleStatus: TopologyNodeStatus,
  mismatches: readonly ClusterTagMismatch[],
): ClusterTagView {
  return {
    status: mismatches.length > 0 ? "warning" : lifecycleStatus,
    detail: mismatches.map((mismatch) => ({
      label: CLUSTER_TAG_MISMATCH_LABEL[mismatch.source],
      value: mismatch.clusterId,
      role: "ocid",
    })),
  };
}

/** 集約ノードに畳んだInstance 1件分の値(表示・検索とも改行区切りの1エントリで持つ)。 */
function memberDetailValue(member: TopologyNode): string {
  return [...new Set([member.label, ...member.detail.map((row) => row.value)])].join("\n");
}

/** ノードプールの設定台数。0台のプールも「0」と出すため、未取得(undefined)とだけ書き分ける。 */
function poolSizeText(pool: OciNodePoolSummary | undefined): string | undefined {
  const size = pool?.["node-config-details"]?.size;
  return size === undefined ? undefined : String(size);
}

/** ラベル2行目。複数の要約を1行へ並べる。 */
function summaryOf(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((part): part is string => !!part);
  return kept.length > 0 ? kept.join(" · ") : undefined;
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

// 実体を確認できなかった参照先(resource_not_found)は取得の失敗ではなく孤立PVの観測結果。欠落バナーへ載せない。
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
  mark("vnics", isFailed(data.vnicAttachments) || hasFailedEntry(data.vnics));
  mark("nodePools", isFailed(data.nodePools));
  mark("lbs", isFailed(data.lbs));
  mark("nlbs", isFailed(data.nlbs));
  mark("wafs", isFailed(data.wafs));
  mark("volumes", isFailed(data.volumes));
  mark("volumeAttachments", isFailed(data.volumeAttachments));
  mark("volumeBackupPolicies", hasFailedEntry(data.volumeBackupPolicies));
  mark("fileSystems", hasFailedEntry(data.fileSystems) || hasFailedEntry(data.fssExports));
  mark("fssSnapshotPolicies", hasFailedEntry(data.fssSnapshotPolicies));
  mark("vcn", hasFailedEntry(data.vcns));
  mark("subnets", hasFailedEntry(data.subnets));
  mark("routeTables", hasFailedEntry(data.routeTables));
  mark("securityLists", hasFailedEntry(data.securityLists));
  mark("nsgs", hasFailedEntry(data.nsgs));
  mark("gateways", hasFailedEntry(data.gateways));
  for (const section of extra ?? []) failed.add(section);
  return failed;
}

function missingOf(failed: ReadonlySet<TopologySection>): TopologyMissing[] {
  const missing: TopologyMissing[] = [];
  const push = (
    target: TopologyMissing["target"],
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
  for (const kind of TOPOLOGY_NODE_KINDS) {
    const sections = DETAIL_KIND_SECTIONS[kind];
    if (sections) push("detail", kind, sections);
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

// 種別名(topology-flowのEDGE_KIND_LABEL)に推定の印を足した文言。flow側はこのモジュールを読むため参照できない。
const PV_STORAGE_INFERRED_EDGE_LABEL = "PV → Storage (inferred)";

const ORPHAN_DETAIL_VALUE: Record<PvStorageOrphan["kind"], Record<PvStorageOrphan["certainty"], string>> = {
  volume: {
    absent: "Referenced volume does not exist in OCI (orphaned PV)",
    forbidden: "Referenced volume exists in OCI but is not readable (insufficient permission)",
    unknown: "Referenced volume not found in OCI or not readable (unconfirmed)",
  },
  filesystem: {
    absent: "Referenced file system does not exist in OCI (orphaned PV)",
    forbidden: "Referenced file system exists in OCI but is not readable (insufficient permission)",
    unknown: "Referenced file system not found in OCI or not readable (unconfirmed)",
  },
  export: {
    absent: "Referenced FSS export does not exist (file system may still exist)",
    forbidden: "Referenced FSS export exists but is not readable (insufficient permission)",
    unknown: "Referenced FSS export not found or not readable (file system may still exist)",
  },
};

/** PVの参照先ストレージのコンソールURL。孤立PVは呼び出し元で除く(実体が無いのでコンソールも404になる)。 */
function pvStorageConsoleUrlOf(
  resolution: PvStorageResolution,
  fssRef: FssFileSystemRef | undefined,
): string | undefined {
  const ocid = resolution.ocid;
  if (!ocid) return undefined;
  if (resolution.kind === "block_volume") return consoleUrlOf("volume", ocid);
  const fileSystemId = fssRef?.fileSystemId;
  return fileSystemId ? consoleUrlOf("filesystem", fileSystemId) : undefined;
}

const FSS_INFERRED_DETAIL: TopologyDetail = {
  label: "FSS Match",
  value: "Inferred from volumeHandle OCID (not matched by mount target IP and export path)",
};

function fssRefDetail(ref: FssFileSystemRef | undefined): TopologyDetail | undefined {
  if (!ref) return undefined;
  if (ref.inferred) return FSS_INFERRED_DETAIL;
  const handleOcid = ref.conflictingHandleOcid;
  if (!handleOcid) return undefined;
  const target = isFssExportOcid(handleOcid) ? "a different export" : "a different file system";
  return { label: "Note", value: `volumeHandle OCID points to ${target} (${handleOcid})` };
}

/**
 * Volumeの詳細に出すバックアップポリシー行。
 * 照会が走っていないVolume(一覧に無くattachment経由で出たもの)は「None」(照会済み・未割当)と書き分ける。
 */
function backupPolicyText(
  policies: Record<string, OciResult<OciBackupPolicyView>>,
  volumeId: string,
): string | undefined {
  const result = policies[volumeId] as OciResult<OciBackupPolicyView> | undefined;
  if (!result) return "Not queried";
  if (!result.ok) return undefined;
  return result.data.policyName ?? "None";
}

/** per-OCID Mapの成功データ(未取得・失敗はundefined)。 */
function okEntry<T>(record: Record<string, OciResult<T>>, id: string | undefined): T | undefined {
  if (!id) return undefined;
  const result = record[id] as OciResult<T> | undefined;
  return result?.ok ? result.data : undefined;
}

function backendHealthOfLb(
  row: LbRow,
  setIps: ReadonlyMap<string, string[]> | undefined,
  healths: Record<string, OciResult<OciBackendSetHealthView>>,
): Map<string, TopologyEdgeHealth> {
  const byIp = new Map<string, TopologyEdgeHealth>();
  for (const [backendSetName, ips] of setIps ?? []) {
    const result = healths[backendHealthKey(row.kind, row.id, backendSetName)] as
      | OciResult<OciBackendSetHealthView>
      | undefined;
    if (!result?.ok) continue;
    const levels = backendHealthByIp(result.data);
    for (const ip of ips) {
      const merged = worseBackendHealth(byIp.get(ip), levels.get(ip) ?? unlistedBackendHealth(result.data));
      if (merged) byIp.set(ip, merged);
    }
  }
  return byIp;
}

/**
 * Instance OCID→primary VNIC。primaryが1つも取れないInstanceは載らない
 * (secondary VNICのsubnetを配置根拠にすると、実際とは違うSubnetへ置く)。
 */
function primaryVnicByInstance(data: ClusterOciData): Map<string, OciVnic> {
  const byInstance = new Map<string, OciVnic>();
  if (!data.vnicAttachments.ok) return byInstance;
  for (const attachment of [...data.vnicAttachments.data].sort((a, b) => compareText(a.id, b.id))) {
    const instanceId = attachment["instance-id"];
    const vnicId = attachment["vnic-id"];
    if (!instanceId || !vnicId || byInstance.has(instanceId)) continue;
    if (!isAttachedState(attachment["lifecycle-state"])) continue;
    const vnic = okEntry(data.vnics, vnicId);
    if (vnic?.["is-primary"]) byInstance.set(instanceId, vnic);
  }
  return byInstance;
}

type PutEdge = (
  kind: TopologyEdgeKind,
  source: string,
  target: string,
  health?: TopologyEdgeHealth,
) => string | undefined;

interface PvLink {
  pvNodeId: string;
  storageNodeId?: string;
  /** FSSのみ: IP:pathで照合できず、volumeHandle先頭のOCIDから推定した参照 */
  inferred?: boolean;
}

interface VolumeLink {
  instanceId: string;
  volumeId: string;
}

interface StorageNodeInput {
  data: ClusterOciData;
  clusterId: string | undefined;
  pvs: readonly TopologyK8sPv[];
  instances: readonly OciInstance[];
  putNode: (node: TopologyNode) => void;
}

interface StorageNodeResult {
  pvLinks: PvLink[];
  volumeLinks: VolumeLink[];
}

/** 返すのは後段でエッジへ変換するリンク候補で、ノード側はputNodeへ流し込む。 */
function buildStorageNodes(input: StorageNodeInput): StorageNodeResult {
  const { clusterId, data, instances, putNode, pvs } = input;
  const volumeById = new Map<string, OciVolume>(
    (data.volumes.ok ? data.volumes.data : []).map((volume) => [volume.id, volume]),
  );
  // Volume一覧に無いOCIDでもノードは作る(attachment経由の参照。名前・容量が無いだけで実体はある)。
  const putVolumeNode = (volumeId: string) => {
    const volume = volumeById.get(volumeId);
    const sizeText = volume?.["size-in-gbs"] === undefined ? undefined : `${volume["size-in-gbs"]} GB`;
    const tagView = clusterTagViewOf(statusOf(volume?.["lifecycle-state"]), clusterTagMismatchesOf(volume, clusterId));
    putNode({
      id: volumeId,
      kind: "volume",
      label: volume?.["display-name"] ?? volumeId,
      summary: sizeText,
      status: tagView.status,
      detail: detailOf([
        text("Name", volume?.["display-name"]),
        text("OCID", volumeId, "ocid"),
        text("State", volume?.["lifecycle-state"]),
        ...tagView.detail,
        text("Size", sizeText),
        text("Backup Policy", backupPolicyText(data.volumeBackupPolicies, volumeId)),
      ]),
      consoleUrl: consoleUrlOf("volume", volumeId),
    });
  };

  const pvLinks: PvLink[] = [];
  for (const pv of pvs) {
    const csi = getCsiSource(pv.spec);
    const resolution = resolvePvStorage(csi?.driver, csi?.volumeHandle);
    if (resolution.kind === "unsupported" || !resolution.ocid) continue;
    const pvNodeId = `k8s-pv:${pv.metadata.name}`;
    const orphaned = isOrphanedPvStorage(resolution, data);
    const fssRef = resolution.kind === "file_system" ? fssFileSystemRefOf(resolution, data) : undefined;
    putNode({
      id: pvNodeId,
      kind: "k8s-pv",
      label: pv.metadata.name,
      status: orphaned ? "warning" : "unknown",
      detail: detailOf([
        text("Name", pv.metadata.name),
        text("Kind", resolution.kind === "block_volume" ? "Block Volume" : "FSS"),
        orphaned
          ? { label: ORPHAN_DETAIL_LABEL, value: ORPHAN_DETAIL_VALUE[orphaned.kind][orphaned.certainty] }
          : undefined,
        orphaned === false || !orphaned.byMountPath ? fssRefDetail(fssRef) : undefined,
        text("Volume Handle", csi?.volumeHandle),
        text("Capacity", pv.spec.capacity?.storage),
      ]),
      consoleUrl: orphaned ? undefined : pvStorageConsoleUrlOf(resolution, fssRef),
    });
    const ocid = resolution.ocid;
    if (resolution.kind === "block_volume") {
      // 実在しないノード宛てのエッジはputEdgeが捨てるため、常に積んでよい
      // (attachment経由でVolumeノードが生まれた回だけ合流する)。
      pvLinks.push({ pvNodeId, storageNodeId: ocid });
      // Volume一覧に無いPV参照は孤立PVの観測結果のため、ここではノードを作らない。
      if (!volumeById.has(ocid)) continue;
      putVolumeNode(ocid);
      const assignment = okEntry(data.volumeBackupPolicies, ocid);
      const policyId = assignment?.policyId;
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
      continue;
    }
    const fileSystemId = fssRef?.fileSystemId;
    const inferred = fssRef?.inferred ?? false;
    const fileSystem = fileSystemId ? okEntry(data.fileSystems, fileSystemId) : undefined;
    if (!fileSystemId || !fileSystem) {
      pvLinks.push({ pvNodeId, inferred });
      continue;
    }
    const policyId = fileSystem["filesystem-snapshot-policy-id"];
    const policyName = okEntry(data.fssSnapshotPolicies, policyId)?.policyName;
    // タグはIP:pathで照合した実体(fileSystemId)のもの。volumeHandle先頭のOCIDが指す側ではない。
    const fsTagView = clusterTagViewOf(
      statusOf(fileSystem["lifecycle-state"]),
      clusterTagMismatchesOf(fileSystem, clusterId),
    );
    putNode({
      id: fileSystemId,
      kind: "filesystem",
      label: fileSystem["display-name"] ?? fileSystemId,
      status: fsTagView.status,
      detail: detailOf([
        text("Name", fileSystem["display-name"]),
        text("OCID", fileSystemId, "ocid"),
        text("State", fileSystem["lifecycle-state"]),
        ...fsTagView.detail,
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
    pvLinks.push({ pvNodeId, storageNodeId: fileSystemId, inferred });
  }

  const instanceIds = new Set(instances.map((instance) => instance.id));
  const volumeLinks: VolumeLink[] = [];
  const seenVolumeLinks = new Set<string>();
  for (const attachment of (data.volumeAttachments.ok ? data.volumeAttachments.data : [])
    .slice()
    .sort((a, b) => compareText(a.id, b.id))) {
    const instanceId = attachment["instance-id"];
    const volumeId = attachment["volume-id"];
    if (!instanceId || !volumeId || !instanceIds.has(instanceId)) continue;
    if (!isAttachedState(attachment["lifecycle-state"])) continue;
    const key = `${instanceId}|${volumeId}`;
    if (seenVolumeLinks.has(key)) continue;
    seenVolumeLinks.add(key);
    volumeLinks.push({ instanceId, volumeId });
    putVolumeNode(volumeId);
  }

  return { pvLinks, volumeLinks };
}

interface InstanceGroupInput {
  shownSubnets: readonly [string, OciSubnet][];
  expanded: ReadonlySet<string>;
  instances: readonly OciInstance[];
  poolById: ReadonlyMap<string, OciNodePoolSummary>;
  poolIdOf: (instance: OciInstance) => string | undefined;
  nodeById: Map<string, TopologyNode>;
}

/** nodeByIdからは畳んだInstanceが消え、代わりに集約ノードが入る。 */
function aggregateInstanceGroups(input: InstanceGroupInput): Map<string, string> {
  const { nodeById, poolById, poolIdOf } = input;
  const putNode = (node: TopologyNode) => {
    if (!nodeById.has(node.id)) nodeById.set(node.id, node);
  };
  const groupOf = new Map<string, string>();
  for (const [subnetId] of input.shownSubnets) {
    if (input.expanded.has(subnetId)) continue;
    const inSubnet = input.instances.filter((instance) => nodeById.get(instance.id)?.parentId === subnetId);
    if (inSubnet.length <= AGGREGATE_THRESHOLD) continue;
    // ノードプール不明のInstanceは1つの束にまとめる(空文字キー)。
    const membersByPool = new Map<string, string[]>();
    for (const instance of inSubnet) {
      const key = poolIdOf(instance) ?? "";
      pushToMap(membersByPool, key, instance.id);
    }
    for (const [poolId, memberIds] of [...membersByPool].sort((a, b) => compareText(a[0], b[0]))) {
      // 1件だけの束は畳まない: 並ぶ箱の数は減らず、Instanceの詳細とコンソールリンクだけが失われる。
      if (memberIds.length < 2) continue;
      const members = memberIds.map((memberId) => nodeById.get(memberId)).filter((node) => node !== undefined);
      for (const memberId of memberIds) nodeById.delete(memberId);
      const groupId = poolId ? `instance-group:${subnetId}:${poolId}` : `instance-group:${subnetId}`;
      for (const memberId of memberIds) groupOf.set(memberId, groupId);
      const pool = poolById.get(poolId);
      const countLabel = `${memberIds.length} nodes`;
      putNode({
        id: groupId,
        kind: "instance-group",
        label: pool?.name ? `${pool.name} (${countLabel})` : countLabel,
        summary: summaryOf([pool?.["node-shape"], pool?.["kubernetes-version"]]),
        parentId: subnetId,
        status: "unknown",
        detail: [
          ...detailOf([
            text("Node Pool", pool?.name),
            text("OCID", poolId, "ocid"),
            text("Node Shape", pool?.["node-shape"]),
            text("Kubernetes Version", pool?.["kubernetes-version"]),
            text("Size", poolSizeText(pool)),
          ]),
          { label: "Instances", value: String(memberIds.length) },
          // 畳んだInstanceの値を持たせない場合、その名前・OCIDで集約ノードを検索できなくなる。
          ...members.map((member) => ({ label: "Member", value: memberDetailValue(member) })),
        ],
        memberIds,
        count: memberIds.length,
      });
    }
  }
  return groupOf;
}

interface BackendEdgeInput {
  data: ClusterOciData;
  instances: readonly OciInstance[];
  instanceIps: ReadonlyMap<string, string[]>;
  lbRows: readonly LbRow[];
  serviceLbMatches: readonly ServiceLbMatch[];
  endpointSlices?: readonly TopologyK8sEndpointSlice[];
  k8sNodeByInstanceId: ReadonlyMap<string, TopologyK8sNode>;
  putEdge: PutEdge;
}

/** 返すのはexternalTrafficPolicy: LocalなServiceのキー(`namespace/name`)集合。 */
function addBackendEdges(input: BackendEdgeInput): Set<string> {
  const { data, instanceIps, k8sNodeByInstanceId, lbRows, putEdge } = input;
  const targetsByIp = new Map<string, string[]>();
  for (const instance of input.instances) {
    for (const ip of instanceIps.get(instance.id) ?? []) pushUniqueToMap(targetsByIp, ip, instance.id);
  }
  for (const row of lbRows) {
    for (const ip of row.ips) pushUniqueToMap(targetsByIp, ip, row.id);
  }

  const backendSetIpsById = new Map<string, Map<string, string[]>>();
  if (data.lbs.ok) for (const lb of data.lbs.data) backendSetIpsById.set(lb.id, backendSetIpsOf(lb["backend-sets"]));
  if (data.nlbs.ok) {
    for (const nlb of data.nlbs.data) backendSetIpsById.set(nlb.id, backendSetIpsOf(nlb["backend-sets"]));
  }
  const readyEndpointNodes = readyEndpointNodesOf(input.endpointSlices ?? []);
  const servicesByLbId = new Map<string, ServiceLbMatchInput[]>();
  for (const match of input.serviceLbMatches) {
    const lbId = match.loadBalancer?.ocid;
    if (!lbId) continue;
    pushToMap(servicesByLbId, lbId, match.service);
  }
  const localServiceKeys = new Set<string>();
  for (const services of servicesByLbId.values()) {
    for (const service of services) {
      if (isLocalTrafficPolicy(service.externalTrafficPolicy)) {
        localServiceKeys.add(serviceKey(service.namespace, service.name));
      }
    }
  }
  const edgeHealthOf = (
    lbId: string,
    targetId: string,
    health: TopologyEdgeHealth | undefined,
  ): TopologyEdgeHealth | undefined => {
    if (health !== "critical" && health !== "warning") return health;
    const nodeName = k8sNodeByInstanceId.get(targetId)?.metadata.name;
    if (!nodeName) return health;
    return isNoLocalPod(servicesByLbId.get(lbId) ?? [], readyEndpointNodes, nodeName) ? NO_LOCAL_POD_HEALTH : health;
  };
  for (const row of lbRows) {
    const setIps = backendSetIpsById.get(row.id);
    const healthByIp = backendHealthOfLb(row, setIps, data.backendHealths);
    const backendIps = [...new Set([...(setIps?.values() ?? [])].flat())].sort(compareText);
    for (const ip of backendIps) {
      for (const targetId of [...(targetsByIp.get(ip) ?? [])].sort(compareText)) {
        putEdge("backend", row.id, targetId, edgeHealthOf(row.id, targetId, healthByIp.get(ip)));
      }
    }
  }
  return localServiceKeys;
}

interface SecurityInputParams {
  data: ClusterOciData;
  vcnId: string | undefined;
  shownSubnets: readonly [string, OciSubnet][];
  instances: readonly OciInstance[];
  instanceIps: ReadonlyMap<string, string[]>;
  primaryVnics: ReadonlyMap<string, OciVnic>;
  poolById: ReadonlyMap<string, OciNodePoolSummary>;
  poolIdOf: (instance: OciInstance) => string | undefined;
  lbRows: readonly LbRow[];
}

function securityGraphInputOf(params: SecurityInputParams): SecurityGraphInput {
  const { data, instanceIps, poolById, poolIdOf, primaryVnics } = params;
  const peers: SecurityPeer[] = [];
  const subnetIngress: SecurityRuleSet[] = [];
  for (const [subnetId, subnet] of params.shownSubnets) {
    peers.push({ nodeId: subnetId, cidrs: subnetCidrs(subnet) });
    const rules = (subnet["security-list-ids"] ?? []).flatMap(
      (securityListId) => okEntry(data.securityLists, securityListId)?.["ingress-security-rules"] ?? [],
    );
    if (rules.length > 0) subnetIngress.push({ nodeId: subnetId, rules });
  }
  for (const instance of params.instances) {
    const vnic = primaryVnics.get(instance.id);
    const poolId = poolIdOf(instance);
    peers.push({
      nodeId: instance.id,
      nsgIds: (poolId ? poolById.get(poolId)?.["node-config-details"]?.["nsg-ids"] : undefined) ?? [],
      ips: [
        ...new Set(
          [...(instanceIps.get(instance.id) ?? []), vnic?.["private-ip"], vnic?.["public-ip"]].filter(
            (ip): ip is string => !!ip,
          ),
        ),
      ],
    });
  }
  for (const row of params.lbRows) peers.push({ nodeId: row.id, nsgIds: row.nsgIds, ips: row.ips });

  const nsgIngress: SecurityRuleSet[] = [];
  for (const peer of peers) {
    for (const nsgId of peer.nsgIds ?? []) {
      const rules = (okEntry(data.nsgs, nsgId)?.rules ?? []).filter((rule) => rule.direction !== "EGRESS");
      if (rules.length > 0) nsgIngress.push({ nodeId: peer.nodeId, nsgId, rules });
    }
  }

  const vcn = params.vcnId ? okEntry(data.vcns, params.vcnId) : undefined;
  return { peers, subnetIngress, nsgIngress, vcnCidrs: vcn ? vcnCidrs(vcn) : [] };
}

interface SecurityEdgeInput {
  graphInput: SecurityGraphInput;
  putEdge: PutEdge;
  edgeById: Map<string, TopologyEdge>;
}

function addSecurityEdges(input: SecurityEdgeInput): TopologySecurityStats {
  const { edgeById, graphInput, putEdge } = input;
  const portsByEdgeId = new Map<string, string[]>();
  let links = 0;
  // VCN CIDRが読めないとVCN全体sourceを広すぎると判定できず、図が完全グラフになる。
  const securityLinks = graphInput.vcnCidrs.length === 0 ? [] : securityLinksOf(graphInput);
  for (const link of securityLinks) {
    links += 1;
    const id = putEdge(link.kind, link.source, link.target);
    if (!id) continue;
    pushToMap(portsByEdgeId, id, link.port);
  }
  for (const [id, ports] of portsByEdgeId) {
    const edge = edgeById.get(id);
    if (edge) edge.label = summarizePorts(ports);
  }
  return { links, edges: portsByEdgeId.size };
}

function localTrafficStatsOf(
  endpointSlices: readonly TopologyK8sEndpointSlice[] | undefined,
  localServiceKeys: ReadonlySet<string>,
  edges: readonly TopologyEdge[],
): TopologyLocalTrafficStats {
  return {
    endpointSlices: endpointSlices?.length ?? 0,
    localServices: localServiceKeys.size,
    downgraded: edges.filter((edge) => edge.health === NO_LOCAL_POD_HEALTH).length,
  };
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
      summary: vcn ? cidrSummary(vcnCidrs(vcn)) : undefined,
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
  const primaryVnics = primaryVnicByInstance(data);
  for (const instance of instances) {
    const k8sNode = k8sNodeByInstanceId.get(instance.id);
    const internalIps = k8sNode ? internalIpsOf(k8sNode) : [];
    const matchedSubnets = subnets
      .filter(([, subnet]) => subnetCidrs(subnet).some((cidr) => internalIps.some((ip) => ipInCidr(ip, cidr))))
      .map(([subnetId]) => subnetId);
    instanceIps.set(instance.id, k8sNode ? allIpsOf(k8sNode) : []);
    const vnicSubnetId = primaryVnics.get(instance.id)?.["subnet-id"];
    // primary VNICのsubnetが分かればそれが正で、図に無いSubnetを指すならCIDR照合では代替しない。
    // CIDR照合は0件一致・複数一致とも根拠が立たない(どちらもUnplacedへ落とす)
    const placed = vnicSubnetId
      ? subnetById.has(vnicSubnetId)
        ? vnicSubnetId
        : undefined
      : matchedSubnets.length === 1
        ? matchedSubnets[0]
        : undefined;
    if (placed) instanceParent.set(instance.id, placed);
  }

  const nodeIps = internalIpsOfNodes(k8sNodes);
  const serviceInputs = services.filter((service) => service.spec.type === "LoadBalancer").map(serviceMatchInput);
  const lbIds = clusterLbIds(data, ingressIpsOfServices(services), nodeIps);
  const view = buildNetworkView(data, lbIds);
  const lbRows = [...view.lbRows].sort((a, b) => compareText(a.id, b.id));
  const placeLb = (row: LbRow): string | undefined =>
    row.subnetIds.filter((subnetId) => subnetById.has(subnetId)).sort(compareText)[0];
  const candidates: LoadBalancerCandidate[] = lbRows.map((row) => ({ ocid: row.id, kind: row.kind, ips: row.ips }));
  const serviceLbMatches = matchServicesToLoadBalancers(serviceInputs, candidates);
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
      summary: cidrSummary(subnetCidrs(subnet)),
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

  const poolById = new Map((data.nodePools.ok ? data.nodePools.data : []).map((pool) => [pool.id, pool]));
  const poolIdByInstance = nodePoolIdsByInstance(data.nodePoolDetails);
  const poolIdOf = (instance: OciInstance): string | undefined => resolveNodePoolId(instance, poolIdByInstance);

  for (const instance of instances) {
    const k8sNode = k8sNodeByInstanceId.get(instance.id);
    const vnic = primaryVnics.get(instance.id);
    const poolId = poolIdOf(instance);
    // InstanceのCreatedByはノードプールを指すため、system tagだけを見る。
    const tagView = clusterTagViewOf(
      statusOf(instance["lifecycle-state"]),
      clusterTagMismatchesOf(instance, input.clusterId, INSTANCE_CLUSTER_TAG_SOURCES),
    );
    putNode({
      id: instance.id,
      kind: "instance",
      label: instance["display-name"] ?? instance.id,
      summary: summaryOf([shapeSummary(instance), placementSummary(instance)]),
      parentId: instanceParent.get(instance.id),
      status: tagView.status,
      detail: detailOf([
        text("Name", instance["display-name"]),
        text("OCID", instance.id, "ocid"),
        text("State", instance["lifecycle-state"]),
        ...tagView.detail,
        text("Shape", shapeText(instance)),
        text("Node Pool", poolId ? (poolById.get(poolId)?.name ?? poolId) : undefined),
        text("Private IP", vnic?.["private-ip"]),
        text("Public IP", vnic?.["public-ip"] ?? undefined),
        text("Node", k8sNode?.metadata.name),
        text("Availability Domain", instance["availability-domain"]),
      ]),
      consoleUrl: consoleUrlOf("instance", instance.id),
    });
  }

  for (const row of lbRows) {
    const tagView = clusterTagViewOf(statusOf(row.lifecycleState), clusterTagMismatchesOf(row.tags, input.clusterId));
    putNode({
      id: row.id,
      kind: row.kind,
      label: row.displayName ?? row.id,
      parentId: lbParent.get(row.id),
      status: tagView.status,
      detail: detailOf([
        text("Name", row.displayName),
        text("OCID", row.id, "ocid"),
        text("State", row.lifecycleState),
        ...tagView.detail,
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

  const { pvLinks, volumeLinks } = buildStorageNodes({ data, clusterId: input.clusterId, pvs, instances, putNode });

  const groupOf = aggregateInstanceGroups({
    shownSubnets,
    expanded,
    instances,
    poolById,
    poolIdOf,
    nodeById,
  });

  const edgeById = new Map<string, TopologyEdge>();
  /** 図に載せられたエッジのid。両端が図に無い・自己ループで捨てた場合はundefined。 */
  const putEdge = (
    kind: TopologyEdgeKind,
    source: string,
    target: string,
    health?: TopologyEdgeHealth,
  ): string | undefined => {
    const from = groupOf.get(source) ?? source;
    const to = groupOf.get(target) ?? target;
    if (from === to || !nodeById.has(from) || !nodeById.has(to)) return undefined;
    const id = `${kind}|${from}|${to}`;
    const existing = edgeById.get(id);
    if (existing) {
      // 集約ノードへ畳んだInstanceや複数IPのバックエンドが1本へ合流するため、最も深刻な状態を残す。
      const merged = worseBackendHealth(existing.health, health);
      if (merged !== undefined) existing.health = merged;
      return id;
    }
    const edge: TopologyEdge = { id, source: from, target: to, kind };
    if (health !== undefined) edge.health = health;
    edgeById.set(id, edge);
    return id;
  };

  const localServiceKeys = addBackendEdges({
    data,
    instances,
    instanceIps,
    lbRows,
    serviceLbMatches,
    endpointSlices: input.endpointSlices,
    k8sNodeByInstanceId,
    putEdge,
  });

  for (const waf of view.wafRows) putEdge("waf-lb", waf.id, waf.targetLbId);

  for (const match of serviceLbMatches) {
    if (!match.loadBalancer) continue;
    putEdge("service-lb", `k8s-service:${match.service.namespace}/${match.service.name}`, match.loadBalancer.ocid);
  }

  for (const link of pvLinks) {
    if (!link.storageNodeId) continue;
    const id = putEdge("pv-storage", link.pvNodeId, link.storageNodeId);
    const edge = id && link.inferred ? edgeById.get(id) : undefined;
    if (edge) edge.label = PV_STORAGE_INFERRED_EDGE_LABEL;
  }
  for (const link of volumeLinks) putEdge("attachment", link.instanceId, link.volumeId);
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

  const security = addSecurityEdges({
    graphInput: securityGraphInputOf({
      data,
      vcnId,
      shownSubnets,
      instances,
      instanceIps,
      primaryVnics,
      poolById,
      poolIdOf,
      lbRows,
    }),
    putEdge,
    edgeById,
  });

  const edges = [...edgeById.values()].sort((a, b) => compareText(a.id, b.id));
  return {
    nodes: [...nodeById.values()].sort(compareNodes),
    edges,
    missing: missingOf(failedSectionsOf(data, input.failedSections)),
    security,
    localTraffic: localTrafficStatsOf(input.endpointSlices, localServiceKeys, edges),
  };
}
