import * as resourcesearch from "oci-resourcesearch";
import { classifyOciError } from "../match/classify-oci-error";
import { gatewayKindOf, type OciGatewayStatusView } from "../match/gateway-status";
import { routeEntityKind } from "../match/network-path";
import { getAuth, type ResolvedAuth, reresolveAuth } from "./auth";
import { createClients, type OciClients } from "./clients";
import type { OciResult } from "./result";
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
} from "./types";

export interface ClusterOciData {
  cluster: OciResult<OciCluster>;
  instances: OciResult<OciInstance[]>;
  taggedResources: OciResult<OciResourceSummary[]>;
  nlbs: OciResult<OciNetworkLoadBalancerSummary[]>;
  lbs: OciResult<OciLoadBalancer[]>;
  volumes: OciResult<OciVolume[]>;
  fileSystems: Record<string, OciResult<OciFileSystem>>;
  nodePools: OciResult<OciNodePoolSummary[]>;
  wafs: OciResult<OciWafSummary[]>;
  // per-OCID遅延取得のRecord: エントリ不在=取得中(UI側は「取得中」表示に落とす)。
  subnets: Record<string, OciResult<OciSubnet>>;
  securityLists: Record<string, OciResult<OciSecurityList>>;
  routeTables: Record<string, OciResult<OciRouteTable>>;
  nsgs: Record<string, OciResult<OciNsgWithRules>>;
  wafPolicies: Record<string, OciResult<OciWafPolicy>>;
  gateways: Record<string, OciResult<OciGatewayStatusView>>;
  /** ホスト名→解決Aレコード(この端末のリゾルバによる観測) */
  dnsChecks: Record<string, OciResult<string[]>>;
  /** Certificatesサービスの証明書OCID→期限(listener certificate-ids方式) */
  managedCerts: Record<string, OciResult<OciManagedCertView>>;
  /** Block Volume OCID→バックアップポリシー名(未割当はpolicyName=undefined) */
  volumeBackupPolicies: Record<string, OciResult<OciBackupPolicyView>>;
  /** FSSスナップショットポリシーOCID→名前 */
  fssSnapshotPolicies: Record<string, OciResult<OciBackupPolicyView>>;
  backendHealths: Record<string, OciResult<OciBackendSetHealthView>>;
}

const CALL_TIMEOUT_MS = 60_000; // CLI時代の突発遅延許容と同水準(設計 技術メモ)

// 認証済みクライアント束はResolvedAuth(=鍵の寿命)に紐付けてキャッシュする。
const clientsCache = new WeakMap<ResolvedAuth, OciClients>();

function clientsFor(auth: ResolvedAuth): OciClients {
  const existing = clientsCache.get(auth);
  if (existing) return existing;
  const clients = createClients(auth.provider, auth.regionId);
  clientsCache.set(auth, clients);
  return clients;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`OCI API call did not complete within ${CALL_TIMEOUT_MS / 1000} seconds`)),
      CALL_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 認証解決+SDK呼び出し+エラー分類の共通経路。
 * NotAuthenticated(401)のみ認証を1回再解決して再試行する(設計 エラーハンドリング②)。
 */
export async function callOci<T>(authCommand: string, fn: (clients: OciClients) => Promise<T>): Promise<OciResult<T>> {
  const auth = await getAuth(authCommand);
  if (!auth.ok) return auth;
  try {
    return { ok: true, data: await withTimeout(fn(clientsFor(auth.data))) };
  } catch (error) {
    const classified = classifyOciError(error);
    if (classified.kind !== "not_authenticated") return { ok: false, ...classified };
    const reresolved = await reresolveAuth(authCommand);
    if (!reresolved.ok) return reresolved;
    try {
      return { ok: true, data: await withTimeout(fn(clientsFor(reresolved.data))) };
    } catch (retryError) {
      return { ok: false, ...classifyOciError(retryError) };
    }
  }
}

interface Page<T> {
  items: T[];
  opcNextPage?: string;
}

async function listAllPages<T>(fetchPage: (page: string | undefined) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = [];
  let page: string | undefined;
  do {
    const result = await fetchPage(page);
    items.push(...result.items);
    page = result.opcNextPage;
  } while (page);
  return items;
}

