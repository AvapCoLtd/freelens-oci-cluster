import { Renderer } from "@freelensapp/extensions";
import { action, makeObservable, observable, runInAction } from "mobx";
import { collectHostnames } from "../match/dns-check";
import { gatewayIdsOfRouteTables, type OciGatewayStatusView } from "../match/gateway-status";
import { managedCertificateIdsOf } from "../match/lb-certificates";
import { clusterLbIds, collectNsgIds, collectSubnetIds, internalIpsOfNodes } from "../match/network-path";
import type { OciPage } from "../match/page-sections";
import { sectionsForPage } from "../match/page-sections";
import { pickAnchorInstanceId } from "../match/provider-id";
import {
  distinctBlockVolumeOcids,
  distinctFileSystemOcids,
  getCsiSource,
  newFileSystemOcids,
  resolvePvStorage,
} from "../match/pv-storage";
import { ingressIpsOfServices } from "../match/service-lb";
import { resolveAnchor } from "../sdk/anchor";
import { resolveHostIps } from "../sdk/dns";
import {
  buildCompartmentIdSet,
  type ClusterOciData,
  fetchBackendSetHealth,
  fetchCluster,
  fetchFileSystem,
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
  fetchVolumeBackupPolicyName,
  fetchVolumes,
  fetchWafPolicy,
  fetchWafs,
} from "../sdk/fetch";
import type { OciErrorKind, OciRawErrorInfo, OciResult } from "../sdk/result";
import type {
  OciBackendSetHealthView,
  OciBackupPolicyView,
  OciCluster,
  OciFileSystem,
  OciInstance,
  OciLoadBalancer,
  OciManagedCertView,
  OciNetworkLoadBalancerSummary,
  OciNodePoolSummary,
  OciNsgWithRules,
  OciResourceSummary,
  OciRouteTable,
  OciSecurityList,
  OciSubnet,
  OciVolume,
  OciWafPolicy,
  OciWafSummary,
} from "../sdk/types";

export interface ResolvedAnchor {
  instanceId: string;
  clusterId: string;
  compartmentId: string;
}

export type OciClusterViewState =
  | { status: "not_fetched" }
  | { status: "fetching"; stage: "anchor" | "data" }
  | { status: "non_oke" }
  | { status: "fatal_error"; errorKind: OciErrorKind; raw: OciRawErrorInfo; stage: string }
  | { status: "loaded"; anchor: ResolvedAnchor; data: ClusterOciData; fetchedAt: number };

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

// networkページのper-OCID遅延取得Map群(subnet/SL/RT/NSG)。backendHealthsのみ展開時オンデマンド。
type OcidMapKey =
  | "fileSystems"
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
  fileSystems: Map<string, SectionState<OciFileSystem>>;
  fileSystemsReconciled: boolean;
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
    fileSystems: new Map(),
    fileSystemsReconciled: false,
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
    serviceNamespacesLoaded: false,
    requestedPages: new Set(),
  };
}

const NOT_REQUESTED_MESSAGE = "section not requested for this page";

// ポーリング自動停止の対象(認証系のみ: 30〜60秒ごとの認証コマンド連打・エラー連打を防ぐ)
const POLLING_STOP_ERROR_KINDS: ReadonlySet<OciErrorKind> = new Set([
  "not_authenticated",
  "auth_missing",
  "auth_command",
]);

/** backendHealths Mapのキー(UI側のRecord参照と共有)。 */
export function backendHealthKey(kind: "lb" | "nlb", lbId: string, backendSetName: string): string {
  return `${kind}:${lbId}:${backendSetName}`;
}

function sectionResultOrPlaceholder<T>(section: SectionState<T>): OciResult<T> {
  if (section.status === "ready") return section.result;
  return { ok: false, kind: "not_requested", raw: { message: NOT_REQUESTED_MESSAGE } };
}

/**
 * クラスタ(K8sクラスタID)キー付きのOCIデータキャッシュ。クラスタ切替でのデータ混入を防ぐ。
 * セクション(anchor/cluster共有、instances、taggedResources+nlbs+lbs、volumes+fileSystems)を独立に
 * 取得・キャッシュし、ページが必要とするセクションだけをensureLoadedで開始する(他ページ分は叩かない)。
 */
export class OciClusterStore {
  authCommand = "";

  private readonly caches = observable.map<string, ClusterCache>();
  // クラスタキー+セクション名をキーにした進行中Promiseの登録簿。複数ページから同じセクションが
  // 要求されても1本のfetchにまとめるための単純化(mobxの状態自体は判定に使わない)。
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor() {
    makeObservable(this, {
      authCommand: observable,
      setAuthCommand: action,
    });
  }

