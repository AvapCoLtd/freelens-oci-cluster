import { Renderer } from "@freelensapp/extensions";
import { action, makeObservable, observable, runInAction } from "mobx";
import { resolveAnchor } from "../fetch/anchor";
import { resolveHostIps } from "../fetch/dns";
import {
  buildCompartmentIdSet,
  type ClusterOciData,
  fetchAvailabilityDomains,
  fetchBackendSetHealth,
  fetchCluster,
  fetchFileSystem,
  fetchFssExport,
  fetchFssSnapshotPolicies,
  fetchFssSnapshotPolicyName,
  fetchGatewayStatus,
  fetchInstances,
  fetchLbs,
  fetchManagedCertificate,
  fetchNlbs,
  fetchNodePools,
  fetchNsgWithRules,
  fetchRouteTable,
  fetchSecurityList,
  fetchSubnet,
  fetchTaggedResources,
  fetchVcn,
  fetchVcnGateways,
  fetchVcnNsgs,
  fetchVcnRouteTables,
  fetchVcnSecurityLists,
  fetchVcnSubnets,
  fetchVolumeBackupPolicies,
  fetchVolumeBackupPolicyName,
  fetchVolumes,
  fetchWafPolicy,
  fetchWafs,
  policyNameIndex,
} from "../fetch/fetch";
import { collectHostnames } from "../match/dns-check";
import { gatewayIdsOfRouteTables, type OciGatewayStatusView } from "../match/gateway-status";
import { managedCertificateIdsOf } from "../match/lb-certificates";
import { clusterLbIds, collectNsgIds, collectSubnetIds, internalIpsOfNodes } from "../match/network-path";
import type { OciPage, TopologySection } from "../match/page-sections";
import { sectionsForPage, TOPOLOGY_SECTIONS } from "../match/page-sections";
import { pickAnchorInstanceId } from "../match/provider-id";
import {
  distinctBlockVolumeOcids,
  distinctFssRefOcids,
  fileSystemOcidsOf,
  getCsiSource,
  isFssExportOcid,
  resolvePvStorage,
  unstartedOcids,
} from "../match/pv-storage";
import { ingressIpsOfServices } from "../match/service-lb";
import { isResourceNotFound, type OciErrorKind, type OciRawErrorInfo, type OciResult } from "../oci/result";
import type {
  OciAvailabilityDomain,
  OciBackendSetHealthView,
  OciBackupPolicyView,
  OciCluster,
  OciFileSystem,
  OciFilesystemSnapshotPolicy,
  OciFssExport,
  OciInstance,
  OciLoadBalancer,
  OciManagedCertView,
  OciNetworkLoadBalancerSummary,
  OciNodePoolSummary,
  OciNsg,
  OciNsgWithRules,
  OciResourceSummary,
  OciRouteTable,
  OciSecurityList,
  OciSubnet,
  OciVcn,
  OciVolume,
  OciVolumeBackupPolicy,
  OciWafPolicy,
  OciWafSummary,
} from "../oci/types";

export interface ResolvedAnchor {
  instanceId: string;
  clusterId: string;
  compartmentId: string;
}

export type OciClusterViewState =
  | { status: "not_fetched" }
  | { status: "fetching" }
  | { status: "non_oke" }
  | { status: "fatal_error"; errorKind: OciErrorKind; raw: OciRawErrorInfo; stage: string }
  // アンカーが解決した時点でloadedになり、未取得セクションはdata側のkind="loading"で表す。
  // settledはページの全セクションが揃ったか(ヘッダの取得中表示に使う)。
  // 一覧・展開それぞれの表示可否はdata側のplaceholder(kind="loading")から表示層が判定する。
  | { status: "loaded"; anchor: ResolvedAnchor; data: ClusterOciData; fetchedAt?: number; settled: boolean };

type AnchorState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "non_oke" }
  | { status: "error"; errorKind: OciErrorKind; raw: OciRawErrorInfo; stage: string }
  | { status: "resolved"; anchor: ResolvedAnchor; fetchedAt: number };

type SectionState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: OciResult<T>; fetchedAt: number };

/** セクションの進行状態。"failed"も確定であり、topologyページは描画をブロックせず欠落として扱う。 */
export type TopologySectionStatus = "loading" | "ok" | "failed";

export interface TopologySectionProgress {
  section: TopologySection;
  status: TopologySectionStatus;
}

/** 全必要セクション確定時点のClusterOciDataと、その確定ごとに進む更新世代。 */
export interface TopologySnapshot {
  data: ClusterOciData;
  generation: number;
}

/**
 * per-OCID Mapを埋める側の取得結果。Mapへseedした後もlist自体の成否を残す。
 * これが無いとMapが空のときに「対象が無い」と「網羅取得に失敗した」を区別できない。
 */
type ReconcileOutcomeKey = "fileSystems" | "vcn" | "subnets" | "routeTables" | "securityLists" | "nsgs" | "gateways";

// VcnNetwork.resultsのキー(型別listの取得単位)。
const VCN_LIST_SECTIONS = ["subnets", "routeTables", "securityLists", "nsgs", "gateways"] as const;

type VcnListSection = (typeof VCN_LIST_SECTIONS)[number];

// networkページのper-OCID遅延取得Map群(subnet/SL/RT/NSG)。backendHealthsのみ展開時オンデマンド。
type OcidMapKey =
  | "fileSystems"
  | "fssExports"
  | "vcns"
  | "subnets"
  | "securityLists"
  | "routeTables"
  | "nsgs"
  | "wafPolicies"
  | "gateways"
  | "dnsChecks"
  | "managedCerts"
  | "volumeBackupPolicies"
  | "fssSnapshotPolicies"
  | "backendHealths";

interface ClusterCache {
  anchor: AnchorState;
  cluster: SectionState<OciCluster>;
  instances: SectionState<OciInstance[]>;
  taggedResources: SectionState<OciResourceSummary[]>;
  nlbs: SectionState<OciNetworkLoadBalancerSummary[]>;
  lbs: SectionState<OciLoadBalancer[]>;
  volumes: SectionState<OciVolume[]>;
  nodePools: SectionState<OciNodePoolSummary[]>;
  wafs: SectionState<OciWafSummary[]>;
  // 表示には出さない索引セクション(per-OCID getの置き換え元)。
  availabilityDomains: SectionState<OciAvailabilityDomain[]>;
  fssSnapshotPolicyList: SectionState<OciFilesystemSnapshotPolicy[]>;
  volumeBackupPolicyList: SectionState<OciVolumeBackupPolicy[]>;
  fileSystems: Map<string, SectionState<OciFileSystem>>;
  fssExports: Map<string, SectionState<OciFssExport>>;
  fileSystemsReconciled: boolean;
  vcns: Map<string, SectionState<OciVcn>>;
  vcnsReconciled: boolean;
  subnets: Map<string, SectionState<OciSubnet>>;
  securityLists: Map<string, SectionState<OciSecurityList>>;
  routeTables: Map<string, SectionState<OciRouteTable>>;
  nsgs: Map<string, SectionState<OciNsgWithRules>>;
  wafPolicies: Map<string, SectionState<OciWafPolicy>>;
  gateways: Map<string, SectionState<OciGatewayStatusView>>;
  dnsChecks: Map<string, SectionState<string[]>>;
  managedCerts: Map<string, SectionState<OciManagedCertView>>;
  volumeBackupPolicies: Map<string, SectionState<OciBackupPolicyView>>;
  fssSnapshotPolicies: Map<string, SectionState<OciBackupPolicyView>>;
  backendHealths: Map<string, SectionState<OciBackendSetHealthView>>;
  networkReconciled: boolean;
  reconcileOutcomes: ReadonlyMap<ReconcileOutcomeKey, OciResult<unknown>>;
  // Serviceはnamespaced resourceのためloadAll()既定(=トップバー選択中のnamespaceのみ)だと
  // フィルタ外のLoadBalancer Serviceが読めない。service-lbページ用に全namespace指定でloadAll済みか。
  serviceNamespacesLoaded: boolean;
  requestedPages: Set<OciPage>;
}

