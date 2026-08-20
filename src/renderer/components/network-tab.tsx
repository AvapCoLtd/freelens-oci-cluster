import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import * as React from "react";
import type { ClusterOciData } from "../fetch/fetch";
import { collectHostnames, type DnsMatchKind, matchDnsToLbs } from "../match/dns-check";
import { filterRows } from "../match/filter-rows";
import { gatewayHealth, isSupportedGatewayId } from "../match/gateway-status";
import { daysUntil } from "../match/lb-certificates";
import {
  DNS_MATCH_LABEL,
  displayNameOrOcid,
  lbKindLabel,
  lbVisibilityLabel,
  listenerLabel,
  RESOLUTION_FAILED_LABEL,
  subnetPublicIpLabel,
  subnetRoleLabel,
} from "../match/network-labels";
import {
  buildNetworkView,
  clusterLbIds,
  internalIpsOfNodes,
  type LbRow,
  type NetworkView,
  type SubnetRow,
  type WafRow,
} from "../match/network-path";
import {
  allSearchValues,
  type DnsRow,
  dnsSearchValues,
  lbSearchValues,
  matchedOnlyInDetail,
  nsgSearchValues,
  type SearchValues,
  subnetSearchValues,
  wafSearchValues,
} from "../match/network-search";
import { nsgRuleRows, routeRows, securityListRuleRows } from "../match/rule-rows";
import { entriesReady, sectionsReady } from "../match/section-ready";
import { ingressIpsOfServices } from "../match/service-lb";
import { wafDefaultAction, wafPolicyRuleRows } from "../match/waf-policy";
import type { OciResult } from "../oci/result";
import { backendHealthKey, ociClusterStore } from "../store/oci-cluster-store";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { ExpandableRow } from "./expandable-row";
import { Icon } from "./freelens-ui";
import { OcidCopyButton } from "./ocid-copy-button";
import { RouteRuleTable, RuleTable } from "./rule-table";
import { SearchBar } from "./search-bar";
import { LoadingBlock, Spinner } from "./spinner";
import { LifecycleBadge, StatusBadge, type StatusTone } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE } from "./table-styles";
import type { SearchState } from "./use-search-query";

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: "bold",
  margin: "20px 0 8px",
};

const SECTION_NOTE_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: "var(--textColorSecondary, #9aa0a6)",
  marginBottom: 8,
};

const BLOCK_TITLE_STYLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: "bold",
  margin: "10px 0 4px",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const PENDING_STYLE: React.CSSProperties = { color: "var(--textColorSecondary, #9aa0a6)", fontSize: 12 };

const FETCH_FAILED_LABEL = "Fetch failed";

interface SectionContext {
  data: ClusterOciData;
  region: string | undefined;
  clusterKey: string;
  query: string;
}

/** LB/NLBの行集合が確定したか(クラスタ関連判定にタグ検索も要る)。 */
function lbRowsReady(data: ClusterOciData): boolean {
  return sectionsReady(data.nlbs, data.lbs, data.taggedResources);
}

/** subnet一覧の行集合と各行のセル(名前/CIDR)が確定したか。 */
function subnetRowsReady(data: ClusterOciData, rows: SubnetRow[]): boolean {
  if (!lbRowsReady(data) || !sectionsReady(data.cluster, data.nodePools)) return false;
  return entriesReady(
    data.subnets,
    rows.map((row) => row.subnetId),
  );
}

/** Record未登載(取得中)/失敗/成功を1блокに畳む共通表示。 */
function ResultBlock<T>({
  result,
  render,
}: {
  result: OciResult<T> | undefined;
  render: (data: T) => React.ReactNode;
}) {
  if (!result) return <Spinner size={14} />;
  if (!result.ok) return <SectionError kind={result.kind} raw={result.raw} />;
  return <>{render(result.data)}</>;
}

