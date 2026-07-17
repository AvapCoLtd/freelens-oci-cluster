import type * as containerengine from "oci-containerengine";
import type * as core from "oci-core";
import type * as filestorage from "oci-filestorage";
import type * as loadbalancer from "oci-loadbalancer";
import type * as networkloadbalancer from "oci-networkloadbalancer";
import type * as resourcesearch from "oci-resourcesearch";
import type * as waf from "oci-waf";

export type OciCluster = containerengine.models.Cluster;
export type OciNodePoolSummary = containerengine.models.NodePoolSummary;
export type OciInstance = core.models.Instance;
export type OciVolume = core.models.Volume;
export type OciSubnet = core.models.Subnet;
export type OciSecurityList = core.models.SecurityList;
export type OciRouteTable = core.models.RouteTable;
export type OciNsg = core.models.NetworkSecurityGroup;
export type OciNsgRule = core.models.SecurityRule;
export type OciLoadBalancer = loadbalancer.models.LoadBalancer;
export type OciNetworkLoadBalancerSummary = networkloadbalancer.models.NetworkLoadBalancerSummary;
export type OciFileSystem = filestorage.models.FileSystem;
export type OciResourceSummary = resourcesearch.models.ResourceSummary;
export type OciWafSummary = waf.models.WebAppFirewallSummary;
export type OciWafPolicy = waf.models.WebAppFirewallPolicy;

export interface OciNsgWithRules {
  nsg: OciNsg;
  rules: OciNsgRule[];
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

// LB/NLBのBackendSetHealthは別モデルだが同名フィールド構成のため、UI向けに共通形へ寄せる。
export interface OciBackendSetHealthView {
  status?: string;
  totalBackendCount?: number;
  criticalStateBackendNames?: string[];
  warningStateBackendNames?: string[];
  unknownStateBackendNames?: string[];
}
