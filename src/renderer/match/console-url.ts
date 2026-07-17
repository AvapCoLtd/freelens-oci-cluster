export type OciConsoleResourceType =
  | "cluster"
  | "instance"
  | "nlb"
  | "lb"
  | "volume"
  | "filesystem"
  | "subnet"
  | "security-list"
  | "nsg"
  | "route-table"
  | "waf"
  | "waf-policy"
  | "volume-backup-policy"
  | "fss-snapshot-policy";

const CONSOLE_BASE_URL = "https://cloud.oracle.com";

// 実機で遷移確認済みのディープリンクパス(cluster〜filesystem: 2026-07-15、VCN配下3種: 2026-07-17)。
// filesystem はコンソール上の実URLに `/exports/<export OCID>` が付くが、基本形で開けることを確認済み。
const DIRECT_CONSOLE_PATH: Record<Exclude<OciConsoleResourceType, VcnScopedType | "waf">, string> = {
  cluster: "containers/clusters",
  volume: "block-storage/volumes",
  instance: "compute/instances",
  nlb: "networking/load-balancers/network-load-balancer",
  lb: "load-balancer/load-balancers",
  filesystem: "fss/file-systems",
  // WAF本体URL(waf/policies/<policy>/firewalls/<waf>、実機確認済み)の親ページ形。単体は未確認
  "waf-policy": "waf/policies",
  // volume-backup-policyのみ未確認(実機遷移確認の対象)
  "volume-backup-policy": "block-storage/backup-policies",
  // 実機確認済み(2026-07-17)
  "fss-snapshot-policy": "fss/snapshot-policies",
};

type VcnScopedType = "subnet" | "security-list" | "nsg" | "route-table";

// subnet/SL/RTはVCN配下のネストパス(実機確認済み 2026-07-17)。SLのみ末尾に/detailsが付く。
// nsgは同構成の類推で未確認。
const VCN_SCOPED_CONSOLE_PATH: Record<VcnScopedType, { segment: string; suffix: string }> = {
  subnet: { segment: "subnets", suffix: "" },
  "security-list": { segment: "security-lists", suffix: "/details" },
  "route-table": { segment: "route-tables", suffix: "" },
  nsg: { segment: "network-security-groups", suffix: "" },
};

function isVcnScoped(type: OciConsoleResourceType): type is VcnScopedType {
  return type in VCN_SCOPED_CONSOLE_PATH;
}

/**
 * 親付きリソースはparentIdが必須: subnet/SL/RT/NSG=VCN OCID、waf=WAFポリシーOCID(実機確認済み 2026-07-17)。
 * 呼び出し元はparentId未解決の間ボタンを出さないこと(親なしで組んだパスはコンソールが404にする)。
 */
export function buildConsoleUrl(type: OciConsoleResourceType, ocid: string, region: string, parentId?: string): string {
  if (isVcnScoped(type) && parentId) {
    const { segment, suffix } = VCN_SCOPED_CONSOLE_PATH[type];
    return `${CONSOLE_BASE_URL}/networking/vcns/${parentId}/${segment}/${ocid}${suffix}?region=${region}`;
  }
  if (isVcnScoped(type)) {
    // parentId欠落時の防御(呼び出し元契約違反)。VCN一覧に落とすよりOCID付きの旧フラットパスを試す方がまし。
    return `${CONSOLE_BASE_URL}/networking/${VCN_SCOPED_CONSOLE_PATH[type].segment}/${ocid}?region=${region}`;
  }
  if (type === "waf") {
    return parentId
      ? `${CONSOLE_BASE_URL}/waf/policies/${parentId}/firewalls/${ocid}?region=${region}`
      : `${CONSOLE_BASE_URL}/waf/policies?region=${region}`;
  }
  return `${CONSOLE_BASE_URL}/${DIRECT_CONSOLE_PATH[type]}/${ocid}?region=${region}`;
}