  setAuthCommand(value: string): void {
    this.authCommand = value;
  }

  /** ページが表示すべき状態を導出する(未取得/取得中/非OKE/致命エラー/取得済み)。 */
  getState(clusterKey: string, page: OciPage): OciClusterViewState {
    const cache = this.getCache(clusterKey);
    switch (cache.anchor.status) {
      case "idle":
        return { status: "not_fetched" };
      case "loading":
        return { status: "fetching", stage: "anchor" };
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
    const anchor = cache.anchor.anchor;
    if (cache.cluster.status !== "ready" || !this.pageSectionsReady(cache, page)) {
      return { status: "fetching", stage: "data" };
    }
    return {
      status: "loaded",
      anchor,
      data: this.buildClusterOciData(cache),
      fetchedAt: this.computeFetchedAt(cache, page),
    };
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
    const patch: Partial<ClusterCache> = { anchor: { status: "idle" }, cluster: { status: "idle" } };
    for (const key of sectionsForPage(page)) {
      if (key === "fileSystems") {
        patch.fileSystems = new Map();
        patch.fileSystemsReconciled = false;
        patch.volumeBackupPolicies = new Map();
        patch.fssSnapshotPolicies = new Map();
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
        continue;
      }
      patch[key] = { status: "idle" };
    }
    if (page === "service-lb") patch.serviceNamespacesLoaded = false;
    this.updateCache(clusterKey, patch);
    this.ensureLoaded(clusterKey, page);
  }

  /**
   * ポーリング用: ページのセクションを旧データ表示のまま裏で再取得する(force=stale-while-revalidate)。
   * anchor再解決はしない。map系は既存エントリの再取得のみで、新規リソースの発見は手動[更新]の役割。
   * 戻り値は認証系エラーの種別(検出時のみ)で、呼び出し元がポーリング自動停止に使う。
   */
  async pollRefresh(clusterKey: string, page: OciPage): Promise<OciErrorKind | undefined> {
    const cache = this.getCache(clusterKey);
    if (cache.anchor.status !== "resolved") return undefined;
    const { clusterId, compartmentId } = cache.anchor.anchor;
    const sections = sectionsForPage(page);
    const jobs: Promise<OciResult<unknown>>[] = [this.ensureCluster(clusterKey, clusterId, true)];
    if (sections.includes("instances")) jobs.push(this.ensureInstances(clusterKey, compartmentId, true));
    if (sections.includes("taggedResources")) jobs.push(this.ensureTaggedResources(clusterKey, clusterId, true));
    if (sections.includes("nlbs")) jobs.push(this.ensureNlbs(clusterKey, compartmentId, clusterId, true));
    if (sections.includes("lbs")) jobs.push(this.ensureLbs(clusterKey, compartmentId, clusterId, true));
    if (sections.includes("volumes")) jobs.push(this.ensureVolumes(clusterKey, compartmentId, clusterId, true));
    if (sections.includes("nodePools")) jobs.push(this.ensureNodePools(clusterKey, clusterId, compartmentId, true));
    if (sections.includes("wafs")) jobs.push(this.ensureWafs(clusterKey, compartmentId, clusterId, true));
    if (sections.includes("fileSystems")) {
      for (const id of cache.fileSystems.keys()) jobs.push(this.ensureFileSystem(clusterKey, id, true));
      for (const id of cache.volumeBackupPolicies.keys())
        jobs.push(this.ensureVolumeBackupPolicy(clusterKey, id, true));
      for (const id of cache.fssSnapshotPolicies.keys()) jobs.push(this.ensureFssSnapshotPolicy(clusterKey, id, true));
    }
    if (sections.includes("network")) {
      for (const id of cache.subnets.keys()) jobs.push(this.ensureSubnet(clusterKey, id, true));
      for (const id of cache.securityLists.keys()) jobs.push(this.ensureSecurityList(clusterKey, id, true));
      for (const id of cache.routeTables.keys()) jobs.push(this.ensureRouteTable(clusterKey, id, true));
      for (const id of cache.nsgs.keys()) jobs.push(this.ensureNsg(clusterKey, id, true));
      for (const id of cache.wafPolicies.keys()) jobs.push(this.ensureWafPolicy(clusterKey, id, true));
      for (const id of cache.gateways.keys()) jobs.push(this.ensureGateway(clusterKey, id, true));
      for (const id of cache.dnsChecks.keys()) jobs.push(this.ensureDnsCheck(clusterKey, id, true));
      for (const id of cache.managedCerts.keys()) jobs.push(this.ensureManagedCert(clusterKey, id, true));
      for (const key of cache.backendHealths.keys()) {
        const [kind, lbId, ...nameParts] = key.split(":");
        jobs.push(
          this.ensureMapValue(
            clusterKey,
            "backendHealths",
            key,
            () => fetchBackendSetHealth(kind as "lb" | "nlb", lbId, nameParts.join(":"), this.authCommand),
            true,
          ),
        );
      }
    }
    const results = await Promise.all(jobs);
    const authError = results.find((result) => !result.ok && POLLING_STOP_ERROR_KINDS.has(result.kind));
    return authError && !authError.ok ? authError.kind : undefined;
  }

  /** backend health(展開時オンデマンド)の取得開始。キーは kind:lbId:backendSetName。 */
  ensureBackendHealth(clusterKey: string, kind: "lb" | "nlb", lbId: string, backendSetName: string): void {
    const id = backendHealthKey(kind, lbId, backendSetName);
    void this.ensureMapValue(clusterKey, "backendHealths", id, () =>
      fetchBackendSetHealth(kind, lbId, backendSetName, this.authCommand),
    );
  }

  reloadBackendHealth(clusterKey: string, kind: "lb" | "nlb", lbId: string, backendSetName: string): void {
    const id = backendHealthKey(kind, lbId, backendSetName);
    this.updateMapEntry(clusterKey, "backendHealths", id, { status: "idle" });
    this.ensureBackendHealth(clusterKey, kind, lbId, backendSetName);
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

  private pageSectionsReady(cache: ClusterCache, page: OciPage): boolean {
    for (const key of sectionsForPage(page)) {
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

  private fileSystemsSettled(cache: ClusterCache): boolean {
    if (!cache.fileSystemsReconciled) return false;
    for (const state of cache.fileSystems.values()) {
      if (state.status !== "ready") return false;
    }
    return true;
  }

  // backendHealthsは展開時オンデマンドのためページreadyの条件に含めない。
  private networkSettled(cache: ClusterCache): boolean {
    if (!cache.networkReconciled) return false;
    for (const map of [
      cache.subnets,
      cache.securityLists,
      cache.routeTables,
      cache.nsgs,
      cache.wafPolicies,
      cache.gateways,
      cache.dnsChecks,
      cache.managedCerts,
    ]) {
      for (const state of map.values()) {
        if (state.status !== "ready") return false;
      }
    }
    return true;
  }

  private computeFetchedAt(cache: ClusterCache, page: OciPage): number {
    const timestamps: number[] = [];
    const pushMap = (map: Map<string, SectionState<unknown>>) => {
      for (const state of map.values()) {
        if (state.status === "ready") timestamps.push(state.fetchedAt);
      }
    };
    if (cache.cluster.status === "ready") timestamps.push(cache.cluster.fetchedAt);
    for (const key of sectionsForPage(page)) {
      if (key === "fileSystems") {
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
    return timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
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
    this.updateCache(clusterKey, { anchor: { status: "loading" } });
    const key = `${clusterKey}:anchor`;
    const promise = this.runAnchor(clusterKey);
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
  }

  private async runAnchor(clusterKey: string): Promise<void> {
    try {
      const nodeStore = Renderer.K8sApi.nodesStore;
      await nodeStore.loadAll();
      const instanceId = pickAnchorInstanceId(nodeStore.items.map((node) => node.spec.providerID));
      if (!instanceId) {
        this.updateCache(clusterKey, { anchor: { status: "non_oke" } });
        return;
      }
      const result = await resolveAnchor(instanceId, this.authCommand);
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

    if (sections.includes("instances")) void this.ensureInstances(clusterKey, compartmentId);
    if (sections.includes("taggedResources")) void this.ensureTaggedResources(clusterKey, clusterId);
    if (sections.includes("nlbs")) void this.ensureNlbs(clusterKey, compartmentId, clusterId);
    if (sections.includes("lbs")) void this.ensureLbs(clusterKey, compartmentId, clusterId);
    if (sections.includes("volumes")) void this.ensureVolumes(clusterKey, compartmentId, clusterId);
    if (sections.includes("fileSystems")) void this.reconcileFileSystems(clusterKey);
    if (sections.includes("nodePools")) void this.ensureNodePools(clusterKey, clusterId, compartmentId);
    if (sections.includes("wafs")) void this.ensureWafs(clusterKey, compartmentId, clusterId);
    if (sections.includes("network")) void this.reconcileNetwork(clusterKey, clusterId, compartmentId);
    if (page === "service-lb") void this.ensureServiceNamespaces(clusterKey);
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
    const key = `${clusterKey}:${flightKey}`;
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
        setState({ status: "ready", result, fetchedAt: Date.now() });
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
      () => fetchCluster(clusterId, this.authCommand),
      force,
    );
  }

  private ensureInstances(clusterKey: string, compartmentId: string, force = false): Promise<OciResult<OciInstance[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "instances",
      (cache) => cache.instances,
      (state) => this.updateCache(clusterKey, { instances: state }),
      () => fetchInstances(compartmentId, this.authCommand),
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
      () => fetchTaggedResources(clusterId, this.authCommand),
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
      async () => fetchNlbs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.authCommand),
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
      async () => fetchLbs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.authCommand),
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
        fetchVolumes(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.authCommand),
      force,
    );
  }

  // ライブPV変化への自動追従はしない(既存の手動更新方針を踏襲): 新規FSSは次回のensureLoaded/refreshで拾う。
  private async reconcileFileSystems(clusterKey: string): Promise<void> {
    const pvStore = Renderer.K8sApi.persistentVolumeStore;
    await pvStore.loadAll();
    const resolutions = pvStore.items.map((pv) => {
      const csi = getCsiSource(pv.spec);
      return resolvePvStorage(csi?.driver, csi?.volumeHandle);
    });
    const distinctOcids = distinctFileSystemOcids(resolutions);
    const cache = this.getCache(clusterKey);
    const toStart = newFileSystemOcids(distinctOcids, new Set(cache.fileSystems.keys()));
    this.updateCache(clusterKey, { fileSystemsReconciled: true });
    for (const fsId of toStart) {
      // FSSのスナップショットポリシー名はFileSystem応答のpolicyIdが分かってから引く
      void this.ensureFileSystem(clusterKey, fsId).then((result) => {
        if (result.ok && result.data.filesystemSnapshotPolicyId) {
          void this.ensureFssSnapshotPolicy(clusterKey, result.data.filesystemSnapshotPolicyId);
        }
      });
    }
    for (const volumeId of distinctBlockVolumeOcids(resolutions)) {
      void this.ensureVolumeBackupPolicy(clusterKey, volumeId);
    }
  }

  private ensureVolumeBackupPolicy(
    clusterKey: string,
    volumeId: string,
    force = false,
  ): Promise<OciResult<OciBackupPolicyView>> {
    return this.ensureMapValue(
      clusterKey,
      "volumeBackupPolicies",
      volumeId,
      () => fetchVolumeBackupPolicyName(volumeId, this.authCommand),
      force,
    );
  }

  private ensureFssSnapshotPolicy(
    clusterKey: string,
    policyId: string,
    force = false,
  ): Promise<OciResult<OciBackupPolicyView>> {
    return this.ensureMapValue(
      clusterKey,
      "fssSnapshotPolicies",
      policyId,
      () => fetchFssSnapshotPolicyName(policyId, this.authCommand),
      force,
    );
  }

  private ensureFileSystem(clusterKey: string, fsId: string, force = false): Promise<OciResult<OciFileSystem>> {
    return this.ensureMapValue(clusterKey, "fileSystems", fsId, () => fetchFileSystem(fsId, this.authCommand), force);
  }

  // per-OCID Map(設計 Decision #10: fileSystemsパターン)のensure共通化。
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
      () => fetchNodePools(clusterId, compartmentId, this.authCommand),
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
      async () => fetchWafs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.authCommand),
      force,
    );
  }