// 後処理(結合等)で例外が出てもセクション単位の失敗に留める(呼び出し元を拒否させない)。
async function toSectionResult<T>(promise: Promise<OciResult<T>>): Promise<OciResult<T>> {
  try {
    return await promise;
  } catch (error) {
    return { ok: false, kind: "internal", raw: { message: String(error) } };
  }
}

/** compartmentごとにfetchOneを実行し、結果をidで重複排除して結合する。1つでも失敗すればセクション全体を失敗として返す。 */
async function listAcrossCompartments<T extends { id: string }>(
  fetchOne: (compartmentId: string) => Promise<OciResult<T[]>>,
  compartmentIds: string[],
): Promise<OciResult<T[]>> {
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
  taggedResources: OciResult<OciResourceSummary[]>,
): string[] {
  const ids = new Set<string>([anchorCompartmentId]);
  if (taggedResources.ok) {
    for (const item of taggedResources.data) {
      if (item.compartmentId) ids.add(item.compartmentId);
    }
  }
  return [...ids];
}

// #2 クラスタ情報(共有: どのページでも必要、ヘッダ表示用)。
export function fetchCluster(clusterId: string, authCommand: string): Promise<OciResult<OciCluster>> {
  return toSectionResult(
    callOci(authCommand, async (clients) => (await clients.containerEngine.getCluster({ clusterId })).cluster),
  );
}

// #3 ノード詳細(nodesページ)。
export function fetchInstances(compartmentId: string, authCommand: string): Promise<OciResult<OciInstance[]>> {
  return toSectionResult(
    callOci(authCommand, (clients) =>
      listAllPages(async (page) => {
        const res = await clients.compute.listInstances({ compartmentId, page });
        return { items: res.items, opcNextPage: res.opcNextPage };
      }),
    ),
  );
}

// #4 タグ検索(service-lb/pv-storageページ共有)。
export function fetchTaggedResources(clusterId: string, authCommand: string): Promise<OciResult<OciResourceSummary[]>> {
  return toSectionResult(
    callOci(authCommand, (clients) =>
      listAllPages(async (page) => {
        const res = await clients.resourceSearch.searchResources({
          searchDetails: {
            type: resourcesearch.models.StructuredSearchDetails.type,
            query: buildTaggedResourcesQuery(clusterId),
          },
          page,
        });
        return { items: res.resourceSummaryCollection.items ?? [], opcNextPage: res.opcNextPage };
      }),
    ),
  );
}

// #5 NLB一覧(service-lbページ)。
export function fetchNlbs(
  compartmentIds: string[],
  authCommand: string,
): Promise<OciResult<OciNetworkLoadBalancerSummary[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) =>
        callOci(authCommand, (clients) =>
          listAllPages(async (page) => {
            const res = await clients.networkLoadBalancer.listNetworkLoadBalancers({ compartmentId, page });
            return { items: res.networkLoadBalancerCollection.items ?? [], opcNextPage: res.opcNextPage };
          }),
        ),
      compartmentIds,
    ),
  );
}

// #6 classic LB一覧(service-lbページ)。
export function fetchLbs(compartmentIds: string[], authCommand: string): Promise<OciResult<OciLoadBalancer[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) =>
        callOci(authCommand, (clients) =>
          listAllPages(async (page) => {
            const res = await clients.loadBalancer.listLoadBalancers({ compartmentId, page });
            return { items: res.items, opcNextPage: res.opcNextPage };
          }),
        ),
      compartmentIds,
    ),
  );
}

// #7 Volume一覧(pv-storageページ)。
export function fetchVolumes(compartmentIds: string[], authCommand: string): Promise<OciResult<OciVolume[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) =>
        callOci(authCommand, (clients) =>
          listAllPages(async (page) => {
            const res = await clients.blockstorage.listVolumes({ compartmentId, page });
            return { items: res.items, opcNextPage: res.opcNextPage };
          }),
        ),
      compartmentIds,
    ),
  );
}

// #8 FSS名前解決(pv-storageページ、distinct FileSystem OCIDごとに1回)。
export function fetchFileSystem(fsId: string, authCommand: string): Promise<OciResult<OciFileSystem>> {
  return toSectionResult(
    callOci(
      authCommand,
      async (clients) => (await clients.fileStorage.getFileSystem({ fileSystemId: fsId })).fileSystem,
    ),
  );
}