/** OCID付きタイトル行 + ResultBlock描画の共通レイアウト(SL/RT/NSG/WAFポリシー詳細で共有)。 */
function NamedDetailBlock<T>({
  label,
  ocid,
  actions,
  result,
  render,
}: {
  label: React.ReactNode;
  ocid: string;
  actions?: React.ReactNode;
  result: OciResult<T> | undefined;
  render: (data: T) => React.ReactNode;
}) {
  return (
    <div>
      <div style={BLOCK_TITLE_STYLE}>
        <span>{label}</span>
        <span style={{ display: "flex", gap: 4 }}>
          <OcidCopyButton ocid={ocid} />
          {actions}
        </span>
      </div>
      <ResultBlock result={result} render={render} />
    </div>
  );
}

function SlBlock({ ctx, slId }: { ctx: SectionContext; slId: string }) {
  const result = ctx.data.securityLists[slId];
  return (
    <NamedDetailBlock
      label={`Security List: ${displayNameOrOcid(result, slId, (sl) => sl["display-name"])}`}
      ocid={slId}
      actions={
        ctx.region &&
        result?.ok &&
        result.data["vcn-id"] && (
          <ConsoleButton type="security-list" ocid={slId} region={ctx.region} parentId={result.data["vcn-id"]} />
        )
      }
      result={result}
      render={(sl) => <RuleTable rows={securityListRuleRows(sl)} />}
    />
  );
}

function GatewayStatusCell({ ctx, entityId }: { ctx: SectionContext; entityId: string | undefined }) {
  if (!isSupportedGatewayId(entityId)) return <span>-</span>;
  const result = ctx.data.gateways[entityId];
  if (!result) return <Spinner size={12} />;
  if (!result.ok) return <StatusBadge label={FETCH_FAILED_LABEL} tone="neutral" />;
  const health = gatewayHealth(result.data);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <StatusBadge label={health.label} tone={health.healthy ? "success" : "error"} />
      {result.data.displayName && <span style={{ fontSize: 11 }}>{result.data.displayName}</span>}
    </span>
  );
}

function RtBlock({ ctx, rtId }: { ctx: SectionContext; rtId: string }) {
  const result = ctx.data.routeTables[rtId];
  return (
    <NamedDetailBlock
      label={`Route Table: ${displayNameOrOcid(result, rtId, (rt) => rt["display-name"])}`}
      ocid={rtId}
      actions={
        ctx.region &&
        result?.ok &&
        result.data["vcn-id"] && (
          <ConsoleButton type="route-table" ocid={rtId} region={ctx.region} parentId={result.data["vcn-id"]} />
        )
      }
      result={result}
      render={(rt) => (
        <RouteRuleTable
          rows={routeRows(rt)}
          renderStatus={(entityId) => <GatewayStatusCell ctx={ctx} entityId={entityId} />}
        />
      )}
    />
  );
}

function NsgBlock({ ctx, nsgId }: { ctx: SectionContext; nsgId: string }) {
  const result = ctx.data.nsgs[nsgId];
  return (
    <NamedDetailBlock
      label={`NSG: ${displayNameOrOcid(result, nsgId, (nsg) => nsg.nsg["display-name"])}`}
      ocid={nsgId}
      actions={
        ctx.region &&
        result?.ok &&
        result.data.nsg["vcn-id"] && (
          <ConsoleButton type="nsg" ocid={nsgId} region={ctx.region} parentId={result.data.nsg["vcn-id"]} />
        )
      }
      result={result}
      render={(nsg) => <RuleTable rows={nsgRuleRows(nsg.rules)} />}
    />
  );
}

function BackendHealthBadge({ status }: { status: string | undefined }) {
  if (!status) return <StatusBadge label="-" tone="neutral" />;
  return <StatusBadge label={status} tone={status === "OK" ? "success" : "error"} />;
}

