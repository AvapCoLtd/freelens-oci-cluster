import type { OciBackendSetHealthView } from "../oci/types";

export const BACKEND_HEALTH_LEVELS = ["ok", "unknown", "warning", "critical"] as const;

export type BackendHealthLevel = (typeof BACKEND_HEALTH_LEVELS)[number];

/** externalTrafficPolicy: Localで説明がつく不合格。OCIが返す状態ではなく導出値。 */
export const NO_LOCAL_POD_HEALTH = "no-local-pod";

/** エッジに載る健全性。深刻度の低い順で、worseBackendHealthの比較と凡例の並びを兼ねる。 */
export const EDGE_HEALTH_LEVELS = ["ok", NO_LOCAL_POD_HEALTH, "unknown", "warning", "critical"] as const;

export type EdgeHealthLevel = (typeof EDGE_HEALTH_LEVELS)[number];

const SEVERITY = new Map<EdgeHealthLevel, number>(EDGE_HEALTH_LEVELS.map((level, index) => [level, index]));

/** backendHealths Mapのキー(store・network一覧・トポロジー図で共有)。 */
export function backendHealthKey(kind: "lb" | "nlb", lbId: string, backendSetName: string): string {
  return `${kind}:${lbId}:${backendSetName}`;
}

export function worseBackendHealth<T extends EdgeHealthLevel>(a: T | undefined, b: T | undefined): T | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return (SEVERITY.get(a) ?? 0) >= (SEVERITY.get(b) ?? 0) ? a : b;
}

export function backendNameIp(name: string): string {
  const bracket = name.lastIndexOf("]");
  if (name.startsWith("[") && bracket > 0) return name.slice(1, bracket);
  const colon = name.lastIndexOf(":");
  if (colon < 0) return name;
  // ブラケット無しのIPv6はポート区切りとアドレス内のコロンを区別できない: 末尾で切ると別アドレスになる。
  return name.slice(0, colon).includes(":") ? name : name.slice(0, colon);
}

const NAMED_LEVELS = [
  ["criticalStateBackendNames", "critical"],
  ["warningStateBackendNames", "warning"],
  ["unknownStateBackendNames", "unknown"],
] as const;

/** 名前リストに挙がらないbackendの既定。set全体がUNKNOWNならIP単位でも判定できない。 */
export function unlistedBackendHealth(health: OciBackendSetHealthView): BackendHealthLevel {
  return health.status === "UNKNOWN" ? "unknown" : "ok";
}

export function backendHealthByIp(health: OciBackendSetHealthView): Map<string, BackendHealthLevel> {
  const byIp = new Map<string, BackendHealthLevel>();
  for (const [field, level] of NAMED_LEVELS) {
    for (const name of health[field] ?? []) {
      const ip = backendNameIp(name);
      const merged = worseBackendHealth(byIp.get(ip), level);
      if (merged) byIp.set(ip, merged);
    }
  }
  return byIp;
}