// #9 ノードプール一覧(nodes/networkページ)。
export function fetchNodePools(
  clusterId: string,
  compartmentId: string,
  authCommand: string,
): Promise<OciResult<OciNodePoolSummary[]>> {
  return toSectionResult(
    callOci(authCommand, (clients) =>
      listAllPages(async (page) => {
        const res = await clients.containerEngine.listNodePools({ compartmentId, clusterId, page });
        return { items: res.items, opcNextPage: res.opcNextPage };
      }),
    ),
  );
}

// #10 WAF一覧(networkページ)。classic LBのみ対象(NLBはWAF非対応)。
export function fetchWafs(compartmentIds: string[], authCommand: string): Promise<OciResult<OciWafSummary[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) =>
        callOci(authCommand, (clients) =>
          listAllPages(async (page) => {
            const res = await clients.waf.listWebAppFirewalls({ compartmentId, page });
            return { items: res.webAppFirewallCollection.items ?? [], opcNextPage: res.opcNextPage };
          }),
        ),
      compartmentIds,
    ),
  );
}

// #11 サブネット詳細(networkページ、関連subnet OCIDごとに1回)。OCID直指定のためcompartment前提なし。
export function fetchSubnet(subnetId: string, authCommand: string): Promise<OciResult<OciSubnet>> {
  return toSectionResult(
    callOci(authCommand, async (clients) => (await clients.virtualNetwork.getSubnet({ subnetId })).subnet),
  );
}

// #12 セキュリティリスト(ルール込み、networkページ)。
export function fetchSecurityList(securityListId: string, authCommand: string): Promise<OciResult<OciSecurityList>> {
  return toSectionResult(
    callOci(
      authCommand,
      async (clients) => (await clients.virtualNetwork.getSecurityList({ securityListId })).securityList,
    ),
  );
}

// #13 ルートテーブル(networkページ)。
export function fetchRouteTable(rtId: string, authCommand: string): Promise<OciResult<OciRouteTable>> {
  return toSectionResult(
    callOci(authCommand, async (clients) => (await clients.virtualNetwork.getRouteTable({ rtId })).routeTable),
  );
}

// #14 NSG本体+ルール(networkページ)。名前表示のためgetとrules listの2 call。
export function fetchNsgWithRules(nsgId: string, authCommand: string): Promise<OciResult<OciNsgWithRules>> {
  return toSectionResult(
    callOci(authCommand, async (clients) => {
      const [nsgRes, rules] = await Promise.all([
        clients.virtualNetwork.getNetworkSecurityGroup({ networkSecurityGroupId: nsgId }),
        listAllPages(async (page) => {
          const res = await clients.virtualNetwork.listNetworkSecurityGroupSecurityRules({
            networkSecurityGroupId: nsgId,
            page,
          });
          return { items: res.items, opcNextPage: res.opcNextPage };
        }),
      ]);
      return { nsg: nsgRes.networkSecurityGroup, rules };
    }),
  );
}

// #15 WAFポリシー(networkページ、WAFごとのルール表示用)。
export function fetchWafPolicy(policyId: string, authCommand: string): Promise<OciResult<OciWafPolicy>> {
  return toSectionResult(
    callOci(
      authCommand,
      async (clients) =>
        (await clients.waf.getWebAppFirewallPolicy({ webAppFirewallPolicyId: policyId })).webAppFirewallPolicy,
    ),
  );
}

// #16 Block Volumeのバックアップポリシー名(pv-storageページ)。割当→ポリシー本体の2段。
export function fetchVolumeBackupPolicyName(
  volumeId: string,
  authCommand: string,
): Promise<OciResult<OciBackupPolicyView>> {
  return toSectionResult(
    callOci(authCommand, async (clients): Promise<OciBackupPolicyView> => {
      const assignments = await clients.blockstorage.getVolumeBackupPolicyAssetAssignment({ assetId: volumeId });
      const policyId = assignments.items[0]?.policyId;
      if (!policyId) return { policyName: undefined };
      const policy = (await clients.blockstorage.getVolumeBackupPolicy({ policyId })).volumeBackupPolicy;
      return { policyId, policyName: policy.displayName };
    }),
  );
}

