import type { OciResult } from "../oci/result";
import type { DnsMatchKind } from "./dns-check";
import type { LbRow, ListenerInfo, SubnetRole } from "./network-path";

const LB_KIND_LABEL: Record<LbRow["kind"], string> = { nlb: "NLB", lb: "classic" };

export function lbKindLabel(kind: LbRow["kind"]): string {
  return LB_KIND_LABEL[kind];
}

export function lbVisibilityLabel(isPrivate: boolean | undefined): string {
  return isPrivate === undefined ? "-" : isPrivate ? "private" : "public";
}

export function listenerLabel(listener: ListenerInfo): string {
  return `${listener.name}(${listener.protocol ?? "-"}:${listener.port ?? "-"})`;
}

const ROLE_LABEL: Record<SubnetRole, string> = { lb: "LB", node: "Node", endpoint: "endpoint" };

export function subnetRoleLabel(roles: readonly SubnetRole[]): string {
  return roles.map((role) => ROLE_LABEL[role]).join(" / ") || "-";
}

export function subnetPublicIpLabel(prohibitPublicIpOnVnic: boolean | undefined): string {
  return prohibitPublicIpOnVnic === undefined ? "-" : prohibitPublicIpOnVnic ? "Prohibited" : "Allowed";
}

export const RESOLUTION_FAILED_LABEL = "Resolution failed";

export const DNS_MATCH_LABEL: Record<DnsMatchKind, string> = {
  matched: "Matched",
  unmatched: "Mismatched",
  unresolved: "Unresolved",
};

/** 詳細ブロックの見出し(取得済みなら表示名、未取得/失敗はOCIDのまま出す)。 */
export function displayNameOrOcid<T>(
  result: OciResult<T> | undefined,
  ocid: string,
  nameOf: (data: T) => string | undefined,
): string {
  return result?.ok ? (nameOf(result.data) ?? ocid) : ocid;
}