  private ensureSubnet(clusterKey: string, subnetId: string, force = false): Promise<OciResult<OciSubnet>> {
    return this.ensureMapValue(clusterKey, "subnets", subnetId, () => fetchSubnet(subnetId, this.authCommand), force);
  }

  private ensureSecurityList(clusterKey: string, slId: string, force = false): Promise<OciResult<OciSecurityList>> {
    return this.ensureMapValue(
      clusterKey,
      "securityLists",
      slId,
      () => fetchSecurityList(slId, this.authCommand),
      force,
    );
  }

  private ensureRouteTable(clusterKey: string, rtId: string, force = false): Promise<OciResult<OciRouteTable>> {
    return this.ensureMapValue(clusterKey, "routeTables", rtId, () => fetchRouteTable(rtId, this.authCommand), force);
  }

  private ensureNsg(clusterKey: string, nsgId: string, force = false): Promise<OciResult<OciNsgWithRules>> {
    return this.ensureMapValue(clusterKey, "nsgs", nsgId, () => fetchNsgWithRules(nsgId, this.authCommand), force);
  }

  private ensureWafPolicy(clusterKey: string, policyId: string, force = false): Promise<OciResult<OciWafPolicy>> {
    return this.ensureMapValue(
      clusterKey,
      "wafPolicies",
      policyId,
      () => fetchWafPolicy(policyId, this.authCommand),
      force,
    );
  }

