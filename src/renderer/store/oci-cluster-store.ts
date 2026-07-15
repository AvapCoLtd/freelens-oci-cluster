import { Renderer } from "@freelensapp/extensions";
import { action, makeObservable, observable, runInAction } from "mobx";
import type { CliErrorKind, CliRawErrorInfo } from "../match/classify-cli-error";
import type { OciPage } from "../match/page-sections";
import { sectionsForPage } from "../match/page-sections";
import { pickAnchorInstanceId } from "../match/provider-id";
import { distinctFileSystemOcids, getCsiSource, newFileSystemOcids, resolvePvStorage } from "../match/pv-storage";
import { resolveAnchor } from "../oci/anchor";
import {
  buildCompartmentIdSet,
  type ClusterOciData,
  fetchCluster,
  fetchFileSystem,
  fetchInstances,
  fetchLbs,
  fetchNlbs,
  fetchTaggedResources,
  fetchVolumes,
} from "../oci/fetch";
import type {
  CliResult,
  OciClusterSummary,
  OciFileSystemSummary,
  OciInstanceSummary,
  OciLoadBalancerSummary,
  OciNetworkLoadBalancerSummary,
  OciSearchResourceSummary,
  OciVolumeSummary,
} from "../oci/types";

export interface ResolvedAnchor {
  instanceId: string;
  clusterId: string;
  compartmentId: string;
}

export type OciClusterViewState =
  | { status: "not_fetched" }
  | { status: "fetching"; stage: "anchor" | "data" }
  | { status: "non_oke" }
  | { status: "fatal_error"; errorKind: CliErrorKind; raw: CliRawErrorInfo; stage: string }
  | { status: "loaded"; anchor: ResolvedAnchor; data: ClusterOciData; fetchedAt: number };

type AnchorState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "non_oke" }
  | { status: "error"; errorKind: CliErrorKind; raw: CliRawErrorInfo; stage: string }
  | { status: "resolved"; anchor: ResolvedAnchor; fetchedAt: number };

type SectionState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: CliResult<T>; fetchedAt: number };

interface ClusterCache {
  anchor: AnchorState;
  cluster: SectionState<OciClusterSummary>;
  instances: SectionState<OciInstanceSummary[]>;
  taggedResources: SectionState<OciSearchResourceSummary[]>;
  nlbs: SectionState<OciNetworkLoadBalancerSummary[]>;
  lbs: SectionState<OciLoadBalancerSummary[]>;
  volumes: SectionState<OciVolumeSummary[]>;
  fileSystems: Map<string, SectionState<OciFileSystemSummary>>;
  fileSystemsReconciled: boolean;
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
    fileSystems: new Map(),
    fileSystemsReconciled: false,
    serviceNamespacesLoaded: false,
    requestedPages: new Set(),
  };
}

const NOT_REQUESTED_MESSAGE = "section not requested for this page";

function sectionResultOrPlaceholder<T>(section: SectionState<T>): CliResult<T> {
  if (section.status === "ready") return section.result;
  return { ok: false, kind: "not_requested", raw: { message: NOT_REQUESTED_MESSAGE, stderr: "" } };
}

/**
 * クラスタ(K8sクラスタID)キー付きのOCIデータキャッシュ。クラスタ切替でのデータ混入を防ぐ。
 * セクション(anchor/cluster共有、instances、taggedResources+nlbs+lbs、volumes+fileSystems)を独立に
 * 取得・キャッシュし、ページが必要とするセクションだけをensureLoadedで開始する(他ページ分は叩かない)。
 */
export class OciClusterStore {
  overrideCommand = "";

  private readonly caches = observable.map<string, ClusterCache>();
  // クラスタキー+セクション名をキーにした進行中Promiseの登録簿。複数ページから同じセクションが
  // 要求されても1本のfetchにまとめるための単純化(mobxの状態自体は判定に使わない)。
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor() {
    makeObservable(this, {
      overrideCommand: observable,
      setOverrideCommand: action,
    });
  }

