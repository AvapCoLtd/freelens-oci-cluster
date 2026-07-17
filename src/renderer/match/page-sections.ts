export type OciPage = "nodes" | "service-lb" | "pv-storage" | "network";

// "network"はsubnet/SL/RT/NSGのper-OCID Map群を束ねる複合セクション(store側で特別扱い)。
export type OciSectionKey =
  | "instances"
  | "taggedResources"
  | "nlbs"
  | "lbs"
  | "volumes"
  | "fileSystems"
  | "nodePools"
  | "wafs"
  | "network";

// タグ検索(taggedResources)は複数ページが必要とする共有セクション。nlbs/lbsはservice-lbとnetworkで共有。
const PAGE_SECTIONS: Record<OciPage, readonly OciSectionKey[]> = {
  nodes: ["instances", "nodePools"],
  "service-lb": ["taggedResources", "nlbs", "lbs"],
  "pv-storage": ["taggedResources", "volumes", "fileSystems"],
  network: ["nodePools", "taggedResources", "nlbs", "lbs", "wafs", "network"],
};

export function sectionsForPage(page: OciPage): readonly OciSectionKey[] {
  return PAGE_SECTIONS[page];
}
