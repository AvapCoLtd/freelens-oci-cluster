import { type OciCommandDef, ociCommands } from "../cli/command-defs";
import { runOciCommand } from "../cli/run";
import { gatewayKindOf, type OciGatewayStatusView } from "../match/gateway-status";
import { routeEntityKind } from "../match/network-path";
import type { OciResult } from "../oci/result";
import type {
  OciBackendSetHealth,
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
} from "../oci/types";

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

/** コマンド定義1件の実行。`ociCliCommand`は設定値そのもの(空欄=PATHの`oci`)。 */
function run<Params, Result>(
  def: OciCommandDef<Params, Result>,
  params: Params,
  ociCliCommand: string,
): Promise<OciResult<Result>> {
  return runOciCommand(def, params, ociCliCommand);
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
      const compartmentId = item["compartment-id"];
      if (compartmentId) ids.add(compartmentId);
    }
  }
  return [...ids];
}

// #2 クラスタ情報(共有: どのページでも必要、ヘッダ表示用)。
export function fetchCluster(clusterId: string, ociCliCommand: string): Promise<OciResult<OciCluster>> {
  return toSectionResult(run(ociCommands.clusterGet, { clusterId }, ociCliCommand));
}

// #3 ノード詳細(nodesページ)。
export function fetchInstances(compartmentId: string, ociCliCommand: string): Promise<OciResult<OciInstance[]>> {
  return toSectionResult(run(ociCommands.instanceList, { compartmentId }, ociCliCommand));
}

// #4 タグ検索(service-lb/pv-storageページ共有)。
export function fetchTaggedResources(
  clusterId: string,
  ociCliCommand: string,
): Promise<OciResult<OciResourceSummary[]>> {
  return toSectionResult(
    run(ociCommands.taggedResourceSearch, { queryText: buildTaggedResourcesQuery(clusterId) }, ociCliCommand),
  );
}

// #5 NLB一覧(service-lbページ)。
export function fetchNlbs(
  compartmentIds: string[],
  ociCliCommand: string,
): Promise<OciResult<OciNetworkLoadBalancerSummary[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) => run(ociCommands.nlbList, { compartmentId }, ociCliCommand),
      compartmentIds,
    ),
  );
}

// #6 classic LB一覧(service-lbページ)。
export function fetchLbs(compartmentIds: string[], ociCliCommand: string): Promise<OciResult<OciLoadBalancer[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) => run(ociCommands.lbList, { compartmentId }, ociCliCommand),
      compartmentIds,
    ),
  );
}

// #7 Volume一覧(pv-storageページ)。
export function fetchVolumes(compartmentIds: string[], ociCliCommand: string): Promise<OciResult<OciVolume[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) => run(ociCommands.volumeList, { compartmentId }, ociCliCommand),
      compartmentIds,
    ),
  );
}

// #8 FSS名前解決(pv-storageページ、distinct FileSystem OCIDごとに1回)。
export function fetchFileSystem(fsId: string, ociCliCommand: string): Promise<OciResult<OciFileSystem>> {
  return toSectionResult(run(ociCommands.fileSystemGet, { fileSystemId: fsId }, ociCliCommand));
}

// #9 ノードプール一覧(nodes/networkページ)。
export function fetchNodePools(
  clusterId: string,
  compartmentId: string,
  ociCliCommand: string,
): Promise<OciResult<OciNodePoolSummary[]>> {
  return toSectionResult(run(ociCommands.nodePoolList, { compartmentId, clusterId }, ociCliCommand));
}

// #10 WAF一覧(networkページ)。classic LBのみ対象(NLBはWAF非対応)。
export function fetchWafs(compartmentIds: string[], ociCliCommand: string): Promise<OciResult<OciWafSummary[]>> {
  return toSectionResult(
    listAcrossCompartments(
      (compartmentId) => run(ociCommands.wafList, { compartmentId }, ociCliCommand),
      compartmentIds,
    ),
  );
}