function createIdleCache(): ClusterCache {
  return {
    anchor: { status: "idle" },
    cluster: { status: "idle" },
    instances: { status: "idle" },
    taggedResources: { status: "idle" },
    nlbs: { status: "idle" },
    lbs: { status: "idle" },
    volumes: { status: "idle" },
    nodePools: { status: "idle" },
    wafs: { status: "idle" },
    availabilityDomains: { status: "idle" },
    fssSnapshotPolicyList: { status: "idle" },
    volumeBackupPolicyList: { status: "idle" },
    fileSystems: new Map(),
    fssExports: new Map(),
    fileSystemsReconciled: false,
    vcns: new Map(),
    vcnsReconciled: false,
    subnets: new Map(),
    securityLists: new Map(),
    routeTables: new Map(),
    nsgs: new Map(),
    wafPolicies: new Map(),
    gateways: new Map(),
    dnsChecks: new Map(),
    managedCerts: new Map(),
    volumeBackupPolicies: new Map(),
    fssSnapshotPolicies: new Map(),
    backendHealths: new Map(),
    networkReconciled: false,
    reconcileOutcomes: new Map(),
    serviceNamespacesLoaded: false,
    requestedPages: new Set(),
  };
}

/** networkページの型別list取得結果。seed済みOCID集合と、Mapへ直接書けないNSG本体を運ぶ。 */
interface VcnNetwork {
  subnets: ReadonlySet<string>;
  routeTables: ReadonlySet<string>;
  securityLists: ReadonlySet<string>;
  gateways: ReadonlySet<string>;
  nsgs: ReadonlyMap<string, OciNsg>;
  results: ReadonlyMap<VcnListSection, OciResult<unknown>>;
}

const EMPTY_VCN_NETWORK: VcnNetwork = {
  subnets: new Set(),
  routeTables: new Set(),
  securityLists: new Set(),
  gateways: new Set(),
  nsgs: new Map(),
  results: new Map(),
};

const NOT_REQUESTED_MESSAGE = "section not requested for this page";
const LOADING_MESSAGE = "section is still being fetched";

// ポーリング自動停止の対象。周期リトライでは自然回復しない種別(認証失効・コマンド起動不能・互換コマンド非互換・内部エラー)に限る。
const POLLING_STOP_ERROR_KINDS: ReadonlySet<OciErrorKind> = new Set([
  "not_authenticated",
  "command_launch_failed",
  "command_incompatible",
  "internal",
]);

/** backendHealths Mapのキー(UI側のRecord参照と共有)。 */
export function backendHealthKey(kind: "lb" | "nlb", lbId: string, backendSetName: string): string {
  return `${kind}:${lbId}:${backendSetName}`;
}

function sectionStatus(section: SectionState<unknown>): TopologySectionStatus {
  if (section.status !== "ready") return "loading";
  return section.result.ok ? "ok" : "failed";
}

/**
 * スナップショット2件が同じ取得結果を指すか。ClusterOciDataの各フィールドは確定済みcacheから
 * 参照ごと持ち回るため、内容比較でなく同一性比較で足りる。
 */
function sameClusterOciData(a: ClusterOciData, b: ClusterOciData): boolean {
  return (Object.keys(a) as (keyof ClusterOciData)[]).every((key) => a[key] === b[key]);
}

function sectionResultOrPlaceholder<T>(section: SectionState<T>): OciResult<T> {
  if (section.status === "ready") return section.result;
  // 取得開始済み(loading)はページが要求したセクション。idleは他ページ専用で、このページでは叩かない。
  if (section.status === "loading") return { ok: false, kind: "loading", raw: { message: LOADING_MESSAGE } };
  return { ok: false, kind: "not_requested", raw: { message: NOT_REQUESTED_MESSAGE } };
}

/**
 * クラスタ(K8sクラスタID)キー付きのOCIデータキャッシュ。クラスタ切替でのデータ混入を防ぐ。
 * セクション(anchor/cluster共有、instances、taggedResources+nlbs+lbs、volumes+fileSystems)を独立に
 * 取得・キャッシュし、ページが必要とするセクションだけをensureLoadedで開始する(他ページ分は叩かない)。
 */
export class OciClusterStore {
  ociCliCommand = "";

  private readonly caches = observable.map<string, ClusterCache>();
  // deep:falseは必須。deep変換されるとClusterOciDataの各フィールドが差し替えのたび別インスタンスになり、
  // 世代を進めるべきかの同一性判定が常に「変化あり」になる。
  private readonly topologySnapshots = observable.map<string, TopologySnapshot>(undefined, { deep: false });
  // クラスタキー+セクション名をキーにした進行中Promiseの登録簿。複数ページから同じセクションが
  // 要求されても1本のfetchにまとめるための単純化(mobxの状態自体は判定に使わない)。
  private readonly inFlight = new Map<string, Promise<unknown>>();
  // refresh()で進むクラスタ単位の取得世代。旧世代の結果を書き戻すとrefreshで消した値が復活する。
  private readonly epochs = new Map<string, number>();
  // 確定スナップショットの採番。ページはこの値の変化をOCI側入力の差し替え契機にする。
  private readonly topologyGenerations = new Map<string, number>();

  constructor() {
    makeObservable(this, {
      ociCliCommand: observable,
      setOciCliCommand: action,
    });
  }

  setOciCliCommand(value: string): void {
    this.ociCliCommand = value;
  }

  /**
   * ページが表示すべき状態を導出する(未取得/取得中/非OKE/致命エラー/取得済み)。
   * アンカーさえ解決すればloadedを返し、セクション単位の取得状況はdata側のplaceholderで表す。
   */
  getState(clusterKey: string, page: OciPage): OciClusterViewState {
    const cache = this.getCache(clusterKey);
    switch (cache.anchor.status) {
      case "idle":
        return { status: "not_fetched" };
      case "loading":
        return { status: "fetching" };
      case "non_oke":
        return { status: "non_oke" };
      case "error":
        return {
          status: "fatal_error",
          errorKind: cache.anchor.errorKind,
          raw: cache.anchor.raw,
          stage: cache.anchor.stage,
        };
      case "resolved":
        break;
    }
    return {
      status: "loaded",
      anchor: cache.anchor.anchor,
      data: this.buildClusterOciData(cache),
      fetchedAt: this.computeFetchedAt(cache, page),
      settled: this.pageSettled(cache, page),
    };
  }

  /**
   * topologyページの必要セクション集合を、進捗表示と同じ順序で状態つきに列挙する。
   * "failed"も確定であり、ページはこれを欠落種別として扱う("ok"かつ空集合との区別がここで付く)。
   */
  getTopologyProgress(clusterKey: string): TopologySectionProgress[] {
    const cache = this.getCache(clusterKey);
    return TOPOLOGY_SECTIONS.map((section) => ({ section, status: this.topologySectionStatus(cache, section) }));
  }

  /**
   * 全必要セクションが確定した時点で採ったClusterOciDataと更新世代。
   * force更新中はセクションが個別に差し替わるため、cacheを直接読むと新旧混在のデータになる。
   */
  getTopologySnapshot(clusterKey: string): TopologySnapshot | undefined {
    return this.topologySnapshots.get(clusterKey);
  }

  /** ページが必要とするセクションのうち未開始のものだけ取得を開始する(取得中/取得済みなら何もしない)。 */
  ensureLoaded(clusterKey: string, page: OciPage): void {
    const cache = this.getCache(clusterKey);
    if (!cache.requestedPages.has(page)) {
      const requestedPages = new Set(cache.requestedPages);
      requestedPages.add(page);
      this.updateCache(clusterKey, { requestedPages });
    }
    this.ensureAnchor(clusterKey);
    if (this.getCache(clusterKey).anchor.status === "resolved") {
      this.onAnchorResolved(clusterKey);
    }
  }