// #17 FSSスナップショットポリシー名(pv-storageページ)。
export function fetchFssSnapshotPolicyName(
  policyId: string,
  authCommand: string,
): Promise<OciResult<OciBackupPolicyView>> {
  return toSectionResult(
    callOci(authCommand, async (clients): Promise<OciBackupPolicyView> => {
      const policy = (await clients.fileStorage.getFilesystemSnapshotPolicy({ filesystemSnapshotPolicyId: policyId }))
        .filesystemSnapshotPolicy;
      return { policyId, policyName: policy.displayName };
    }),
  );
}

// #18 Certificatesサービスの証明書期限(networkページ、listenerのcertificate-ids方式)。
export function fetchManagedCertificate(
  certificateId: string,
  authCommand: string,
): Promise<OciResult<OciManagedCertView>> {
  return toSectionResult(
    callOci(authCommand, async (clients): Promise<OciManagedCertView> => {
      const cert = (await clients.certificatesManagement.getCertificate({ certificateId })).certificate;
      const notAfter = cert.currentVersion?.validity?.timeOfValidityNotAfter;
      return { name: cert.name, validTo: notAfter ? new Date(notAfter).toISOString() : undefined };
    }),
  );
}

// #19 ゲートウェイ状態(networkページ、RTルート宛先の生死表示用)。OCID種別でget先を出し分ける。
export function fetchGatewayStatus(
  networkEntityId: string,
  authCommand: string,
): Promise<OciResult<OciGatewayStatusView>> {
  const kind = routeEntityKind(networkEntityId);
  const gatewayKind = gatewayKindOf(networkEntityId);
  return toSectionResult(
    callOci(authCommand, async (clients): Promise<OciGatewayStatusView> => {
      switch (gatewayKind) {
        case "natgateway": {
          const g = (await clients.virtualNetwork.getNatGateway({ natGatewayId: networkEntityId })).natGateway;
          return { kind, displayName: g.displayName, lifecycleState: g.lifecycleState, blockTraffic: g.blockTraffic };
        }
        case "internetgateway": {
          const g = (await clients.virtualNetwork.getInternetGateway({ igId: networkEntityId })).internetGateway;
          return { kind, displayName: g.displayName, lifecycleState: g.lifecycleState, isEnabled: g.isEnabled };
        }
        case "servicegateway": {
          const g = (await clients.virtualNetwork.getServiceGateway({ serviceGatewayId: networkEntityId }))
            .serviceGateway;
          return { kind, displayName: g.displayName, lifecycleState: g.lifecycleState, blockTraffic: g.blockTraffic };
        }
        case "localpeeringgateway": {
          const g = (await clients.virtualNetwork.getLocalPeeringGateway({ localPeeringGatewayId: networkEntityId }))
            .localPeeringGateway;
          return { kind, displayName: g.displayName, lifecycleState: g.lifecycleState, peeringStatus: g.peeringStatus };
        }
        case "drg": {
          const g = (await clients.virtualNetwork.getDrg({ drgId: networkEntityId })).drg;
          return { kind, displayName: g.displayName, lifecycleState: g.lifecycleState };
        }
        default:
          throw new Error(`Unsupported gateway kind: ${gatewayKind}`);
      }
    }),
  );
}

// #20 backend health(networkページ、展開時オンデマンド)。
export function fetchBackendSetHealth(
  kind: "lb" | "nlb",
  loadBalancerId: string,
  backendSetName: string,
  authCommand: string,
): Promise<OciResult<OciBackendSetHealthView>> {
  return toSectionResult(
    callOci(authCommand, async (clients): Promise<OciBackendSetHealthView> => {
      if (kind === "lb") {
        const res = await clients.loadBalancer.getBackendSetHealth({ loadBalancerId, backendSetName });
        return res.backendSetHealth;
      }
      const res = await clients.networkLoadBalancer.getBackendSetHealth({
        networkLoadBalancerId: loadBalancerId,
        backendSetName,
      });
      return res.backendSetHealth;
    }),
  );
}