// #11 サブネット詳細(networkページ、関連subnet OCIDごとに1回)。OCID直指定のためcompartment前提なし。
export function fetchSubnet(subnetId: string, ociCliCommand: string): Promise<OciResult<OciSubnet>> {
  return toSectionResult(run(ociCommands.subnetGet, { subnetId }, ociCliCommand));
}

// #12 セキュリティリスト(ルール込み、networkページ)。
export function fetchSecurityList(securityListId: string, ociCliCommand: string): Promise<OciResult<OciSecurityList>> {
  return toSectionResult(run(ociCommands.securityListGet, { securityListId }, ociCliCommand));
}

// #13 ルートテーブル(networkページ)。
export function fetchRouteTable(rtId: string, ociCliCommand: string): Promise<OciResult<OciRouteTable>> {
  return toSectionResult(run(ociCommands.routeTableGet, { rtId }, ociCliCommand));
}

// #14 NSG本体+ルール(networkページ)。名前表示のためgetとrules listの2 call。
export function fetchNsgWithRules(nsgId: string, ociCliCommand: string): Promise<OciResult<OciNsgWithRules>> {
  return toSectionResult(
    (async (): Promise<OciResult<OciNsgWithRules>> => {
      const [nsg, rules] = await Promise.all([
        run(ociCommands.nsgGet, { nsgId }, ociCliCommand),
        run(ociCommands.nsgRulesList, { nsgId }, ociCliCommand),
      ]);
      if (!nsg.ok) return nsg;
      if (!rules.ok) return rules;
      return { ok: true, data: { nsg: nsg.data, rules: rules.data } };
    })(),
  );
}

// #15 WAFポリシー(networkページ、WAFごとのルール表示用)。
export function fetchWafPolicy(policyId: string, ociCliCommand: string): Promise<OciResult<OciWafPolicy>> {
  return toSectionResult(run(ociCommands.wafPolicyGet, { webAppFirewallPolicyId: policyId }, ociCliCommand));
}

// #16 Block Volumeのバックアップポリシー名(pv-storageページ)。割当→ポリシー本体の2段。
export function fetchVolumeBackupPolicyName(
  volumeId: string,
  ociCliCommand: string,
): Promise<OciResult<OciBackupPolicyView>> {
  return toSectionResult(
    (async (): Promise<OciResult<OciBackupPolicyView>> => {
      const assignments = await run(ociCommands.volumeBackupPolicyAssignmentGet, { assetId: volumeId }, ociCliCommand);
      if (!assignments.ok) return assignments;
      const policyId = assignments.data[0]?.["policy-id"];
      if (!policyId) return { ok: true, data: { policyName: undefined } };
      const policy = await run(ociCommands.volumeBackupPolicyGet, { policyId }, ociCliCommand);
      if (!policy.ok) return policy;
      return { ok: true, data: { policyId, policyName: policy.data["display-name"] } };
    })(),
  );
}

// #17 FSSスナップショットポリシー名(pv-storageページ)。
export function fetchFssSnapshotPolicyName(
  policyId: string,
  ociCliCommand: string,
): Promise<OciResult<OciBackupPolicyView>> {
  return toSectionResult(
    (async (): Promise<OciResult<OciBackupPolicyView>> => {
      const policy = await run(
        ociCommands.fssSnapshotPolicyGet,
        { filesystemSnapshotPolicyId: policyId },
        ociCliCommand,
      );
      if (!policy.ok) return policy;
      return { ok: true, data: { policyId, policyName: policy.data["display-name"] } };
    })(),
  );
}

// #18 Certificatesサービスの証明書期限(networkページ、listenerのcertificate-ids方式)。
export function fetchManagedCertificate(
  certificateId: string,
  ociCliCommand: string,
): Promise<OciResult<OciManagedCertView>> {
  return toSectionResult(
    (async (): Promise<OciResult<OciManagedCertView>> => {
      const cert = await run(ociCommands.managedCertificateGet, { certificateId }, ociCliCommand);
      if (!cert.ok) return cert;
      const notAfter = cert.data["current-version"]?.validity?.["time-of-validity-not-after"];
      return {
        ok: true,
        data: { name: cert.data.name, validTo: notAfter ? new Date(notAfter).toISOString() : undefined },
      };
    })(),
  );
}