  private ensureGateway(clusterKey: string, entityId: string, force = false): Promise<OciResult<OciGatewayStatusView>> {
    return this.ensureMapValue(
      clusterKey,
      "gateways",
      entityId,
      () => fetchGatewayStatus(entityId, this.authCommand),
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
      () => fetchManagedCertificate(certificateId, this.authCommand),
      force,
    );
  }

  /**
   * networkページの3ウェーブ取得(設計 データフロー):
   * wave1=依存セクション(cluster/nodePools/nlbs/lbs) → wave2=subnet集合 → wave3=SL/RT/NSG。
   * wave3の開始後にreconciledを立て、readyの成立はnetworkSettled(全Mapエントリready)が担う。
   */
  private async reconcileNetwork(clusterKey: string, clusterId: string, compartmentId: string): Promise<void> {
    if (this.getCache(clusterKey).networkReconciled) return;
    const key = `${clusterKey}:networkReconcile`;
    const existing = this.inFlight.get(key) as Promise<void> | undefined;
    if (existing) return existing;
    const promise = (async () => {
      const [cluster, nodePools, nlbs, lbs, taggedResources, wafs] = await Promise.all([
        this.ensureCluster(clusterKey, clusterId),
        this.ensureNodePools(clusterKey, clusterId, compartmentId),
        this.ensureNlbs(clusterKey, compartmentId, clusterId),
        this.ensureLbs(clusterKey, compartmentId, clusterId),
        this.ensureTaggedResources(clusterKey, clusterId),
        this.ensureWafs(clusterKey, compartmentId, clusterId),
        this.ensureServiceNamespaces(clusterKey),
      ]);
      const deps = { cluster, nodePools, nlbs, lbs };
      // compartment内の無関係なLBのsubnet/NSGまで取得しない(クラスタ関連判定はUI表示と同じ基準)
      const lbIds = clusterLbIds(
        { taggedResources, nlbs, lbs },
        ingressIpsOfServices(Renderer.K8sApi.serviceStore.items),
        internalIpsOfNodes(Renderer.K8sApi.nodesStore.items),
      );
      const subnetResults = await Promise.all(
        collectSubnetIds(deps, lbIds).map((subnetId) => this.ensureSubnet(clusterKey, subnetId)),
      );
      const rtPromises: Promise<OciResult<OciRouteTable>>[] = [];
      for (const subnet of subnetResults) {
        if (!subnet.ok) continue;
        for (const slId of subnet.data.securityListIds ?? []) void this.ensureSecurityList(clusterKey, slId);
        if (subnet.data.routeTableId) rtPromises.push(this.ensureRouteTable(clusterKey, subnet.data.routeTableId));
      }
      // RTのルート宛先ゲートウェイの生死表示(RT応答が出揃ってから対象を確定する)
      const routeTables = (await Promise.all(rtPromises)).filter((rt) => rt.ok).map((rt) => rt.data);
      for (const gatewayId of gatewayIdsOfRouteTables(routeTables)) void this.ensureGateway(clusterKey, gatewayId);
      // listener証明書(Certificatesサービス方式)の期限。クラスタ関連のclassic LBのみ対象
      if (lbs.ok) {
        for (const lb of lbs.data) {
          if (!lbIds.has(lb.id)) continue;
          for (const certId of managedCertificateIdsOf(lb)) void this.ensureManagedCert(clusterKey, certId);
        }
      }
      // DNS突合(Ingress/Serviceのホスト名をこの端末のリゾルバで解決する)
      await this.ensureIngressNamespaces(clusterKey);
      const hosts = collectHostnames(Renderer.K8sApi.ingressStore.items, Renderer.K8sApi.serviceStore.items);
      for (const host of hosts) void this.ensureDnsCheck(clusterKey, host);
      for (const nsgId of collectNsgIds(deps, lbIds)) void this.ensureNsg(clusterKey, nsgId);
      if (wafs.ok) {
        for (const waf of wafs.data) {
          const policyId = waf.webAppFirewallPolicyId;
          if (policyId) void this.ensureWafPolicy(clusterKey, policyId);
        }
      }
      this.updateCache(clusterKey, { networkReconciled: true });
    })();
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
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
    promise.finally(() => this.inFlight.delete(key));
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
