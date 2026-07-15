export type OciConsoleResourceType = "cluster" | "instance" | "nlb" | "lb" | "volume" | "filesystem";

const CONSOLE_BASE_URL = "https://cloud.oracle.com";

// 全種別、実機で遷移確認済みのディープリンクパス(2026-07-15)。
// filesystem はコンソール上の実URLに `/exports/<export OCID>` が付くが、基本形で開けることを確認済み。
const DIRECT_CONSOLE_PATH: Record<OciConsoleResourceType, string> = {
  cluster: "containers/clusters",
  volume: "block-storage/volumes",
  instance: "compute/instances",
  nlb: "networking/load-balancers/network-load-balancer",
  lb: "load-balancer/load-balancers",
  filesystem: "fss/file-systems",
};

export function buildConsoleUrl(type: OciConsoleResourceType, ocid: string, region: string): string {
  return `${CONSOLE_BASE_URL}/${DIRECT_CONSOLE_PATH[type]}/${ocid}?region=${region}`;
}