  /** そのページのセクション+共有セクション(アンカー/cluster)を再取得する。他ページ専用のセクションは温存する。 */
  refresh(clusterKey: string, page: OciPage): void {
    this.epochs.set(clusterKey, this.epochOf(clusterKey) + 1);
    const patch: Partial<ClusterCache> = { anchor: { status: "idle" }, cluster: { status: "idle" } };
    // 他ページ専用セクションの成否は温存するため、消すのは再取得するセクションの分だけ。
    const outcomes = new Map(this.getCache(clusterKey).reconcileOutcomes);
    if (page === "topology") runInAction(() => this.topologySnapshots.delete(clusterKey));
    for (const key of sectionsForPage(page)) {
      if (key === "vcn") {
        patch.vcns = new Map();
        patch.vcnsReconciled = false;
        outcomes.delete("vcn");
        continue;
      }
      if (key === "fileSystems") {
        outcomes.delete("fileSystems");
        patch.fileSystems = new Map();
        patch.fssExports = new Map();
        patch.fileSystemsReconciled = false;
        patch.volumeBackupPolicies = new Map();
        patch.fssSnapshotPolicies = new Map();
        patch.availabilityDomains = { status: "idle" };
        patch.fssSnapshotPolicyList = { status: "idle" };
        patch.volumeBackupPolicyList = { status: "idle" };
        continue;
      }
      if (key === "network") {
        patch.subnets = new Map();
        patch.securityLists = new Map();
        patch.routeTables = new Map();
        patch.nsgs = new Map();
        patch.wafPolicies = new Map();
        patch.gateways = new Map();
        patch.dnsChecks = new Map();
        patch.managedCerts = new Map();
        patch.backendHealths = new Map();
        patch.networkReconciled = false;
        for (const listSection of VCN_LIST_SECTIONS) outcomes.delete(listSection);
        continue;
      }
      patch[key] = { status: "idle" };
    }
    patch.reconcileOutcomes = outcomes;
    if (page === "service-lb") patch.serviceNamespacesLoaded = false;
    this.updateCache(clusterKey, patch);
    this.ensureLoaded(clusterKey, page);
  }

  /**
   * ポーリング用: ページのセクションを旧データ表示のまま裏で再取得する(force=stale-while-revalidate)。
   * anchor再解決はしない。backend healthは既存エントリの再取得のみ(展開したものだけを更新する)。
   * 戻り値はPOLLING_STOP_ERROR_KINDSに該当した種別(検出時のみ)で、呼び出し元がポーリング自動停止に使う。
   */
  async pollRefresh(clusterKey: string, page: OciPage): Promise<OciErrorKind | undefined> {
    const cache = this.getCache(clusterKey);
    if (cache.anchor.status !== "resolved") return undefined;
    const { clusterId, compartmentId } = cache.anchor.anchor;
    const epoch = this.epochOf(clusterKey);
    const sections = sectionsForPage(page);
    const jobs: Promise<OciResult<unknown> | OciResult<unknown>[]>[] = [
      this.ensureCluster(clusterKey, clusterId, true),
    ];
    if (sections.includes("vcn")) jobs.push(this.reconcileVcns(clusterKey, clusterId, true));
    if (sections.includes("instances")) jobs.push(this.ensureInstances(clusterKey, compartmentId, true));
    if (sections.includes("taggedResources")) jobs.push(this.ensureTaggedResources(clusterKey, clusterId, true));
    if (sections.includes("nlbs")) jobs.push(this.ensureNlbs(clusterKey, compartmentId, clusterId, true));
    if (sections.includes("lbs")) jobs.push(this.ensureLbs(clusterKey, compartmentId, clusterId, true));
    if (sections.includes("volumes")) jobs.push(this.ensureVolumes(clusterKey, compartmentId, clusterId, true));
    if (sections.includes("nodePools")) jobs.push(this.ensureNodePools(clusterKey, clusterId, compartmentId, true));
    if (sections.includes("wafs")) jobs.push(this.ensureWafs(clusterKey, compartmentId, clusterId, true));
    // 型別listで一括取得する系は個別エントリのforceでは索引が古いままになるためreconcileを丸ごと回す。
    if (sections.includes("fileSystems")) {
      jobs.push(this.reconcileFileSystems(clusterKey, clusterId, compartmentId, true));
    }
    if (sections.includes("network")) {
      jobs.push(this.reconcileNetwork(clusterKey, clusterId, compartmentId, true));
      // backendHealthsは展開時オンデマンドのため図に出さないtopologyページでは再取得しない。
      if (page === "network") {
        for (const key of cache.backendHealths.keys()) {
          const [kind, lbId, ...nameParts] = key.split(":");
          jobs.push(
            this.ensureMapValue(
              clusterKey,
              "backendHealths",
              key,
              () => fetchBackendSetHealth(kind as "lb" | "nlb", lbId, nameParts.join(":"), this.ociCliCommand),
              true,
            ),
          );
        }
      }
    }
    const results = (await Promise.all(jobs)).flat();
    if (page === "topology") this.captureTopologySnapshot(clusterKey, epoch);
    const stopError = results.find((result) => !result.ok && POLLING_STOP_ERROR_KINDS.has(result.kind));
    return stopError && !stopError.ok ? stopError.kind : undefined;
  }

  /** backend health(展開時オンデマンド)の取得開始。キーは kind:lbId:backendSetName。 */
  ensureBackendHealth(clusterKey: string, kind: "lb" | "nlb", lbId: string, backendSetName: string): void {
    const id = backendHealthKey(kind, lbId, backendSetName);
    void this.ensureMapValue(clusterKey, "backendHealths", id, () =>
      fetchBackendSetHealth(kind, lbId, backendSetName, this.ociCliCommand),
    );
  }

  reloadBackendHealth(clusterKey: string, kind: "lb" | "nlb", lbId: string, backendSetName: string): void {
    const id = backendHealthKey(kind, lbId, backendSetName);
    this.updateMapEntry(clusterKey, "backendHealths", id, { status: "idle" });
    this.ensureBackendHealth(clusterKey, kind, lbId, backendSetName);
  }

  private epochOf(clusterKey: string): number {
    return this.epochs.get(clusterKey) ?? 0;
  }

  private getCache(clusterKey: string): ClusterCache {
    return this.caches.get(clusterKey) ?? createIdleCache();
  }

  private updateCache(clusterKey: string, patch: Partial<ClusterCache>): void {
    runInAction(() => {
      this.caches.set(clusterKey, { ...this.getCache(clusterKey), ...patch });
    });
  }

  // Mapごとに値型が異なるが、書き込みはensureMapValue経由に限られるためunknownで受けて内部castする。
  private updateMapEntry(clusterKey: string, mapKey: OcidMapKey, id: string, state: SectionState<unknown>): void {
    runInAction(() => {
      const cache = this.getCache(clusterKey);
      const map = new Map(cache[mapKey] as Map<string, SectionState<unknown>>);
      map.set(id, state);
      this.caches.set(clusterKey, { ...cache, [mapKey]: map } as ClusterCache);
    });
  }

  /** per-OCID Mapを埋めた側(型別list・reconcile起点)の成否を記録する。旧世代の結果は書き戻さない。 */
  private recordReconcileOutcomes(
    clusterKey: string,
    epoch: number,
    entries: Iterable<readonly [ReconcileOutcomeKey, OciResult<unknown>]>,
  ): void {
    if (this.epochOf(clusterKey) !== epoch) return;
    runInAction(() => {
      const cache = this.getCache(clusterKey);
      const outcomes = new Map(cache.reconcileOutcomes);
      for (const [key, result] of entries) outcomes.set(key, result);
      this.caches.set(clusterKey, { ...cache, reconcileOutcomes: outcomes });
    });
  }

