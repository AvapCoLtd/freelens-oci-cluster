import type { OciDnsZone } from "../oci/types";

/** 比較用にホスト名・ゾーン名を正規化する(末尾ドット除去+小文字化)。 */
function normalize(name: string): string {
  return name.replace(/\.$/, "").toLowerCase();
}

/**
 * ホスト名を含むゾーンのうち、ACTIVEを優先し、その中で名前が最長のもの
 * (=最も具体的な委譲先)を返す。該当ゾーンが無ければundefined。
 */
export function findZoneForHost(host: string, zones: readonly OciDnsZone[]): OciDnsZone | undefined {
  const target = normalize(host);
  let best: OciDnsZone | undefined;
  let bestActive = false;
  let bestLength = -1;
  for (const zone of zones) {
    if (typeof zone.name !== "string" || typeof zone.id !== "string") continue;
    const zoneName = normalize(zone.name);
    if (target !== zoneName && !target.endsWith(`.${zoneName}`)) continue;
    // 非ACTIVEも候補に残す: lifecycle-stateの欠落した応答で全ゾーンが落ちるのを避ける。
    const active = zone["lifecycle-state"] === undefined || zone["lifecycle-state"] === "ACTIVE";
    if (active === bestActive && zoneName.length <= bestLength) continue;
    if (!active && bestActive) continue;
    best = zone;
    bestActive = active;
    bestLength = zoneName.length;
  }
  return best;
}