function BackendSetBlock({ ctx, lb, backendSetName }: { ctx: SectionContext; lb: LbRow; backendSetName: string }) {
  const key = backendHealthKey(lb.kind, lb.id, backendSetName);
  const result = ctx.data.backendHealths[key];
  const unhealthy = result?.ok
    ? [
        ...(result.data.criticalStateBackendNames ?? []),
        ...(result.data.warningStateBackendNames ?? []),
        ...(result.data.unknownStateBackendNames ?? []),
      ]
    : [];
  return (
    <div>
      <div style={BLOCK_TITLE_STYLE}>
        <span>backend set: {backendSetName}</span>
        {result?.ok && <BackendHealthBadge status={result.data.status} />}
        <Icon
          material="refresh"
          tooltip="Refetch"
          interactive
          small
          onClick={() => ociClusterStore.reloadBackendHealth(ctx.clusterKey, lb.kind, lb.id, backendSetName)}
        />
      </div>
      <ResultBlock
        result={result}
        render={(health) => (
          <div style={{ fontSize: 12 }}>
            <div>
              Backends: {health.totalBackendCount ?? "-"} / Status: {health.status ?? "-"}
            </div>
            {unhealthy.length > 0 && <div>unhealthy: {unhealthy.join(", ")}</div>}
          </div>
        )}
      />
    </div>
  );
}

function CertificateBadge({ validTo, parseError }: { validTo?: string; parseError?: boolean }) {
  if (parseError || !validTo) return <StatusBadge label="Unparseable" tone="neutral" />;
  const days = daysUntil(validTo, Date.now());
  if (days === undefined) return <StatusBadge label="-" tone="neutral" />;
  if (days < 0) return <StatusBadge label={`Expired (${-days}d ago)`} tone="error" />;
  if (days <= 30) return <StatusBadge label={`${days}d left`} tone="error" />;
  return <StatusBadge label={`${days}d left`} tone="success" />;
}

