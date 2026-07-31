/**
 * oci CLI(`--output json`)応答のうち、この拡張が読むフィールドだけを宣言した型。
 * 正は実機採取フィクスチャ(../cli/__fixtures__/stdout/)で、各型のコメントに対応ファイルを記す。
 * キーはCLI出力のkebab-caseそのまま。未設定フィールドはキー省略ではなく明示的nullで返るため、
 * フィクスチャでnull実績のあるものは`?: T | null`にしている。
 */

/** タグ系フィールド。名前空間名・タグキーはOracleや利用者が付けた表記がそのまま出る。 */
export type OciDefinedTags = Record<string, Record<string, unknown>>;

/** `compute instance get` / `compute instance list` → 01a, 03 */
export interface OciInstance {
  id: string;
  "display-name"?: string;
  shape?: string;
  "availability-domain"?: string;
  "fault-domain"?: string;
  "lifecycle-state"?: string;
  "defined-tags"?: OciDefinedTags;
}

/** `ce node-pool get` → 01b(アンカー解決が読む2フィールドのみ) */
export interface OciNodePool {
  "cluster-id"?: string;
  "compartment-id"?: string;
}

/** `ce node-pool list` → 09 */
export interface OciNodePoolSummary {
  id: string;
  name?: string;
  "kubernetes-version"?: string;
  "lifecycle-state"?: string;
  "node-shape"?: string;
  "subnet-ids"?: string[];
  "node-config-details"?: {
    size?: number;
    "nsg-ids"?: string[];
    "placement-configs"?: { "subnet-id"?: string }[];
  };
}

/** `ce cluster get` → 02 */
export interface OciCluster {
  id: string;
  name?: string;
  "lifecycle-state"?: string;
  "kubernetes-version"?: string;
  "endpoint-config"?: {
    "subnet-id"?: string;
    "nsg-ids"?: string[];
  };
}

/** `bv volume list` → 07 */
export interface OciVolume {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "size-in-gbs"?: number;
}

/** `fs file-system get` → 08 */
export interface OciFileSystem {
  "display-name"?: string;
  "lifecycle-state"?: string;
  "filesystem-snapshot-policy-id"?: string;
}

/** `search resource structured-search` → 04 */
export interface OciResourceSummary {
  identifier?: string;
  "compartment-id"?: string;
}

/** `network subnet get` → 11 */
export interface OciSubnet {
  "display-name"?: string;
  "vcn-id"?: string;
  "cidr-block"?: string;
  "prohibit-public-ip-on-vnic"?: boolean;
  "security-list-ids"?: string[];
  "route-table-id"?: string;
}

/** SL/NSGルール共通のポート指定。 */
export interface OciPortOptions {
  "destination-port-range"?: { min?: number; max?: number };
  "source-port-range"?: { min?: number; max?: number } | null;
}

/** `network security-list get` の ingress/egress ルール → 12 */
export interface OciSecurityRule {
  protocol?: string;
  source?: string;
  destination?: string | null;
  "is-stateless"?: boolean;
  description?: string | null;
  "tcp-options"?: OciPortOptions | null;
  "udp-options"?: OciPortOptions | null;
}

/** `network security-list get` → 12 */
export interface OciSecurityList {
  "display-name"?: string;
  "vcn-id"?: string;
  "ingress-security-rules"?: OciSecurityRule[];
  "egress-security-rules"?: OciSecurityRule[];
}

/** `network route-table get` → 13 */
export interface OciRouteTable {
  "display-name"?: string;
  "vcn-id"?: string;
  "route-rules"?: {
    destination?: string;
    "cidr-block"?: string | null;
    "network-entity-id"?: string;
    description?: string;
  }[];
}

/** `network nsg get` → 14a */
export interface OciNsg {
  "display-name"?: string;
  "vcn-id"?: string;
}

/** `network nsg rules list` → 14b */
export interface OciNsgRule extends OciSecurityRule {
  direction?: string;
}

export interface OciNsgWithRules {
  nsg: OciNsg;
  rules: OciNsgRule[];
}

interface OciLbIpAddress {
  "ip-address"?: string;
}

interface OciLbBackendSet {
  backends?: { "ip-address"?: string }[];
}