  setOverrideCommand(value: string): void {
    this.overrideCommand = value;
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
        continue;
      }
      patch[key] = { status: "idle" };
    }
    if (page === "service-lb") patch.serviceNamespacesLoaded = false;
    this.updateCache(clusterKey, patch);
    this.ensureLoaded(clusterKey, page);
  }

  private getCache(clusterKey: string): ClusterCache {
    return this.caches.get(clusterKey) ?? createIdleCache();
  }

  private updateCache(clusterKey: string, patch: Partial<ClusterCache>): void {
    runInAction(() => {
      this.caches.set(clusterKey, { ...this.getCache(clusterKey), ...patch });
    });
  }

  private updateFileSystem(clusterKey: string, fsId: string, state: SectionState<OciFileSystemSummary>): void {
    runInAction(() => {
      const cache = this.getCache(clusterKey);
      const fileSystems = new Map(cache.fileSystems);
      fileSystems.set(fsId, state);
      this.caches.set(clusterKey, { ...cache, fileSystems });
    });
  }

  private pageSectionsReady(cache: ClusterCache, page: OciPage): boolean {
    for (const key of sectionsForPage(page)) {
      if (key === "fileSystems") {
        if (!this.fileSystemsSettled(cache)) return false;
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

  private computeFetchedAt(cache: ClusterCache, page: OciPage): number {
    const timestamps: number[] = [];
    if (cache.cluster.status === "ready") timestamps.push(cache.cluster.fetchedAt);
    for (const key of sectionsForPage(page)) {
      if (key === "fileSystems") {
        for (const state of cache.fileSystems.values()) {
          if (state.status === "ready") timestamps.push(state.fetchedAt);
        }
        continue;
      }
      const section = cache[key];
      if (section.status === "ready") timestamps.push(section.fetchedAt);
    }
    return timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
  }

  private buildClusterOciData(cache: ClusterCache): ClusterOciData {
    const fileSystems: Record<string, CliResult<OciFileSystemSummary>> = {};
    for (const [ocid, state] of cache.fileSystems) {
      if (state.status === "ready") fileSystems[ocid] = state.result;
    }
    return {
      cluster: sectionResultOrPlaceholder(cache.cluster),
      instances: sectionResultOrPlaceholder(cache.instances),
      taggedResources: sectionResultOrPlaceholder(cache.taggedResources),
      nlbs: sectionResultOrPlaceholder(cache.nlbs),
      lbs: sectionResultOrPlaceholder(cache.lbs),
      volumes: sectionResultOrPlaceholder(cache.volumes),
      fileSystems,
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
      const result = await resolveAnchor(instanceId, this.overrideCommand);
      if (result.kind === "non_oke") {
        this.updateCache(clusterKey, { anchor: { status: "non_oke" } });
        return;
      }
      if (result.kind === "cli_error") {
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
            raw: { message: result.detail, stderr: "" },
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
          raw: { message: String(error), stderr: "" },
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
    if (page === "service-lb") void this.ensureServiceNamespaces(clusterKey);
  }

  private ensureSectionValue<T>(
    clusterKey: string,
    flightKey: string,
    getCurrent: (cache: ClusterCache) => SectionState<T>,
    setState: (state: SectionState<T>) => void,
    fetcher: () => Promise<CliResult<T>>,
  ): Promise<CliResult<T>> {
    const current = getCurrent(this.getCache(clusterKey));
    if (current.status === "ready") return Promise.resolve(current.result);
    const key = `${clusterKey}:${flightKey}`;
    const existing = this.inFlight.get(key) as Promise<CliResult<T>> | undefined;
    if (existing) return existing;
    setState({ status: "loading" });
    const promise = fetcher()
      .catch(
        (error: unknown): CliResult<T> => ({
          ok: false,
          kind: "internal",
          raw: { message: String(error), stderr: "" },
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

  private ensureCluster(clusterKey: string, clusterId: string): Promise<CliResult<OciClusterSummary>> {
    return this.ensureSectionValue(
      clusterKey,
      "cluster",
      (cache) => cache.cluster,
      (state) => this.updateCache(clusterKey, { cluster: state }),
      () => fetchCluster(clusterId, this.overrideCommand),
    );
  }

  private ensureInstances(clusterKey: string, compartmentId: string): Promise<CliResult<OciInstanceSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "instances",
      (cache) => cache.instances,
      (state) => this.updateCache(clusterKey, { instances: state }),
      () => fetchInstances(compartmentId, this.overrideCommand),
    );
  }

  private ensureTaggedResources(clusterKey: string, clusterId: string): Promise<CliResult<OciSearchResourceSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "taggedResources",
      (cache) => cache.taggedResources,
      (state) => this.updateCache(clusterKey, { taggedResources: state }),
      () => fetchTaggedResources(clusterId, this.overrideCommand),
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
  ): Promise<CliResult<OciNetworkLoadBalancerSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "nlbs",
      (cache) => cache.nlbs,
      (state) => this.updateCache(clusterKey, { nlbs: state }),
      async () =>
        fetchNlbs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.overrideCommand),
    );
  }

  private ensureLbs(
    clusterKey: string,
    anchorCompartmentId: string,
    clusterId: string,
  ): Promise<CliResult<OciLoadBalancerSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "lbs",
      (cache) => cache.lbs,
      (state) => this.updateCache(clusterKey, { lbs: state }),
      async () =>
        fetchLbs(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.overrideCommand),
    );
  }

  private ensureVolumes(
    clusterKey: string,
    anchorCompartmentId: string,
    clusterId: string,
  ): Promise<CliResult<OciVolumeSummary[]>> {
    return this.ensureSectionValue(
      clusterKey,
      "volumes",
      (cache) => cache.volumes,
      (state) => this.updateCache(clusterKey, { volumes: state }),
      async () =>
        fetchVolumes(await this.compartmentIdsFor(clusterKey, anchorCompartmentId, clusterId), this.overrideCommand),
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
      void this.ensureFileSystem(clusterKey, fsId);
    }
  }

  private ensureFileSystem(clusterKey: string, fsId: string): Promise<CliResult<OciFileSystemSummary>> {
    return this.ensureSectionValue(
      clusterKey,
      `fs:${fsId}`,
      (cache) => cache.fileSystems.get(fsId) ?? { status: "idle" },
      (state) => this.updateFileSystem(clusterKey, fsId, state),
      () => fetchFileSystem(fsId, this.overrideCommand),
    );
  }

  private async ensureServiceNamespaces(clusterKey: string): Promise<void> {
    if (this.getCache(clusterKey).serviceNamespacesLoaded) return;
    const key = `${clusterKey}:serviceNamespaces`;
    const existing = this.inFlight.get(key) as Promise<void> | undefined;
    if (existing) return existing;
    const promise = (async () => {
      const namespaceStore = Renderer.K8sApi.namespaceStore;
      const serviceStore = Renderer.K8sApi.serviceStore;
      await namespaceStore.loadAll();
      const names = namespaceStore.items.map((ns) => ns.getName());
      await serviceStore.loadAll(names.length > 0 ? { namespaces: names } : undefined);
      this.updateCache(clusterKey, { serviceNamespacesLoaded: true });
    })();
    this.inFlight.set(key, promise);
    promise.finally(() => this.inFlight.delete(key));
    return promise;
  }
}

export const ociClusterStore = new OciClusterStore();