function LbDetail({ ctx, lb }: { ctx: SectionContext; lb: LbRow }) {
  return (
    <div>
      {lb.listeners.length > 0 && (
        <div style={{ fontSize: 12, marginBottom: 4 }}>listener: {lb.listeners.map(listenerLabel).join(", ")}</div>
      )}
      {lb.managedCertificateIds.map((certId) => {
        const result = ctx.data.managedCerts[certId];
        return (
          <div key={certId} style={{ fontSize: 12, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span>
              Certificate {displayNameOrOcid(result, certId, (cert) => cert.name)}: expires{" "}
              {result?.ok && result.data.validTo ? new Date(result.data.validTo).toLocaleDateString() : "-"}
            </span>
            {result?.ok ? (
              <CertificateBadge validTo={result.data.validTo} />
            ) : result ? (
              <span style={PENDING_STYLE}>{FETCH_FAILED_LABEL}</span>
            ) : (
              <Spinner size={12} />
            )}
          </div>
        );
      })}
      {lb.certificates.map((cert) => (
        <div key={cert.name} style={{ fontSize: 12, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <span>
            Certificate {cert.name}
            {cert.listenerNames.length > 0 && ` (listener: ${cert.listenerNames.join(", ")})`}: expires{" "}
            {cert.validTo ? new Date(cert.validTo).toLocaleDateString() : "-"}
            {cert.sans && ` / ${cert.sans}`}
          </span>
          <CertificateBadge validTo={cert.validTo} parseError={cert.parseError} />
        </div>
      ))}
      {lb.backendSetNames.map((name) => (
        <BackendSetBlock key={name} ctx={ctx} lb={lb} backendSetName={name} />
      ))}
      {lb.backendSetNames.length === 0 && <div style={PENDING_STYLE}>No backend sets</div>}
      {lb.nsgIds.map((nsgId) => (
        <NsgBlock key={nsgId} ctx={ctx} nsgId={nsgId} />
      ))}
    </div>
  );
}

function lbValuesOf(ctx: SectionContext, lb: LbRow): SearchValues {
  return lbSearchValues(lb, {
    nsgs: ctx.data.nsgs,
    managedCerts: ctx.data.managedCerts,
    backendHealthOf: (name) => ctx.data.backendHealths[backendHealthKey(lb.kind, lb.id, name)],
  });
}

/** 検索語がある間だけ全LB行分を先行取得する: onExpand経由だけでは未展開行のbackend healthが検索に載らない。 */
function usePrefetchBackendHealth(ctx: SectionContext, lbRows: LbRow[]): void {
  const searching = ctx.query.trim().length > 0;
  const { clusterKey } = ctx;
  // 行集合の同値判定に使う。lbRowsは毎レンダー新しい配列で来るため参照では比較できない。
  const rowsKey = lbRows.map((lb) => `${lb.kind}:${lb.id}:${lb.backendSetNames.join(",")}`).join("|");
  const lbRowsRef = React.useRef(lbRows);
  lbRowsRef.current = lbRows;
  // biome-ignore lint/correctness/useExhaustiveDependencies(rowsKey): 行集合の変化はこのキーで見る
  React.useEffect(() => {
    if (!searching) return;
    for (const lb of lbRowsRef.current) {
      for (const name of lb.backendSetNames) {
        ociClusterStore.ensureBackendHealth(clusterKey, lb.kind, lb.id, name);
      }
    }
  }, [searching, rowsKey, clusterKey]);
}

function LbSection({ ctx, lbRows }: { ctx: SectionContext; lbRows: LbRow[] }) {
  const columns = 7;
  const rows = filterRows(lbRows, ctx.query, (lb) => allSearchValues(lbValuesOf(ctx, lb)));
  usePrefetchBackendHealth(ctx, lbRows);
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>LB / NLB</div>
      {!ctx.data.nlbs.ok && ctx.data.nlbs.kind !== "not_requested" && (
        <SectionError kind={ctx.data.nlbs.kind} raw={ctx.data.nlbs.raw} />
      )}
      {!ctx.data.lbs.ok && ctx.data.lbs.kind !== "not_requested" && (
        <SectionError kind={ctx.data.lbs.kind} raw={ctx.data.lbs.raw} />
      )}
      {!lbRowsReady(ctx.data) ? (
        <LoadingBlock />
      ) : lbRows.length === 0 ? (
        <EmptyState message="No LB / NLB" />
      ) : rows.length === 0 ? (
        <EmptyState message={`No LB / NLB match "${ctx.query}"`} />
      ) : (
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={{ ...TH_STYLE, width: 24 }} />
              <th style={TH_STYLE}>Name</th>
              <th style={TH_STYLE}>Kind</th>
              <th style={TH_STYLE}>IP</th>
              <th style={TH_STYLE}>Public</th>
              <th style={TH_STYLE}>lifecycle-state</th>
              <th style={TH_STYLE}>OCID</th>
              <th style={TH_STYLE} />
            </tr>
          </thead>
          <tbody>
            {rows.map((lb) => (
              <ExpandableRow
                key={lb.id}
                colSpan={columns}
                forceExpanded={matchedOnlyInDetail(ctx.query, lbValuesOf(ctx, lb))}
                onExpand={() => {
                  for (const name of lb.backendSetNames) {
                    ociClusterStore.ensureBackendHealth(ctx.clusterKey, lb.kind, lb.id, name);
                  }
                }}
                renderDetail={() => <LbDetail ctx={ctx} lb={lb} />}
                cells={
                  <>
                    <td style={TD_STYLE}>{lb.displayName ?? "-"}</td>
                    <td style={TD_STYLE}>{lbKindLabel(lb.kind)}</td>
                    <td style={TD_STYLE}>{lb.ips.join(", ") || "-"}</td>
                    <td style={TD_STYLE}>{lbVisibilityLabel(lb.isPrivate)}</td>
                    <td style={TD_STYLE}>
                      <LifecycleBadge state={lb.lifecycleState} />
                    </td>
                    <td style={TD_STYLE}>
                      <OcidCopyButton ocid={lb.id} />
                    </td>
                    <td style={TD_STYLE}>
                      {ctx.region && <ConsoleButton type={lb.kind} ocid={lb.id} region={ctx.region} />}
                    </td>
                  </>
                }
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SubnetDetail({ ctx, subnet }: { ctx: SectionContext; subnet: SubnetRow }) {
  return (
    <div>
      {subnet.securityListIds.map((slId) => (
        <SlBlock key={slId} ctx={ctx} slId={slId} />
      ))}
      {subnet.routeTableId && <RtBlock ctx={ctx} rtId={subnet.routeTableId} />}
      {subnet.securityListIds.length === 0 && !subnet.routeTableId && (
        <div style={PENDING_STYLE}>Subnet details not fetched</div>
      )}
    </div>
  );
}

function subnetValuesOf(ctx: SectionContext, subnet: SubnetRow): SearchValues {
  return subnetSearchValues(subnet, {
    securityLists: ctx.data.securityLists,
    routeTables: ctx.data.routeTables,
    gateways: ctx.data.gateways,
  });
}

function SubnetSection({
  ctx,
  title,
  note,
  rows,
  extraNsgIds,
}: {
  ctx: SectionContext;
  title: string;
  note?: string;
  rows: SubnetRow[];
  extraNsgIds?: string[];
}) {
  const columns = 6;
  const visibleRows = filterRows(rows, ctx.query, (subnet) => allSearchValues(subnetValuesOf(ctx, subnet)));
  const visibleNsgIds = filterRows(extraNsgIds ?? [], ctx.query, (nsgId) => nsgSearchValues(nsgId, ctx.data.nsgs));
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>{title}</div>
      {note && <div style={SECTION_NOTE_STYLE}>{note}</div>}
      {!subnetRowsReady(ctx.data, rows) ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState message="No target subnets" />
      ) : visibleRows.length === 0 ? (
        <EmptyState message={`No subnets match "${ctx.query}"`} />
      ) : (
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={{ ...TH_STYLE, width: 24 }} />
              <th style={TH_STYLE}>Subnet</th>
              <th style={TH_STYLE}>CIDR</th>
              <th style={TH_STYLE}>Role</th>
              <th style={TH_STYLE}>public IP</th>
              <th style={TH_STYLE}>OCID</th>
              <th style={TH_STYLE} />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((subnet) => (
              <ExpandableRow
                key={subnet.subnetId}
                colSpan={columns}
                forceExpanded={matchedOnlyInDetail(ctx.query, subnetValuesOf(ctx, subnet))}
                renderDetail={() => <SubnetDetail ctx={ctx} subnet={subnet} />}
                cells={
                  <>
                    <td style={TD_STYLE}>{subnet.displayName ?? subnet.subnetId}</td>
                    <td style={TD_STYLE}>{subnet.cidrBlock ?? "-"}</td>
                    <td style={TD_STYLE}>{subnetRoleLabel(subnet.roles)}</td>
                    <td style={TD_STYLE}>{subnetPublicIpLabel(subnet.prohibitPublicIpOnVnic)}</td>
                    <td style={TD_STYLE}>
                      <OcidCopyButton ocid={subnet.subnetId} />
                    </td>
                    <td style={TD_STYLE}>
                      {ctx.region && subnet.vcnId && (
                        <ConsoleButton
                          type="subnet"
                          ocid={subnet.subnetId}
                          region={ctx.region}
                          parentId={subnet.vcnId}
                        />
                      )}
                    </td>
                  </>
                }
              />
            ))}
          </tbody>
        </table>
      )}
      {visibleNsgIds.map((nsgId) => (
        <NsgBlock key={nsgId} ctx={ctx} nsgId={nsgId} />
      ))}
    </section>
  );
}

function WafPolicyDetail({ ctx, policyId }: { ctx: SectionContext; policyId: string | undefined }) {
  if (!policyId) return <div style={PENDING_STYLE}>Policy OCID not fetched</div>;
  const result = ctx.data.wafPolicies[policyId];
  return (
    <NamedDetailBlock
      label={`Policy: ${displayNameOrOcid(result, policyId, (policy) => policy["display-name"])}`}
      ocid={policyId}
      actions={ctx.region && <ConsoleButton type="waf-policy" ocid={policyId} region={ctx.region} />}
      result={result}
      render={(policy) => {
        const rows = wafPolicyRuleRows(policy);
        return (
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              Default action (when no rule matches): {wafDefaultAction(policy)}
            </div>
            {rows.length === 0 ? (
              <div style={PENDING_STYLE}>No rules (default action only)</div>
            ) : (
              <table style={{ ...TABLE_STYLE, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={TH_STYLE}>Stage</th>
                    <th style={TH_STYLE}>Rule</th>
                    <th style={TH_STYLE}>Action</th>
                    <th style={TH_STYLE}>Condition / Content</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((rule) => (
                    <tr key={`${rule.module}:${rule.name}`}>
                      <td style={TD_STYLE}>{rule.module}</td>
                      <td style={TD_STYLE}>{rule.name}</td>
                      <td style={TD_STYLE}>{rule.action}</td>
                      <td style={{ ...TD_STYLE, wordBreak: "break-all" }}>{rule.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      }}
    />
  );
}

const DNS_MATCH_TONE: Record<DnsMatchKind, StatusTone> = {
  matched: "success",
  unmatched: "error",
  unresolved: "error",
};

/** 解決待ち(pending)を含むDNS行。検索対象はDnsRowの値のみ。 */
interface DnsSectionRow extends DnsRow {
  pending: boolean;
  tone?: StatusTone;
}

function dnsSectionRow(host: string, ctx: SectionContext, lbRows: LbRow[]): DnsSectionRow {
  const result = ctx.data.dnsChecks[host];
  if (!result) return { host, resolvedIps: [], matchedLbNames: [], pending: true };
  if (!result.ok) {
    return {
      host,
      resolvedIps: [],
      matchedLbNames: [],
      pending: false,
      statusLabel: RESOLUTION_FAILED_LABEL,
      errorMessage: `${RESOLUTION_FAILED_LABEL}: ${result.raw.message}`,
      tone: "neutral",
    };
  }
  const match = matchDnsToLbs(result.data, lbRows);
  return {
    host,
    resolvedIps: result.data,
    matchedLbNames: match.matchedLbNames,
    pending: false,
    statusLabel: DNS_MATCH_LABEL[match.kind],
    tone: DNS_MATCH_TONE[match.kind],
  };
}

function DnsSection({ ctx, view }: { ctx: SectionContext; view: NetworkView }) {
  // 行の集合はK8s側から直に導く(dnsChecksの登録待ちで「該当なし」を先に出さないため)。
  const hosts = [
    ...new Set([
      ...collectHostnames(Renderer.K8sApi.ingressStore.items, Renderer.K8sApi.serviceStore.items),
      ...Object.keys(ctx.data.dnsChecks),
    ]),
  ].sort();
  const rows = filterRows(
    hosts.map((host) => dnsSectionRow(host, ctx, view.lbRows)),
    ctx.query,
    dnsSearchValues,
  );
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>DNS</div>
      <div style={SECTION_NOTE_STYLE}>
        Resolves Ingress / Service (external-dns) hostnames using this machine's resolver and cross-checks them against
        cluster-related LB IPs. In split-DNS environments, results may differ from external resolution.
      </div>
      {hosts.length === 0 ? (
        <EmptyState message="No hostnames to check (no Ingress / external-dns annotations)" />
      ) : rows.length === 0 ? (
        <EmptyState message={`No hostnames match "${ctx.query}"`} />
      ) : (
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={TH_STYLE}>Hostname</th>
              <th style={TH_STYLE}>Resolved IP</th>
              <th style={TH_STYLE}>Matched LB</th>
              <th style={TH_STYLE}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.pending || row.errorMessage) {
                return (
                  <tr key={row.host}>
                    <td style={TD_STYLE}>{row.host}</td>
                    <td style={TD_STYLE} colSpan={2}>
                      {row.errorMessage ?? <Spinner size={12} />}
                    </td>
                    <td style={TD_STYLE}>
                      {row.statusLabel && row.tone ? <StatusBadge label={row.statusLabel} tone={row.tone} /> : "-"}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={row.host}>
                  <td style={TD_STYLE}>{row.host}</td>
                  <td style={TD_STYLE}>{row.resolvedIps.join(", ") || "-"}</td>
                  <td style={TD_STYLE}>{row.matchedLbNames.join(", ") || "-"}</td>
                  <td style={TD_STYLE}>
                    {row.statusLabel && row.tone && <StatusBadge label={row.statusLabel} tone={row.tone} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function wafValuesOf(ctx: SectionContext, waf: WafRow): SearchValues {
  return wafSearchValues(waf, ctx.data.wafPolicies);
}

function WafSection({ ctx, view }: { ctx: SectionContext; view: NetworkView }) {
  const columns = 5;
  const rows = filterRows(view.wafRows, ctx.query, (waf) => allSearchValues(wafValuesOf(ctx, waf)));
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>WAF</div>
      <div style={SECTION_NOTE_STYLE}>
        WAF only applies to classic LB (not NLB). Expand a row to see the policy's rules (block conditions).
      </div>
      {!ctx.data.wafs.ok && ctx.data.wafs.kind !== "not_requested" && (
        <SectionError kind={ctx.data.wafs.kind} raw={ctx.data.wafs.raw} />
      )}
      {!lbRowsReady(ctx.data) || !sectionsReady(ctx.data.wafs) ? (
        <LoadingBlock />
      ) : view.wafRows.length === 0 ? (
        <EmptyState message="No WAF attached to this cluster's classic LBs" />
      ) : rows.length === 0 ? (
        <EmptyState message={`No WAF match "${ctx.query}"`} />
      ) : (
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <th style={{ ...TH_STYLE, width: 24 }} />
              <th style={TH_STYLE}>WAF</th>
              <th style={TH_STYLE}>Target LB</th>
              <th style={TH_STYLE}>lifecycle-state</th>
              <th style={TH_STYLE}>OCID</th>
              <th style={TH_STYLE} />
            </tr>
          </thead>
          <tbody>
            {rows.map((waf) => (
              <ExpandableRow
                key={waf.id}
                colSpan={columns}
                forceExpanded={matchedOnlyInDetail(ctx.query, wafValuesOf(ctx, waf))}
                renderDetail={() => <WafPolicyDetail ctx={ctx} policyId={waf.policyId} />}
                cells={
                  <>
                    <td style={TD_STYLE}>{waf.displayName ?? "-"}</td>
                    <td style={TD_STYLE}>{waf.targetLbName ?? waf.targetLbId}</td>
                    <td style={TD_STYLE}>
                      <LifecycleBadge state={waf.lifecycleState} />
                    </td>
                    <td style={TD_STYLE}>
                      <OcidCopyButton ocid={waf.id} />
                    </td>
                    <td style={TD_STYLE}>
                      {ctx.region && waf.policyId && (
                        <ConsoleButton type="waf" ocid={waf.id} region={ctx.region} parentId={waf.policyId} />
                      )}
                    </td>
                  </>
                }
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export interface NetworkTabProps {
  data: ClusterOciData;
  region: string | undefined;
  clusterKey: string;
  search: SearchState;
}

/** 経路軸(外→内)のセクション重ね: WAF → LB/NLB → LBサブネット → ノードサブネット → endpoint。 */
export const NetworkTab = observer(function NetworkTab({ data, region, clusterKey, search }: NetworkTabProps) {
  const { query, setQuery } = search;
  const ctx: SectionContext = { data, region, clusterKey, query };
  // compartment内の全LBではなくクラスタ関連LBのみ表示する(タグ + Service IP + バックエンド連鎖)
  const lbIds = clusterLbIds(
    data,
    ingressIpsOfServices(Renderer.K8sApi.serviceStore.items),
    internalIpsOfNodes(Renderer.K8sApi.nodesStore.items),
  );
  const view = buildNetworkView(data, lbIds);
  return (
    <div>
      <SearchBar query={query} onChange={setQuery} placeholder="Search DNS / WAF / LB / subnet (incl. expanded rows)" />
      <DnsSection ctx={ctx} view={view} />
      <WafSection ctx={ctx} view={view} />
      <LbSection ctx={ctx} lbRows={view.lbRows} />
      <SubnetSection ctx={ctx} title="LB Subnet" rows={view.lbSubnetRows} />
      <SubnetSection
        ctx={ctx}
        title="Node Subnet"
        rows={view.nodeSubnetRows}
        extraNsgIds={view.nodeNsgIds}
        note="If a node pool has an NSG, it is shown below the subnet table."
      />
      <SubnetSection
        ctx={ctx}
        title="Cluster endpoint"
        rows={view.endpointSubnetRow ? [view.endpointSubnetRow] : []}
        extraNsgIds={view.endpointNsgIds}
        note="The subnet containing the K8s API endpoint (for checking kubectl connectivity)."
      />
    </div>
  );
});
