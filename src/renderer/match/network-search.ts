import type { ClusterOciData } from "../fetch/fetch";
import type { OciResult } from "../oci/result";
import type { OciBackendSetHealthView } from "../oci/types";
import { matchesQuery } from "./filter-rows";
import { gatewayHealth, isSupportedGatewayId } from "./gateway-status";
import {
  displayNameOrOcid,
  lbKindLabel,
  lbVisibilityLabel,
  listenerLabel,
  subnetPublicIpLabel,
  subnetRoleLabel,
} from "./network-labels";
import type { LbRow, SubnetRow, WafRow } from "./network-path";
import { nsgRuleRows, type RouteRow, type RuleRow, routeRows, securityListRuleRows } from "./rule-rows";
import { wafDefaultAction, wafPolicyRuleRows } from "./waf-policy";

export type SearchValue = string | number | undefined;

/** 1行分の検索対象値を、サマリ行に出るものと展開領域にしか出ないものに分けて持つ。 */
export interface SearchValues {
  summary: SearchValue[];
  detail: SearchValue[];
}

export function allSearchValues(values: SearchValues): SearchValue[] {
  return [...values.summary, ...values.detail];
}

/** サマリ行の値だけでは絞り込みに残らない行か(展開領域の値で残った行の自動展開判定)。 */
export function matchedOnlyInDetail(query: string, values: SearchValues): boolean {
  if (query.trim().length === 0) return false;
  return !matchesQuery(values.summary, query);
}

function ruleRowValues(rows: readonly RuleRow[]): SearchValue[] {
  return rows.flatMap((rule) => [rule.direction, rule.protocol, rule.peer, rule.ports, rule.description]);
}

function gatewayValues(entityId: string | undefined, gateways: ClusterOciData["gateways"]): SearchValue[] {
  if (!isSupportedGatewayId(entityId)) return [];
  const result = gateways[entityId];
  if (!result?.ok) return [];
  return [result.data.displayName, gatewayHealth(result.data).label];
}

function routeRowValues(rows: readonly RouteRow[], gateways: ClusterOciData["gateways"]): SearchValue[] {
  return rows.flatMap((route) => [
    route.destination,
    route.entityKind,
    route.description,
    ...gatewayValues(route.entityId, gateways),
  ]);
}

export function nsgSearchValues(nsgId: string, nsgs: ClusterOciData["nsgs"]): SearchValue[] {
  const result = nsgs[nsgId];
  return [
    displayNameOrOcid(result, nsgId, (nsg) => nsg.nsg["display-name"]),
    ...(result?.ok ? ruleRowValues(nsgRuleRows(result.data.rules)) : []),
  ];
}

export interface SubnetSearchContext {
  securityLists: ClusterOciData["securityLists"];
  routeTables: ClusterOciData["routeTables"];
  gateways: ClusterOciData["gateways"];
}

export function subnetSearchValues(row: SubnetRow, ctx: SubnetSearchContext): SearchValues {
  const securityListValues = row.securityListIds.flatMap((slId) => {
    const result = ctx.securityLists[slId];
    return [
      displayNameOrOcid(result, slId, (sl) => sl["display-name"]),
      ...(result?.ok ? ruleRowValues(securityListRuleRows(result.data)) : []),
    ];
  });
  const routeTableResult = row.routeTableId ? ctx.routeTables[row.routeTableId] : undefined;
  const routeTableValues = row.routeTableId
    ? [
        displayNameOrOcid(routeTableResult, row.routeTableId, (rt) => rt["display-name"]),
        ...(routeTableResult?.ok ? routeRowValues(routeRows(routeTableResult.data), ctx.gateways) : []),
      ]
    : [];
  return {
    summary: [
      row.displayName ?? row.subnetId,
      row.cidrBlock,
      subnetRoleLabel(row.roles),
      subnetPublicIpLabel(row.prohibitPublicIpOnVnic),
    ],
    detail: [...securityListValues, ...routeTableValues],
  };
}

export interface LbSearchContext {
  nsgs: ClusterOciData["nsgs"];
  managedCerts: ClusterOciData["managedCerts"];
  backendHealthOf: (backendSetName: string) => OciResult<OciBackendSetHealthView> | undefined;
}

function backendSetValues(row: LbRow, ctx: LbSearchContext): SearchValue[] {
  return row.backendSetNames.flatMap((name) => {
    const result = ctx.backendHealthOf(name);
    if (!result?.ok) return [name];
    return [
      name,
      result.data.status,
      result.data.totalBackendCount,
      ...(result.data.criticalStateBackendNames ?? []),
      ...(result.data.warningStateBackendNames ?? []),
      ...(result.data.unknownStateBackendNames ?? []),
    ];
  });
}

export function lbSearchValues(row: LbRow, ctx: LbSearchContext): SearchValues {
  const managedCertValues = row.managedCertificateIds.flatMap((certId) => {
    const result = ctx.managedCerts[certId];
    return [displayNameOrOcid(result, certId, (cert) => cert.name), result?.ok ? result.data.validTo : undefined];
  });
  return {
    summary: [row.displayName, lbKindLabel(row.kind), ...row.ips, lbVisibilityLabel(row.isPrivate), row.lifecycleState],
    detail: [
      ...row.listeners.map(listenerLabel),
      ...managedCertValues,
      // 残日数バッジ(Date.now依存)は含めない。証明書はCN(subject)・SAN・期限で引く
      ...row.certificates.flatMap((cert) => [cert.name, ...cert.listenerNames, cert.validTo, cert.subject, cert.sans]),
      ...backendSetValues(row, ctx),
      ...row.nsgIds.flatMap((nsgId) => nsgSearchValues(nsgId, ctx.nsgs)),
    ],
  };
}

export function wafSearchValues(row: WafRow, wafPolicies: ClusterOciData["wafPolicies"]): SearchValues {
  const result = row.policyId ? wafPolicies[row.policyId] : undefined;
  const policyValues: SearchValue[] = row.policyId
    ? [displayNameOrOcid(result, row.policyId, (policy) => policy["display-name"])]
    : [];
  const ruleValues = result?.ok
    ? [
        wafDefaultAction(result.data),
        ...wafPolicyRuleRows(result.data).flatMap((rule) => [rule.module, rule.name, rule.action, rule.detail]),
      ]
    : [];
  return {
    summary: [row.displayName, row.targetLbName ?? row.targetLbId, row.lifecycleState],
    detail: [...policyValues, ...ruleValues],
  };
}

/** DNSセクションの1行(展開領域を持たないため検索対象はサマリ行のセルのみ)。 */
export interface DnsRow {
  host: string;
  resolvedIps: readonly string[];
  matchedLbNames: readonly string[];
  statusLabel?: string;
  errorMessage?: string;
  /** ホストを含むOCI DNSゾーン(GLOBAL)。未取得・不一致では付かない */
  zone?: { id: string; name: string };
}

export function dnsSearchValues(row: DnsRow): SearchValue[] {
  return [row.host, ...row.resolvedIps, ...row.matchedLbNames, row.statusLabel, row.errorMessage, row.zone?.name];
}