// #19 ゲートウェイ状態(networkページ、RTルート宛先の生死表示用)。OCID種別でget先を出し分ける。
export function fetchGatewayStatus(
  networkEntityId: string,
  ociCliCommand: string,
): Promise<OciResult<OciGatewayStatusView>> {
  const kind = routeEntityKind(networkEntityId);
  const gatewayKind = gatewayKindOf(networkEntityId);
  return toSectionResult(
    (async (): Promise<OciResult<OciGatewayStatusView>> => {
      switch (gatewayKind) {
        case "natgateway": {
          const g = await run(ociCommands.natGatewayGet, { natGatewayId: networkEntityId }, ociCliCommand);
          if (!g.ok) return g;
          return {
            ok: true,
            data: {
              kind,
              displayName: g.data["display-name"],
              lifecycleState: g.data["lifecycle-state"],
              blockTraffic: g.data["block-traffic"],
            },
          };
        }
        case "internetgateway": {
          const g = await run(ociCommands.internetGatewayGet, { igId: networkEntityId }, ociCliCommand);
          if (!g.ok) return g;
          return {
            ok: true,
            data: {
              kind,
              displayName: g.data["display-name"],
              lifecycleState: g.data["lifecycle-state"],
              isEnabled: g.data["is-enabled"],
            },
          };
        }
        case "servicegateway": {
          const g = await run(ociCommands.serviceGatewayGet, { serviceGatewayId: networkEntityId }, ociCliCommand);
          if (!g.ok) return g;
          return {
            ok: true,
            data: {
              kind,
              displayName: g.data["display-name"],
              lifecycleState: g.data["lifecycle-state"],
              blockTraffic: g.data["block-traffic"],
            },
          };
        }
        case "localpeeringgateway": {
          const g = await run(
            ociCommands.localPeeringGatewayGet,
            { localPeeringGatewayId: networkEntityId },
            ociCliCommand,
          );
          if (!g.ok) return g;
          return {
            ok: true,
            data: {
              kind,
              displayName: g.data["display-name"],
              lifecycleState: g.data["lifecycle-state"],
              peeringStatus: g.data["peering-status"],
            },
          };
        }
        case "drg": {
          const g = await run(ociCommands.drgGet, { drgId: networkEntityId }, ociCliCommand);
          if (!g.ok) return g;
          return {
            ok: true,
            data: { kind, displayName: g.data["display-name"], lifecycleState: g.data["lifecycle-state"] },
          };
        }
        default:
          throw new Error(`Unsupported gateway kind: ${gatewayKind}`);
      }
    })(),
  );
}

function toBackendSetHealthView(health: OciBackendSetHealth): OciBackendSetHealthView {
  return {
    status: health.status,
    totalBackendCount: health["total-backend-count"],
    criticalStateBackendNames: health["critical-state-backend-names"],
    warningStateBackendNames: health["warning-state-backend-names"],
    unknownStateBackendNames: health["unknown-state-backend-names"],
  };
}

// #20 backend health(networkページ、展開時オンデマンド)。
export function fetchBackendSetHealth(
  kind: "lb" | "nlb",
  loadBalancerId: string,
  backendSetName: string,
  ociCliCommand: string,
): Promise<OciResult<OciBackendSetHealthView>> {
  return toSectionResult(
    (async (): Promise<OciResult<OciBackendSetHealthView>> => {
      const health =
        kind === "lb"
          ? await run(ociCommands.lbBackendSetHealthGet, { loadBalancerId, backendSetName }, ociCliCommand)
          : await run(
              ociCommands.nlbBackendSetHealthGet,
              { networkLoadBalancerId: loadBalancerId, backendSetName },
              ociCliCommand,
            );
      if (!health.ok) return health;
      return { ok: true, data: toBackendSetHealthView(health.data) };
    })(),
  );
}