  private topologySectionStatus(cache: ClusterCache, section: TopologySection): TopologySectionStatus {
    switch (section) {
      case "cluster":
      case "taggedResources":
      case "instances":
      case "nodePools":
      case "lbs":
      case "nlbs":
      case "wafs":
      case "volumes":
        return sectionStatus(cache[section]);
      case "fileSystems":
        return this.mapSectionStatus(cache, cache.fileSystemsReconciled, "fileSystems", [
          cache.fssExports,
          cache.fileSystems,
        ]);
      // ポリシー類の列挙元はFSS/Volumeの走査そのもので、ポリシー一覧の失敗は名前解決がgetへ落ちるだけ。
      case "volumeBackupPolicies":
        return this.mapSectionStatus(cache, cache.fileSystemsReconciled, "fileSystems", [cache.volumeBackupPolicies]);
      case "fssSnapshotPolicies":
        return this.mapSectionStatus(cache, cache.fileSystemsReconciled, "fileSystems", [cache.fssSnapshotPolicies]);
      case "vcn":
        return this.mapSectionStatus(cache, cache.vcnsReconciled, "vcn", [cache.vcns]);
      case "subnets":
        return this.mapSectionStatus(cache, cache.networkReconciled, "subnets", [cache.subnets]);
      case "routeTables":
        return this.mapSectionStatus(cache, cache.networkReconciled, "routeTables", [cache.routeTables]);
      case "securityLists":
        return this.mapSectionStatus(cache, cache.networkReconciled, "securityLists", [cache.securityLists]);
      case "nsgs":
        return this.mapSectionStatus(cache, cache.networkReconciled, "nsgs", [cache.nsgs]);
      case "gateways":
        return this.mapSectionStatus(cache, cache.networkReconciled, "gateways", [cache.gateways]);
      // 列挙元はLBのlistener定義で、その網羅性はlbsセクションの成否がそのまま表す。
      case "managedCerts":
        return this.entrySectionStatus(cache.networkReconciled, [cache.managedCerts]);
      // 行集合の出所はK8s(Ingress/Service)。ホスト名が1つも組めなければ待ち対象なし=okになる。
      case "dnsChecks":
        return this.entrySectionStatus(cache.networkReconciled, [cache.dnsChecks]);
    }
  }

  private mapSectionStatus(
    cache: ClusterCache,
    reconciled: boolean,
    outcomeKey: ReconcileOutcomeKey,
    maps: Map<string, SectionState<unknown>>[],
  ): TopologySectionStatus {
    const status = this.entrySectionStatus(reconciled, maps);
    if (status !== "ok") return status;
    const outcome = cache.reconcileOutcomes.get(outcomeKey);
    return outcome && !outcome.ok ? "failed" : "ok";
  }

  /** per-OCID Mapのエントリだけで決まる状態(Mapを埋めた側のlistの成否は含まない)。 */
  private entrySectionStatus(reconciled: boolean, maps: Map<string, SectionState<unknown>>[]): TopologySectionStatus {
    if (!reconciled || !this.mapsSettled(maps)) return "loading";
    for (const map of maps) {
      for (const state of map.values()) {
        // 実体なしは孤立PVとして図側が表示する観測結果で、セクションの取得失敗ではない。
        if (state.status === "ready" && !state.result.ok && !isResourceNotFound(state.result)) return "failed";
      }
    }
    return "ok";
  }

  /**
   * 全必要セクション確定時点のClusterOciDataをスナップショットへ確定させる。
   * 呼び出し側が取得サイクルの完了を待ってから呼ぶ(確定前に呼ぶと新旧混在のデータを載せる)。
   */
  private captureTopologySnapshot(clusterKey: string, epoch: number): void {
    if (this.epochOf(clusterKey) !== epoch) return;
    const data = this.buildClusterOciData(this.getCache(clusterKey));
    const previous = this.topologySnapshots.get(clusterKey);
    // 内容が変わらない世代更新はページに図の再導出を強いるだけになる
    if (previous && sameClusterOciData(previous.data, data)) return;
    // refreshでスナップショットを捨てても採番は戻さない: 世代が一致すると差し替えを見落とす
    const generation = (this.topologyGenerations.get(clusterKey) ?? 0) + 1;
    this.topologyGenerations.set(clusterKey, generation);
    runInAction(() => this.topologySnapshots.set(clusterKey, { data, generation }));
  }

  /** ページの全セクションが確定したか。status="ready"は失敗結果も含むため失敗を待ち続けない。 */
  private pageSettled(cache: ClusterCache, page: OciPage): boolean {
    if (cache.cluster.status !== "ready") return false;
    for (const key of sectionsForPage(page)) {
      if (key === "vcn") {
        if (!cache.vcnsReconciled || !this.mapsSettled([cache.vcns])) return false;
        continue;
      }
      if (key === "fileSystems") {
        if (!this.fileSystemsSettled(cache)) return false;
        continue;
      }
      if (key === "network") {
        if (!this.networkSettled(cache)) return false;
        continue;
      }
      if (cache[key].status !== "ready") return false;
    }
    return true;
  }

  private mapsSettled(maps: Map<string, SectionState<unknown>>[]): boolean {
    for (const map of maps) {
      for (const state of map.values()) {
        if (state.status !== "ready") return false;
      }
    }
    return true;
  }

  private fileSystemsSettled(cache: ClusterCache): boolean {
    if (!cache.fileSystemsReconciled) return false;
    return this.mapsSettled([
      cache.fssExports,
      cache.fileSystems,
      cache.volumeBackupPolicies,
      cache.fssSnapshotPolicies,
    ]);
  }

  // backendHealthsは展開時オンデマンドのため条件に含めない。
  private networkSettled(cache: ClusterCache): boolean {
    if (!cache.networkReconciled) return false;
    return this.mapsSettled([
      cache.subnets,
      cache.securityLists,
      cache.routeTables,
      cache.gateways,
      cache.nsgs,
      cache.wafPolicies,
      cache.dnsChecks,
      cache.managedCerts,
    ]);
  }

  private computeFetchedAt(cache: ClusterCache, page: OciPage): number | undefined {
    const timestamps: number[] = [];
    const pushMap = (map: Map<string, SectionState<unknown>>) => {
      for (const state of map.values()) {
        if (state.status === "ready") timestamps.push(state.fetchedAt);
      }
    };
    if (cache.cluster.status === "ready") timestamps.push(cache.cluster.fetchedAt);
    for (const key of sectionsForPage(page)) {
      if (key === "vcn") {
        pushMap(cache.vcns);
        continue;
      }
      if (key === "fileSystems") {
        pushMap(cache.fssExports);
        pushMap(cache.fileSystems);
        pushMap(cache.volumeBackupPolicies);
        pushMap(cache.fssSnapshotPolicies);
        continue;
      }
      if (key === "network") {
        pushMap(cache.subnets);
        pushMap(cache.securityLists);
        pushMap(cache.routeTables);
        pushMap(cache.nsgs);
        pushMap(cache.wafPolicies);
        pushMap(cache.gateways);
        pushMap(cache.dnsChecks);
        pushMap(cache.managedCerts);
        continue;
      }
      const section = cache[key];
      if (section.status === "ready") timestamps.push(section.fetchedAt);
    }
    return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
  }

  // Map参照→変換結果のキャッシュ。updateMapEntryは更新のあったMapキーだけ新規Mapに置き換え、
  // 他のMapキーは既存参照を保持したままcacheをspreadするため、更新のなかったMapはここでヒットし
  // 再変換をスキップできる(WeakMapなのでMapがGCされればエントリも自然に消える)。
  private readonly mapRecordCache = new WeakMap<
    Map<string, SectionState<unknown>>,
    Record<string, OciResult<unknown>>
  >();

  private toRecord<T>(map: Map<string, SectionState<T>>): Record<string, OciResult<T>> {
    const key = map as Map<string, SectionState<unknown>>;
    const cached = this.mapRecordCache.get(key);
    if (cached) return cached as Record<string, OciResult<T>>;
    const record: Record<string, OciResult<T>> = {};
    for (const [ocid, state] of map) {
      if (state.status === "ready") record[ocid] = state.result;
    }
    this.mapRecordCache.set(key, record as Record<string, OciResult<unknown>>);
    return record;
  }

  private buildClusterOciData(cache: ClusterCache): ClusterOciData {
    return {
      cluster: sectionResultOrPlaceholder(cache.cluster),
      instances: sectionResultOrPlaceholder(cache.instances),
      taggedResources: sectionResultOrPlaceholder(cache.taggedResources),
      nlbs: sectionResultOrPlaceholder(cache.nlbs),
      lbs: sectionResultOrPlaceholder(cache.lbs),
      volumes: sectionResultOrPlaceholder(cache.volumes),
      nodePools: sectionResultOrPlaceholder(cache.nodePools),
      wafs: sectionResultOrPlaceholder(cache.wafs),
      fileSystems: this.toRecord(cache.fileSystems),
      fssExports: this.toRecord(cache.fssExports),
      vcns: this.toRecord(cache.vcns),
      subnets: this.toRecord(cache.subnets),
      securityLists: this.toRecord(cache.securityLists),
      routeTables: this.toRecord(cache.routeTables),
      nsgs: this.toRecord(cache.nsgs),
      wafPolicies: this.toRecord(cache.wafPolicies),
      gateways: this.toRecord(cache.gateways),
      dnsChecks: this.toRecord(cache.dnsChecks),
      managedCerts: this.toRecord(cache.managedCerts),
      volumeBackupPolicies: this.toRecord(cache.volumeBackupPolicies),
      fssSnapshotPolicies: this.toRecord(cache.fssSnapshotPolicies),
      backendHealths: this.toRecord(cache.backendHealths),
    };
  }