/** `lb load-balancer list` → 06、`06-…-with-ssl`(listenerのssl-configuration) */
export interface OciLoadBalancer {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "is-private"?: boolean;
  "subnet-ids"?: string[];
  "network-security-group-ids"?: string[];
  "ip-addresses"?: OciLbIpAddress[];
  /** キーはリスナー名(利用者が付けた表記そのまま) */
  listeners?: Record<
    string,
    {
      port?: number;
      protocol?: string;
      "ssl-configuration"?: {
        "certificate-name"?: string | null;
        "certificate-ids"?: string[];
      } | null;
    }
  >;
  /** キーはバックエンドセット名 */
  "backend-sets"?: Record<string, OciLbBackendSet>;
  /** キーは証明書名 */
  certificates?: Record<string, { "certificate-name"?: string | null; "public-certificate"?: string | null }>;
}

/** `nlb network-load-balancer list` → 05 */
export interface OciNetworkLoadBalancerSummary {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "is-private"?: boolean;
  "subnet-id"?: string;
  "network-security-group-ids"?: string[];
  "ip-addresses"?: OciLbIpAddress[];
  listeners?: Record<string, { port?: number; protocol?: string }>;
  "backend-sets"?: Record<string, OciLbBackendSet>;
}

/** `lb backend-set-health get` / `nlb backend-set-health get` → 20a, 20b */
export interface OciBackendSetHealth {
  status?: string;
  "total-backend-count"?: number;
  "critical-state-backend-names"?: string[];
  "warning-state-backend-names"?: string[];
  "unknown-state-backend-names"?: string[];
}

/** `waf web-app-firewall list` → 10 */
export interface OciWafSummary {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "web-app-firewall-policy-id"?: string;
  /** backend-type=LOAD_BALANCERのWAFのみ持つ */
  "load-balancer-id"?: string;
}

interface OciWafRule {
  name: string;
  "action-name"?: string;
  condition?: string | null;
}

interface OciWafProtectionRule extends OciWafRule {
  "protection-capabilities"?: { key?: string }[];
}

/** `waf web-app-firewall-policy get` → 15 */
export interface OciWafPolicy {
  "display-name"?: string;
  actions?: { name?: string; type?: string }[];
  "request-access-control"?: { "default-action-name"?: string; rules?: OciWafRule[] };
  "request-rate-limiting"?: {
    rules?: (OciWafRule & {
      configurations?: {
        "requests-limit"?: number;
        "period-in-seconds"?: number;
        "action-duration-in-seconds"?: number;
      }[];
    })[];
  };
  "request-protection"?: { rules?: OciWafProtectionRule[] };
  "response-access-control"?: { rules?: OciWafRule[] } | null;
  "response-protection"?: { rules?: OciWafProtectionRule[] } | null;
}

/** `bv volume-backup-policy-assignment get-…-asset-assignment`(割当なしはstdout空) → 16a */
export interface OciVolumeBackupPolicyAssignment {
  "policy-id"?: string;
}

/** `bv volume-backup-policy get` → 16b */
export interface OciVolumeBackupPolicy {
  "display-name"?: string;
}

/** `fs filesystem-snapshot-policy get` → 17 */
export interface OciFilesystemSnapshotPolicy {
  "display-name"?: string;
}

/** `certs-mgmt certificate get` → 18 */
export interface OciManagedCertificate {
  name?: string;
  "current-version"?: {
    validity?: { "time-of-validity-not-after"?: string };
  };
}

/** `network nat-gateway get` / `service-gateway get` → 19a, 19c */
export interface OciBlockingGateway {
  "display-name"?: string;
  "lifecycle-state"?: string;
  "block-traffic"?: boolean;
}

/** `network internet-gateway get` → 19b */
export interface OciInternetGateway {
  "display-name"?: string;
  "lifecycle-state"?: string;
  "is-enabled"?: boolean;
}

/** `network local-peering-gateway get` → 19d */
export interface OciLocalPeeringGateway {
  "display-name"?: string;
  "lifecycle-state"?: string;
  "peering-status"?: string;
}

/** `network drg get` → 19e */
export interface OciDrg {
  "display-name"?: string;
  "lifecycle-state"?: string;
}

/** ボリューム/FSSのバックアップ(スナップショット)ポリシー。policyName undefined=未割当。 */
export interface OciBackupPolicyView {
  policyId?: string;
  policyName?: string;
}

/** CertificatesサービスのLB listener証明書(certificate-ids方式)の期限表示用。 */
export interface OciManagedCertView {
  name?: string;
  /** ISO 8601 */
  validTo?: string;
}

// LB/NLBのBackendSetHealthは別コマンドだが同じフィールド構成のため、UI向けに共通形へ寄せる。
export interface OciBackendSetHealthView {
  status?: string;
  totalBackendCount?: number;
  criticalStateBackendNames?: string[];
  warningStateBackendNames?: string[];
  unknownStateBackendNames?: string[];
}
