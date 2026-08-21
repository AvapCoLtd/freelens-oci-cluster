export type OciPage = "nodes" | "service-lb" | "pv-storage" | "network" | "topology";

// "network"はsubnet/SL/RT/NSGのper-OCID Map群を束ねる複合セクション(store側で特別扱い)。
// "vnics"も同様に、attachment一覧とVNIC本体のper-OCID Mapを束ねる。
export type OciSectionKey =
  | "instances"
  | "vnics"
  | "taggedResources"
  | "nlbs"
  | "lbs"
  | "volumes"
  | "volumeAttachments"
  | "fileSystems"
  | "nodePools"
  | "wafs"
  | "vcn"
  | "network";

// タグ検索(taggedResources)は複数ページが必要とする共有セクション。nlbs/lbsはservice-lbとnetworkで共有。
const PAGE_SECTIONS: Record<OciPage, readonly OciSectionKey[]> = {
  nodes: ["instances", "nodePools"],
  "service-lb": ["taggedResources", "nlbs", "lbs"],
  "pv-storage": ["taggedResources", "volumes", "fileSystems"],
  network: ["nodePools", "taggedResources", "nlbs", "lbs", "wafs", "network"],
  topology: [
    "instances",
    "vnics",
    "nodePools",
    "taggedResources",
    "nlbs",
    "lbs",
    "wafs",
    "volumes",
    "volumeAttachments",
    "fileSystems",
    "vcn",
    "network",
  ],
};

export function sectionsForPage(page: OciPage): readonly OciSectionKey[] {
  return PAGE_SECTIONS[page];
}

/**
 * topologyページの進捗表示・欠落バナーが数える単位。OciSectionKeyの複合セクション
 * (fileSystems / network)を型別list単位まで割った粒度で、順序がそのまま表示順になる。
 * 図の材料にならないセクション(securityLists / nsgs / managedCerts / dnsChecks)も外さない:
 * 初回描画はこれらを含むreconcile完了を待つため、外すと待ち理由の無いスピナーになる。
 */
export const TOPOLOGY_SECTIONS = [
  "cluster",
  "taggedResources",
  "instances",
  "vnics",
  "nodePools",
  "lbs",
  "nlbs",
  "wafs",
  "volumes",
  "volumeAttachments",
  "volumeBackupPolicies",
  "fileSystems",
  "fssSnapshotPolicies",
  "vcn",
  "subnets",
  "routeTables",
  "securityLists",
  "nsgs",
  "gateways",
  "managedCerts",
  "dnsChecks",
  "dnsZones",
] as const;

export type TopologySection = (typeof TOPOLOGY_SECTIONS)[number];

export const TOPOLOGY_SECTION_LABEL: Record<TopologySection, string> = {
  cluster: "Cluster",
  taggedResources: "Tag Search",
  instances: "Instances",
  vnics: "VNICs",
  nodePools: "Node Pools",
  lbs: "Load Balancers",
  nlbs: "Network Load Balancers",
  wafs: "WAFs",
  volumes: "Block Volumes",
  volumeAttachments: "Volume Attachments",
  volumeBackupPolicies: "Backup Policies",
  fileSystems: "File Systems",
  fssSnapshotPolicies: "Snapshot Policies",
  vcn: "VCN",
  subnets: "Subnets",
  routeTables: "Route Tables",
  securityLists: "Security Lists",
  nsgs: "NSGs",
  gateways: "Gateways",
  managedCerts: "Certificates",
  dnsChecks: "DNS Checks",
  dnsZones: "DNS Zones",
};