  private ensureAnchor(clusterKey: string): void {
    const cache = this.getCache(clusterKey);
    if (cache.anchor.status !== "idle") return;
    const key = `${clusterKey}:anchor`;
    this.updateCache(clusterKey, { anchor: { status: "loading" } });
    // 進行中のrunAnchorを残したまま再開すると完了順で結果が上書きされる
    if (this.inFlight.has(key)) return;
    const promise = this.runAnchor(clusterKey);
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
  }

  private async runAnchor(clusterKey: string): Promise<void> {
    try {
      const nodeStore = Renderer.K8sApi.nodesStore;
      try {
        await nodeStore.loadAll();
      } catch (error) {
        this.updateCache(clusterKey, {
          anchor: { status: "error", errorKind: "other", raw: { message: String(error) }, stage: "node_list" },
        });
        return;
      }
      const instanceId = pickAnchorInstanceId(nodeStore.items.map((node) => node.spec.providerID));
      if (!instanceId) {
        this.updateCache(clusterKey, { anchor: { status: "non_oke" } });
        return;
      }
      const result = await resolveAnchor(instanceId, this.ociCliCommand);
      if (result.kind === "non_oke") {
        this.updateCache(clusterKey, { anchor: { status: "non_oke" } });
        return;
      }
      if (result.kind === "auth_error") {
        this.updateCache(clusterKey, {
          anchor: { status: "error", errorKind: result.errorKind, raw: result.raw, stage: result.stage },
        });
        return;
      }
      if (result.kind === "unexpected_shape") {
        this.updateCache(clusterKey, {
          anchor: {
            status: "error",
            errorKind: "other",
            raw: { message: result.detail },
            stage: result.stage,
          },
        });
        return;
      }
      const anchor: ResolvedAnchor = {
        instanceId: result.instanceId,
        clusterId: result.clusterId,
        compartmentId: result.compartmentId,
      };
      this.updateCache(clusterKey, { anchor: { status: "resolved", anchor, fetchedAt: Date.now() } });
      this.onAnchorResolved(clusterKey);
    } catch (error) {
      this.updateCache(clusterKey, {
        anchor: {
          status: "error",
          errorKind: "internal",
          raw: { message: String(error) },
          stage: "unexpected",
        },
      });
    }
  }

  private onAnchorResolved(clusterKey: string): void {
    const cache = this.getCache(clusterKey);
    if (cache.anchor.status !== "resolved") return;
    void this.ensureCluster(clusterKey, cache.anchor.anchor.clusterId);
    for (const page of cache.requestedPages) {
      this.startPageSections(clusterKey, page);
    }
  }

  private startPageSections(clusterKey: string, page: OciPage): void {
    const cache = this.getCache(clusterKey);
    if (cache.anchor.status !== "resolved") return;
    const { clusterId, compartmentId } = cache.anchor.anchor;
    const sections = sectionsForPage(page);

    const jobs: Promise<unknown>[] = [];
    if (sections.includes("instances")) jobs.push(this.ensureInstances(clusterKey, compartmentId));
    if (sections.includes("taggedResources")) jobs.push(this.ensureTaggedResources(clusterKey, clusterId));
    if (sections.includes("nlbs")) jobs.push(this.ensureNlbs(clusterKey, compartmentId, clusterId));
    if (sections.includes("lbs")) jobs.push(this.ensureLbs(clusterKey, compartmentId, clusterId));
    if (sections.includes("volumes")) jobs.push(this.ensureVolumes(clusterKey, compartmentId, clusterId));
    if (sections.includes("fileSystems")) jobs.push(this.reconcileFileSystems(clusterKey, clusterId, compartmentId));
    if (sections.includes("nodePools")) jobs.push(this.ensureNodePools(clusterKey, clusterId, compartmentId));
    if (sections.includes("wafs")) jobs.push(this.ensureWafs(clusterKey, compartmentId, clusterId));
    if (sections.includes("vcn")) jobs.push(this.reconcileVcns(clusterKey, clusterId));
    if (sections.includes("network")) jobs.push(this.reconcileNetwork(clusterKey, clusterId, compartmentId));
    // Serviceを読むページは、トップバーのnamespace絞り込みに関係なく全namespaceを載せる必要がある。
    if (page === "service-lb" || page === "topology") jobs.push(this.ensureServiceNamespaces(clusterKey));
    if (page === "topology") {
      const epoch = this.epochOf(clusterKey);
      void Promise.all(jobs).then(() => this.captureTopologySnapshot(clusterKey, epoch));
    }
  }

  private ensureSectionValue<T>(
    clusterKey: string,
    flightKey: string,
    getCurrent: (cache: ClusterCache) => SectionState<T>,
    setState: (state: SectionState<T>) => void,
    fetcher: () => Promise<OciResult<T>>,
    force = false,
  ): Promise<OciResult<T>> {
    const current = getCurrent(this.getCache(clusterKey));
    if (current.status === "ready" && !force) return Promise.resolve(current.result);
    const epoch = this.epochOf(clusterKey);
    // 世代をキーに含めない場合、refresh直後の要求がrefresh前の進行中Promiseに相乗りする
    const key = `${clusterKey}:e${epoch}:${flightKey}`;
    const existing = this.inFlight.get(key) as Promise<OciResult<T>> | undefined;
    if (existing) return existing;
    // force(ポーリング)時は旧データを表示したまま裏で再取得する(loading化するとページ全体がスピナーに戻る)
    if (current.status !== "ready") setState({ status: "loading" });
    const promise = fetcher()
      .catch(
        (error: unknown): OciResult<T> => ({
          ok: false,
          kind: "internal",
          raw: { message: String(error) },
        }),
      )
      .then((result) => {
        // 旧世代の結果はfetchedAt=nowで「最新」として残るため書き戻さない
        if (this.epochOf(clusterKey) === epoch) setState({ status: "ready", result, fetchedAt: Date.now() });
        return result;
      });
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
    return promise;
  }

  private ensureCluster(clusterKey: string, clusterId: string, force = false): Promise<OciResult<OciCluster>> {
    return this.ensureSectionValue(
      clusterKey,
      "cluster",
      (cache) => cache.cluster,
      (state) => this.updateCache(clusterKey, { cluster: state }),
      () => fetchCluster(clusterId, this.ociCliCommand),
      force,
    );
  }

