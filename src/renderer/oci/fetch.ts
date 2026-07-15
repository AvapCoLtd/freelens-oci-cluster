import { runOci, runOciBareArrayList, runOciItemsList } from "./run";
import type {
  CliResult,
  OciClusterSummary,
  OciFileSystemSummary,
  OciInstanceSummary,
  OciLoadBalancerSummary,
  OciNetworkLoadBalancerSummary,
  OciSearchResourceSummary,
  OciVolumeSummary,
} from "./types";

export interface ClusterOciData {
  cluster: CliResult<OciClusterSummary>;
  instances: CliResult<OciInstanceSummary[]>;
  taggedResources: CliResult<OciSearchResourceSummary[]>;
  nlbs: CliResult<OciNetworkLoadBalancerSummary[]>;
  lbs: CliResult<OciLoadBalancerSummary[]>;
  volumes: CliResult<OciVolumeSummary[]>;
  fileSystems: Record<string, CliResult<OciFileSystemSummary>>;
}

function unwrapData<T>(result: CliResult<{ data: T }>): CliResult<T> {
  return result.ok ? { ok: true, data: result.data.data } : result;
}

function compartmentScoped(baseArgs: string[], compartmentId: string): string[] {
  return [...baseArgs, "--compartment-id", compartmentId, "--all"];
}

// 後処理(結合等)で例外が出てもセクション単位の失敗に留める(呼び出し元を拒否させない)。
async function toSectionResult<T>(promise: Promise<CliResult<T>>): Promise<CliResult<T>> {
  try {
    return await promise;
  } catch (error) {
    return { ok: false, kind: "internal", raw: { message: String(error), stderr: "" } };
  }
}

/** compartmentごとにfetchOneを実行し、結果をidで重複排除して結合する。1つでも失敗すればセクション全体を失敗として返す。 */
async function listAcrossCompartments<T extends { id: string }>(
  fetchOne: (compartmentId: string) => Promise<CliResult<T[]>>,
  compartmentIds: string[],
): Promise<CliResult<T[]>> {
  const results = await Promise.all(compartmentIds.map(fetchOne));
  const merged = new Map<string, T>();
  for (const result of results) {
    if (!result.ok) return result;
    for (const item of result.data) merged.set(item.id, item);
  }
  return { ok: true, data: [...merged.values()] };
}

// クラスタ固有タグ(CreatedBy=clusterId)によるテナンシ横断検索。OKE/CCM作成のNLB・Volumeが対象(実テナンシ検証済み)。
// compartment指定は不要(構造化検索はcompartmentをまたいで検索できるため、経路4の「残骸検出」役割に合致する)。
function buildTaggedResourcesQuery(clusterId: string): string {
  return `query all resources where (definedTags.namespace = 'Oracle-Tags' && definedTags.key = 'CreatedBy' && definedTags.value = '${clusterId}')`;
}

/** アンカーcompartmentと、タグ検索結果由来のcompartment-idを合わせた重複なしの集合を作る。 */
export function buildCompartmentIdSet(
  anchorCompartmentId: string,
  taggedResources: CliResult<OciSearchResourceSummary[]>,
): string[] {
  const ids = new Set<string>([anchorCompartmentId]);
  if (taggedResources.ok) {
    for (const item of taggedResources.data) {
      const compartmentId = item["compartment-id"];
      if (compartmentId) ids.add(compartmentId);
    }
  }
  return [...ids];
}

// #2 クラスタ情報(共有: どのページでも必要、ヘッダ表示用)。
export function fetchCluster(clusterId: string, overrideCommand: string): Promise<CliResult<OciClusterSummary>> {
  return toSectionResult(
    runOci<{ data: OciClusterSummary }>(["ce", "cluster", "get", "--cluster-id", clusterId], overrideCommand).then(
      unwrapData,
    ),
  );
}

// #3 ノード詳細(nodesページ)。
export function fetchInstances(
  compartmentId: string,
  overrideCommand: string,
): Promise<CliResult<OciInstanceSummary[]>> {
  return toSectionResult(
    runOciBareArrayList<OciInstanceSummary>(
      compartmentScoped(["compute", "instance", "list"], compartmentId),
      overrideCommand,
    ),
  );
}

// #4 タグ検索(service-lb/pv-storageページ共有)。
export function fetchTaggedResources(
  clusterId: string,
  overrideCommand: string,
): Promise<CliResult<OciSearchResourceSummary[]>> {
  return toSectionResult(
    runOciItemsList<OciSearchResourceSummary>(
      ["search", "resource", "structured-search", "--query-text", buildTaggedResourcesQuery(clusterId)],
      overrideCommand,
    ),
  );
}

// #5 NLB一覧(service-lbページ)。nlb listは"data.items"形式(実機確認済み)。
export function fetchNlbs(
  compartmentIds: string[],
  overrideCommand: string,
): Promise<CliResult<OciNetworkLoadBalancerSummary[]>> {
  return toSectionResult(
    listAcrossCompartments<OciNetworkLoadBalancerSummary>(
      (compartmentId) =>
        runOciItemsList(compartmentScoped(["nlb", "network-load-balancer", "list"], compartmentId), overrideCommand),
      compartmentIds,
    ),
  );
}

// #6 classic LB一覧(service-lbページ)。
export function fetchLbs(
  compartmentIds: string[],
  overrideCommand: string,
): Promise<CliResult<OciLoadBalancerSummary[]>> {
  return toSectionResult(
    listAcrossCompartments<OciLoadBalancerSummary>(
      (compartmentId) =>
        runOciBareArrayList(compartmentScoped(["lb", "load-balancer", "list"], compartmentId), overrideCommand),
      compartmentIds,
    ),
  );
}

// #7 Volume一覧(pv-storageページ)。
export function fetchVolumes(
  compartmentIds: string[],
  overrideCommand: string,
): Promise<CliResult<OciVolumeSummary[]>> {
  return toSectionResult(
    listAcrossCompartments<OciVolumeSummary>(
      (compartmentId) =>
        runOciBareArrayList(compartmentScoped(["bv", "volume", "list"], compartmentId), overrideCommand),
      compartmentIds,
    ),
  );
}

// #8 FSS名前解決(pv-storageページ、distinct FileSystem OCIDごとに1回)。
export function fetchFileSystem(fsId: string, overrideCommand: string): Promise<CliResult<OciFileSystemSummary>> {
  return toSectionResult(
    runOci<{ data: OciFileSystemSummary }>(
      ["fs", "file-system", "get", "--file-system-id", fsId],
      overrideCommand,
    ).then(unwrapData),
  );
}
