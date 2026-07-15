export type OciPage = "nodes" | "service-lb" | "pv-storage";

export type OciSectionKey = "instances" | "taggedResources" | "nlbs" | "lbs" | "volumes" | "fileSystems";

// タグ検索(taggedResources)はservice-lbとpv-storageの両方が必要とする共有セクション。
const PAGE_SECTIONS: Record<OciPage, readonly OciSectionKey[]> = {
  nodes: ["instances"],
  "service-lb": ["taggedResources", "nlbs", "lbs"],
  "pv-storage": ["taggedResources", "volumes", "fileSystems"],
};

export function sectionsForPage(page: OciPage): readonly OciSectionKey[] {
  return PAGE_SECTIONS[page];
}