  private ensureInstances(clusterKey: string, compartmentId: string, force = false): Promise<OciResult<OciInstance[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "instances",
      (cache) => cache.instances,
      (state) => this.updateCache(clusterKey, { instances: state }),
      () => fetchInstances(compartmentId, this.ociCliCommand),
      force,
    );
  }

  private ensureTaggedResources(
    clusterKey: string,
    clusterId: string,
    force = false,
  ): Promise<OciResult<OciResourceSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "taggedResources",
      (cache) => cache.taggedResources,
      (state) => this.updateCache(clusterKey, { taggedResources: state }),
      () => fetchTaggedResources(clusterId, this.ociCliCommand),
      force,
    );
  }

  private async compartmentIdsFor(
    clusterKey: string,
    anchorCompartmentId: string,
    clusterId: string,
  ): Promise<string[]> {
    const tagged = await this.ensureTaggedResources(clusterKey, clusterId);
    return buildCompartmentIdSet(anchorCompartmentId, tagged);
  }

  private ensureNlbs(
    clusterKey: string,
    anchorCompartmentId: string,
    clusterId: string,
    force = false,
  ): Promise<OciResult<OciNetworkLoadBalancerSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "nlbs",
      (cache) => cache.nlbs,
      (state) => this.updateCache(clusterKey, { nlbs: state }),
      async () =>
        fetchNlbs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.ociCliCommand),
      force,
    );
  }

  private ensureLbs(
    clusterKey: string,
    anchorCompartmentId: string,
    clusterId: string,
    force = false,
  ): Promise<OciResult<OciLoadBalancer[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "lbs",
      (cache) => cache.lbs,
      (state) => this.updateCache(clusterKey, { lbs: state }),
      async () =>
        fetchLbs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.ociCliCommand),
      force,
    );
  }

  private ensureVolumes(
    clusterKey: string,
    anchorCompartmentId: string,
    clusterId: string,
    force = false,
  ): Promise<OciResult<OciVolume[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "volumes",
      (cache) => cache.volumes,
      (state) => this.updateCache(clusterKey, { volumes: state }),
      async () =>
        fetchVolumes(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.ociCliCommand),
      force,
    );
  }

  /**
   * pv-storageページのFSS/バックアップポリシー取得。
   * force時はPVを読み直した上で新規参照も取得する(既存キャッシュとの和集合)。
   * `fs file-system list`はFileSystemSummaryでfilesystem-snapshot-policy-idを持たないためFSS本体はget維持。
   */
  private reconcileFileSystems(
    clusterKey: string,
    clusterId: string,
    compartmentId: string,
    force = false,
  ): Promise<OciResult<unknown>[]> {
    const epoch = this.epochOf(clusterKey);
    // 旧世代がreconciled=trueを書き戻すと、refreshで消したエントリが再要求されないまま完了扱いになる
    const markReconciled = (outcome: OciResult<unknown>) => {
      if (this.epochOf(clusterKey) !== epoch) return;
      this.updateCache(clusterKey, { fileSystemsReconciled: true });
      this.recordReconcileOutcomes(clusterKey, epoch, [["fileSystems", outcome]]);
    };
    return (async () => {
      const jobs: Promise<OciResult<unknown>>[] = [];
      try {
        const compartmentIdsPromise = this.compartmentIdsFor(clusterKey, compartmentId, clusterId);
        // ポリシー一覧はPV読み込みと並走させる(FSS本体getの結果を待たずに名前索引を用意する)。
        const fssPolicies = this.ensureFssSnapshotPolicyList(clusterKey, compartmentIdsPromise, compartmentId, force);
        const volumePolicies = this.ensureVolumeBackupPolicyList(clusterKey, compartmentIdsPromise, force);
        jobs.push(fssPolicies, volumePolicies);

        const pvStore = Renderer.K8sApi.persistentVolumeStore;
        await pvStore.loadAll();
        const resolutions = pvStore.items.map((pv) => {
          const csi = getCsiSource(pv.spec);
          return resolvePvStorage(csi?.driver, csi?.volumeHandle);
        });
        const refOcids = distinctFssRefOcids(resolutions);
        const beforeExports = this.getCache(clusterKey);
        const exportRefs = refOcids.filter(isFssExportOcid);
        const startedExports = new Set(beforeExports.fssExports.keys());
        const exportsToStart = force
          ? [...new Set([...startedExports, ...exportRefs])]
          : unstartedOcids(exportRefs, startedExports);
        const fssExports = exportsToStart.map((exportId) => this.ensureFssExport(clusterKey, exportId, force));
        jobs.push(...fssExports);
        // FileSystem OCIDはExport OCIDの解決結果からしか分からないため、本体getはexport完了後に始める。
        await Promise.all(fssExports);

        const cache = this.getCache(clusterKey);
        const resolvedFsOcids = fileSystemOcidsOf(refOcids, this.toRecord(cache.fssExports));
        const startedFileSystems = new Set(cache.fileSystems.keys());
        const toStart = force
          ? [...new Set([...startedFileSystems, ...resolvedFsOcids])]
          : unstartedOcids(resolvedFsOcids, startedFileSystems);
        const fileSystems = toStart.map((fsId) => this.ensureFileSystem(clusterKey, fsId, force));
        jobs.push(...fileSystems);

        const fssIndex = policyNameIndex(await fssPolicies);
        const fssPolicyJobs = fileSystems.map((fileSystem) =>
          fileSystem.then<OciResult<unknown>>((result) => {
            const policyId = result.ok ? result.data["filesystem-snapshot-policy-id"] : undefined;
            if (!policyId) return result;
            return this.ensureFssSnapshotPolicy(clusterKey, policyId, force, fssIndex);
          }),
        );
        jobs.push(...fssPolicyJobs);
        const volumeIndex = policyNameIndex(await volumePolicies);
        for (const volumeId of distinctBlockVolumeOcids(resolutions)) {
          jobs.push(this.ensureVolumeBackupPolicy(clusterKey, volumeId, force, volumeIndex));
        }
        // スナップショットポリシーのMapエントリはFSS本体getの完了後に生える。
        // 先にreconciledを立てると、そのMapが空のまま「揃った」と誤判定してポリシー名が後から生える。
        await Promise.all(fssPolicyJobs);
        markReconciled({ ok: true, data: undefined });
      } catch (error) {
        const failure: OciResult<unknown> = { ok: false, kind: "internal", raw: { message: String(error) } };
        markReconciled(failure);
        jobs.push(Promise.resolve(failure));
      }
      return Promise.all(jobs);
    })();
  }

  private ensureAvailabilityDomains(
    clusterKey: string,
    compartmentId: string,
    force = false,
  ): Promise<OciResult<OciAvailabilityDomain[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "availabilityDomains",
      (cache) => cache.availabilityDomains,
      (state) => this.updateCache(clusterKey, { availabilityDomains: state }),
      () => fetchAvailabilityDomains(compartmentId, this.ociCliCommand),
      force,
    );
  }

  private ensureFssSnapshotPolicyList(
    clusterKey: string,
    compartmentIds: Promise<string[]>,
    anchorCompartmentId: string,
    force = false,
  ): Promise<OciResult<OciFilesystemSnapshotPolicy[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "fssSnapshotPolicyList",
      (cache) => cache.fssSnapshotPolicyList,
      (state) => this.updateCache(clusterKey, { fssSnapshotPolicyList: state }),
      async () => {
        const [ids, domains] = await Promise.all([
          compartmentIds,
          this.ensureAvailabilityDomains(clusterKey, anchorCompartmentId, force),
        ]);
        if (!domains.ok) return domains;
        return fetchFssSnapshotPolicies(
          ids,
          domains.data.map((domain) => domain.name),
          this.ociCliCommand,
        );
      },
      force,
    );
  }

  private ensureVolumeBackupPolicyList(
    clusterKey: string,
    compartmentIds: Promise<string[]>,
    force = false,
  ): Promise<OciResult<OciVolumeBackupPolicy[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "volumeBackupPolicyList",
      (cache) => cache.volumeBackupPolicyList,
      (state) => this.updateCache(clusterKey, { volumeBackupPolicyList: state }),
      async () => fetchVolumeBackupPolicies(await compartmentIds, this.ociCliCommand),
      force,
    );
  }

  private ensureVolumeBackupPolicy(
    clusterKey: string,
    volumeId: string,
    force = false,
    knownPolicyNames?: ReadonlyMap<string, string | undefined>,
  ): Promise<OciResult<OciBackupPolicyView>> {
    return this.ensureMapValue(
      clusterKey,
      "volumeBackupPolicies",
      volumeId,
      () => fetchVolumeBackupPolicyName(volumeId, this.ociCliCommand, knownPolicyNames),
      force,
    );
  }

  private ensureFssSnapshotPolicy(
    clusterKey: string,
    policyId: string,
    force = false,
    knownPolicyNames?: ReadonlyMap<string, string | undefined>,
  ): Promise<OciResult<OciBackupPolicyView>> {
    return this.ensureMapValue(
      clusterKey,
      "fssSnapshotPolicies",
      policyId,
      () => fetchFssSnapshotPolicyName(policyId, this.ociCliCommand, knownPolicyNames),
      force,
    );
  }

  private ensureFileSystem(clusterKey: string, fsId: string, force = false): Promise<OciResult<OciFileSystem>> {
    return this.ensureMapValue(clusterKey, "fileSystems", fsId, () => fetchFileSystem(fsId, this.ociCliCommand), force);
  }

  private ensureFssExport(clusterKey: string, exportId: string, force = false): Promise<OciResult<OciFssExport>> {
    return this.ensureMapValue(
      clusterKey,
      "fssExports",
      exportId,
      () => fetchFssExport(exportId, this.ociCliCommand),
      force,
    );
  }

  private ensureVcn(clusterKey: string, vcnId: string, force = false): Promise<OciResult<OciVcn>> {
    return this.ensureMapValue(clusterKey, "vcns", vcnId, () => fetchVcn(vcnId, this.ociCliCommand), force);
  }

  /**
   * topologyページのVCN本体取得。列挙元はcluster応答の`vcn-id`のため、cluster失敗は
   * このセクション自体の失敗として記録する(Mapが空になる理由が「VCN無し」と区別できなくなる)。
   */
  private reconcileVcns(clusterKey: string, clusterId: string, force = false): Promise<OciResult<unknown>[]> {
    const epoch = this.epochOf(clusterKey);
    return (async () => {
      const cluster = await this.ensureCluster(clusterKey, clusterId, force);
      const vcnId = cluster.ok ? cluster.data["vcn-id"] : undefined;
      const results = vcnId ? [await this.ensureVcn(clusterKey, vcnId, force)] : [];
      if (this.epochOf(clusterKey) === epoch) {
        this.updateCache(clusterKey, { vcnsReconciled: true });
        this.recordReconcileOutcomes(clusterKey, epoch, [["vcn", cluster]]);
      }
      return results;
    })();
  }

  // per-OCID Map(fileSystemsと同じパターン)のensure共通化。
  private ensureMapValue<T>(
    clusterKey: string,
    mapKey: OcidMapKey,
    id: string,
    fetcher: () => Promise<OciResult<T>>,
    force = false,
  ): Promise<OciResult<T>> {
    return this.ensureSectionValue(
      clusterKey,
      `${mapKey}:${id}`,
      (cache) => (cache[mapKey].get(id) ?? { status: "idle" }) as SectionState<T>,
      (state) => this.updateMapEntry(clusterKey, mapKey, id, state),
      fetcher,
      force,
    );
  }

  private ensureNodePools(
    clusterKey: string,
    clusterId: string,
    compartmentId: string,
    force = false,
  ): Promise<OciResult<OciNodePoolSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "nodePools",
      (cache) => cache.nodePools,
      (state) => this.updateCache(clusterKey, { nodePools: state }),
      () => fetchNodePools(clusterId, compartmentId, this.ociCliCommand),
      force,
    );
  }

  private ensureWafs(
    clusterKey: string,
    anchorCompartmentId: string,
    clusterId: string,
    force = false,
  ): Promise<OciResult<OciWafSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "wafs",
      (cache) => cache.wafs,
      (state) => this.updateCache(clusterKey, { wafs: state }),
      async () =>
        fetchWafs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.ociCliCommand),
      force,
    );
  }

  private ensureSubnet(clusterKey: string, subnetId: string, force = false): Promise<OciResult<OciSubnet>> {
    return this.ensureMapValue(clusterKey, "subnets", subnetId, () => fetchSubnet(subnetId, this.ociCliCommand), force);
  }

  private ensureSecurityList(clusterKey: string, slId: string, force = false): Promise<OciResult<OciSecurityList>> {
    return this.ensureMapValue(
      clusterKey,
      "securityLists",
      slId,
      () => fetchSecurityList(slId, this.ociCliCommand),
      force,
    );
  }

  private ensureRouteTable(clusterKey: string, rtId: string, force = false): Promise<OciResult<OciRouteTable>> {
    return this.ensureMapValue(clusterKey, "routeTables", rtId, () => fetchRouteTable(rtId, this.ociCliCommand), force);
  }

  private ensureNsg(
    clusterKey: string,
    nsgId: string,
    force = false,
    knownNsg?: OciNsg,
  ): Promise<OciResult<OciNsgWithRules>> {
    return this.ensureMapValue(
      clusterKey,
      "nsgs",
      nsgId,
      () => fetchNsgWithRules(nsgId, this.ociCliCommand, knownNsg),
      force,
    );
  }

  private ensureWafPolicy(clusterKey: string, policyId: string, force = false): Promise<OciResult<OciWafPolicy>> {
    return this.ensureMapValue(
      clusterKey,
      "wafPolicies",
      policyId,
      () => fetchWafPolicy(policyId, this.ociCliCommand),
      force,
    );
  }

  private ensureGateway(clusterKey: string, entityId: string, force = false): Promise<OciResult<OciGatewayStatusView>> {
    return this.ensureMapValue(
      clusterKey,
      "gateways",
      entityId,
      () => fetchGatewayStatus(entityId, this.ociCliCommand),
      force,
    );
  }

  private ensureDnsCheck(clusterKey: string, host: string, force = false): Promise<OciResult<string[]>> {
    return this.ensureMapValue(clusterKey, "dnsChecks", host, () => resolveHostIps(host), force);
  }

  private ensureManagedCert(
    clusterKey: string,
    certificateId: string,
    force = false,
  ): Promise<OciResult<OciManagedCertView>> {
    return this.ensureMapValue(
      clusterKey,
      "managedCerts",
      certificateId,
      () => fetchManagedCertificate(certificateId, this.ociCliCommand),
      force,
    );
  }

  /** 型別listの取得結果。seededはlistで埋まったOCID(残りだけper-OCID getへフォールバックする)。 */
  private async fetchVcnNetwork(
    clusterKey: string,
    compartmentIds: string[],
    vcnId: string,
    epoch: number,
  ): Promise<VcnNetwork> {
    const command = this.ociCliCommand;
    const [subnets, routeTables, securityLists, nsgs, gateways] = await Promise.all([
      fetchVcnSubnets(compartmentIds, vcnId, command),
      fetchVcnRouteTables(compartmentIds, vcnId, command),
      fetchVcnSecurityLists(compartmentIds, vcnId, command),
      fetchVcnNsgs(compartmentIds, vcnId, command),
      fetchVcnGateways(compartmentIds, vcnId, command),
    ]);
    const byId = <T extends { id: string }>(result: OciResult<T[]>): [string, T][] =>
      result.ok ? result.data.map((item) => [item.id, item]) : [];
    return {
      subnets: this.seedMapEntries(clusterKey, "subnets", byId(subnets), epoch),
      routeTables: this.seedMapEntries(clusterKey, "routeTables", byId(routeTables), epoch),
      securityLists: this.seedMapEntries(clusterKey, "securityLists", byId(securityLists), epoch),
      gateways: this.seedMapEntries(clusterKey, "gateways", gateways.ok ? gateways.data : [], epoch),
      // NSGはルールが別コマンドのため本体だけ手元に持ち、Mapへはrules listと合わせて書く。
      nsgs: new Map(nsgs.ok ? nsgs.data.map((nsg) => [nsg.id, nsg]) : []),
      results: new Map<VcnListSection, OciResult<unknown>>([
        ["subnets", subnets],
        ["routeTables", routeTables],
        ["securityLists", securityLists],
        ["nsgs", nsgs],
        ["gateways", gateways],
      ]),
    };
  }

  /** listの全件をMapへ一括でready化する。旧世代の結果は書き戻さない。 */
  private seedMapEntries(
    clusterKey: string,
    mapKey: OcidMapKey,
    entries: Iterable<[string, unknown]>,
    epoch: number,
  ): Set<string> {
    const ids = new Set<string>();
    if (this.epochOf(clusterKey) !== epoch) return ids;
    runInAction(() => {
      const cache = this.getCache(clusterKey);
      const map = new Map(cache[mapKey] as Map<string, SectionState<unknown>>);
      const fetchedAt = Date.now();
      for (const [id, data] of entries) {
        map.set(id, { status: "ready", result: { ok: true, data }, fetchedAt });
        ids.add(id);
      }
      this.caches.set(clusterKey, { ...cache, [mapKey]: map } as ClusterCache);
    });
    return ids;
  }

  /**
   * networkページの取得。cluster(vcn-id)とタグ検索(compartment集合)が出揃った時点で型別listを一斉に撃ち、
   * per-OCID getはlistに現れなかったOCIDのフォールバックとしてのみ走る。
   * 一覧・展開の表示単位は表示層がセクション単位で判定する(storeは確定状態だけを持つ)。
   */
  private reconcileNetwork(
    clusterKey: string,
    clusterId: string,
    compartmentId: string,
    force = false,
  ): Promise<OciResult<unknown>[]> {
    if (!force && this.getCache(clusterKey).networkReconciled) return Promise.resolve([]);
    const epoch = this.epochOf(clusterKey);
    const key = `${clusterKey}:e${epoch}:networkReconcile`;
    const existing = this.inFlight.get(key) as Promise<OciResult<unknown>[]> | undefined;
    if (existing) return existing;
    const promise = (async () => {
      const jobs: Promise<OciResult<unknown>>[] = [];
      let listOutcomesRecorded = false;
      let getsCompleted = false;
      try {
        // DNS突合(Ingress/Serviceのホスト名をこの端末のリゾルバで解決する)。
        // K8s照会を挟むためoci側の発火をブロックしない位置で並走させる。
        const dnsWork = (async () => {
          await this.ensureIngressNamespaces(clusterKey);
          const hosts = collectHostnames(Renderer.K8sApi.ingressStore.items, Renderer.K8sApi.serviceStore.items);
          return Promise.all(hosts.map((host) => this.ensureDnsCheck(clusterKey, host, force)));
        })();

        const clusterJob = this.ensureCluster(clusterKey, clusterId, force);
        const taggedJob = this.ensureTaggedResources(clusterKey, clusterId, force);
        const vcnJob = (async (): Promise<VcnNetwork> => {
          const [cluster, taggedResources] = await Promise.all([clusterJob, taggedJob]);
          const vcnId = cluster.ok ? cluster.data["vcn-id"] : undefined;
          const network = vcnId
            ? await this.fetchVcnNetwork(
                clusterKey,
                buildCompartmentIdSet(compartmentId, taggedResources),
                vcnId,
                epoch,
              )
            : EMPTY_VCN_NETWORK;
          // VCNへ辿り着けなければ型別listは撃てていない。その成否はclusterの結果がそのまま表す。
          this.recordReconcileOutcomes(
            clusterKey,
            epoch,
            VCN_LIST_SECTIONS.map((section) => [section, network.results.get(section) ?? cluster] as const),
          );
          listOutcomesRecorded = true;
          return network;
        })();

        const [cluster, taggedResources, nodePools, nlbs, lbs, wafs, vcn] = await Promise.all([
          clusterJob,
          taggedJob,
          this.ensureNodePools(clusterKey, clusterId, compartmentId, force),
          this.ensureNlbs(clusterKey, compartmentId, clusterId, force),
          this.ensureLbs(clusterKey, compartmentId, clusterId, force),
          this.ensureWafs(clusterKey, compartmentId, clusterId, force),
          vcnJob,
          this.ensureServiceNamespaces(clusterKey),
        ]);
        jobs.push(clusterJob, taggedJob, ...[...vcn.results.values()].map((result) => Promise.resolve(result)));

        const deps = { cluster, nodePools, nlbs, lbs };
        // compartment内の無関係なLBのsubnet/NSGまで取得しない(クラスタ関連判定はUI表示と同じ基準)
        const lbIds = clusterLbIds(
          { taggedResources, nlbs, lbs },
          ingressIpsOfServices(Renderer.K8sApi.serviceStore.items),
          internalIpsOfNodes(Renderer.K8sApi.nodesStore.items),
        );
        const missing = (seeded: ReadonlySet<string>, id: string) => force && !seeded.has(id);
        const subnetJobs = collectSubnetIds(deps, lbIds).map((subnetId) =>
          this.ensureSubnet(clusterKey, subnetId, missing(vcn.subnets, subnetId)),
        );
        jobs.push(...subnetJobs);
        const subnetResults = await Promise.all(subnetJobs);
        const rtJobs: Promise<OciResult<OciRouteTable>>[] = [];
        for (const subnet of subnetResults) {
          if (!subnet.ok) continue;
          for (const slId of subnet.data["security-list-ids"] ?? []) {
            jobs.push(this.ensureSecurityList(clusterKey, slId, missing(vcn.securityLists, slId)));
          }
          const routeTableId = subnet.data["route-table-id"];
          if (routeTableId) {
            rtJobs.push(this.ensureRouteTable(clusterKey, routeTableId, missing(vcn.routeTables, routeTableId)));
          }
        }
        jobs.push(...rtJobs);
        // RTのルート宛先ゲートウェイの生死表示(RT応答が出揃ってから対象を確定する)
        const routeTables = (await Promise.all(rtJobs)).filter((rt) => rt.ok).map((rt) => rt.data);
        for (const gatewayId of gatewayIdsOfRouteTables(routeTables)) {
          jobs.push(this.ensureGateway(clusterKey, gatewayId, missing(vcn.gateways, gatewayId)));
        }
        // listener証明書(Certificatesサービス方式)の期限。クラスタ関連のclassic LBのみ対象
        if (lbs.ok) {
          for (const lb of lbs.data) {
            if (!lbIds.has(lb.id)) continue;
            for (const certId of managedCertificateIdsOf(lb)) {
              jobs.push(this.ensureManagedCert(clusterKey, certId, force));
            }
          }
        }
        for (const nsgId of collectNsgIds(deps, lbIds)) {
          jobs.push(this.ensureNsg(clusterKey, nsgId, force, vcn.nsgs.get(nsgId)));
        }
        if (wafs.ok) {
          for (const waf of wafs.data) {
            const policyId = waf["web-app-firewall-policy-id"];
            if (policyId) jobs.push(this.ensureWafPolicy(clusterKey, policyId, force));
          }
        }
        getsCompleted = true;
        // DNSはこの端末のリゾルバの観測でありポーリング自動停止の判定材料にはしない。
        await dnsWork;
      } catch (error) {
        // 途中で落ちても取得済みの分で表示を進める
        const failure: OciResult<unknown> = { ok: false, kind: "internal", raw: { message: String(error) } };
        jobs.push(Promise.resolve(failure));
        if (!listOutcomesRecorded || !getsCompleted) {
          this.recordReconcileOutcomes(
            clusterKey,
            epoch,
            VCN_LIST_SECTIONS.map((section) => [section, failure] as const),
          );
        }
      }
      if (this.epochOf(clusterKey) === epoch) this.updateCache(clusterKey, { networkReconciled: true });
      return Promise.all(jobs);
    })();
    this.inFlight.set(key, promise);
    void promise.catch(() => undefined).finally(() => this.inFlight.delete(key));
    return promise;
  }

  // 全namespace指定でのstore.loadAll()共通化(fileSystemsパターンと同様の重複排除)。
  private loadAllNamespaces(
    clusterKey: string,
    flightKey: string,
    store: { loadAll(opts?: { namespaces: string[] }): Promise<unknown> },
    onDone?: () => void,
  ): Promise<void> {
    const key = `${clusterKey}:${flightKey}`;
    const existing = this.inFlight.get(key) as Promise<void> | undefined;
    if (existing) return existing;
    const promise = (async () => {
      const namespaceStore = Renderer.K8sApi.namespaceStore;
      await namespaceStore.loadAll();
      const names = namespaceStore.items.map((ns) => ns.getName());
      await store.loadAll(names.length > 0 ? { namespaces: names } : undefined);
      onDone?.();
    })();
    this.inFlight.set(key, promise);
    void promise.catch(() => undefined).finally(() => this.inFlight.delete(key));
    return promise;
  }

  private ensureIngressNamespaces(clusterKey: string): Promise<void> {
    return this.loadAllNamespaces(clusterKey, "ingressNamespaces", Renderer.K8sApi.ingressStore);
  }

  private ensureServiceNamespaces(clusterKey: string): Promise<void> {
    if (this.getCache(clusterKey).serviceNamespacesLoaded) return Promise.resolve();
    return this.loadAllNamespaces(clusterKey, "serviceNamespaces", Renderer.K8sApi.serviceStore, () =>
      this.updateCache(clusterKey, { serviceNamespacesLoaded: true }),
    );
  }
}

export const ociClusterStore = new OciClusterStore();
