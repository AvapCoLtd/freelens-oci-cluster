import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type * as React from "react";
import { type DnsMatchKind, matchDnsToLbs } from "../match/dns-check";
import { gatewayHealth, isSupportedGatewayId } from "../match/gateway-status";
import { daysUntil } from "../match/lb-certificates";
import {
  buildNetworkView,
  clusterLbIds,
  internalIpsOfNodes,
  type LbRow,
  type NetworkView,
  type SubnetRow,
} from "../match/network-path";
import { nsgRuleRows, routeRows, securityListRuleRows } from "../match/rule-rows";
import { ingressIpsOfServices } from "../match/service-lb";
import { wafDefaultAction, wafPolicyRuleRows } from "../match/waf-policy";
import type { ClusterOciData } from "../sdk/fetch";
import type { OciResult } from "../sdk/result";
import { backendHealthKey, ociClusterStore } from "../store/oci-cluster-store";
import { ConsoleButton } from "./console-button";
import { EmptyState, LOADING_LABEL } from "./empty-state";
import { SectionError } from "./error-guidance";
import { ExpandableRow } from "./expandable-row";
import { Icon } from "./freelens-ui";
import { OcidCopyButton } from "./ocid-copy-button";
import { RouteRuleTable, RuleTable } from "./rule-table";
import { LifecycleBadge, StatusBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE } from "./table-styles";

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
const RESOLUTION_FAILED_LABEL = "Resolution failed";

interface SectionContext {
  data: ClusterOciData;
  region: string | undefined;
  clusterKey: string;
}

/** Record未登載(取得中)/失敗/成功を1блокに畳む共通表示。 */
function ResultBlock<T>({
  result,
  render,
}: {
  result: OciResult<T> | undefined;
  render: (data: T) => React.ReactNode;
}) {
  if (!result) return <div style={PENDING_STYLE}>{LOADING_LABEL}</div>;
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
      label={`Security List: ${result?.ok ? (result.data.displayName ?? slId) : slId}`}
      ocid={slId}
      actions={
        ctx.region &&
        result?.ok &&
        result.data.vcnId && (
          <ConsoleButton type="security-list" ocid={slId} region={ctx.region} parentId={result.data.vcnId} />
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
  if (!result) return <span style={PENDING_STYLE}>{LOADING_LABEL}</span>;
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
      label={`Route Table: ${result?.ok ? (result.data.displayName ?? rtId) : rtId}`}
      ocid={rtId}
      actions={
        ctx.region &&
        result?.ok &&
        result.data.vcnId && (
          <ConsoleButton type="route-table" ocid={rtId} region={ctx.region} parentId={result.data.vcnId} />
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
      label={`NSG: ${result?.ok ? (result.data.nsg.displayName ?? nsgId) : nsgId}`}
      ocid={nsgId}
      actions={
        ctx.region &&
        result?.ok &&
        result.data.nsg.vcnId && (
          <ConsoleButton type="nsg" ocid={nsgId} region={ctx.region} parentId={result.data.nsg.vcnId} />
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
        <div style={{ fontSize: 12, marginBottom: 4 }}>
          listener: {lb.listeners.map((l) => `${l.name}(${l.protocol ?? "-"}:${l.port ?? "-"})`).join(", ")}
        </div>
      )}
      {lb.managedCertificateIds.map((certId) => {
        const result = ctx.data.managedCerts[certId];
        return (
          <div key={certId} style={{ fontSize: 12, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span>
              Certificate {result?.ok ? (result.data.name ?? certId) : certId}: expires{" "}
              {result?.ok && result.data.validTo ? new Date(result.data.validTo).toLocaleDateString() : "-"}
            </span>
            {result?.ok ? (
              <CertificateBadge validTo={result.data.validTo} />
            ) : (
              <span style={PENDING_STYLE}>{result ? FETCH_FAILED_LABEL : LOADING_LABEL}</span>
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

function LbSection({ ctx, lbRows }: { ctx: SectionContext; lbRows: LbRow[] }) {
  const columns = 7;
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>LB / NLB</div>
      {!ctx.data.nlbs.ok && ctx.data.nlbs.kind !== "not_requested" && (
        <SectionError kind={ctx.data.nlbs.kind} raw={ctx.data.nlbs.raw} />
      )}
      {!ctx.data.lbs.ok && ctx.data.lbs.kind !== "not_requested" && (
        <SectionError kind={ctx.data.lbs.kind} raw={ctx.data.lbs.raw} />
      )}
      {lbRows.length === 0 ? (
        <EmptyState message="No LB / NLB" />
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
            {lbRows.map((lb) => (
              <ExpandableRow
                key={lb.id}
                colSpan={columns}
                onExpand={() => {
                  for (const name of lb.backendSetNames) {
                    ociClusterStore.ensureBackendHealth(ctx.clusterKey, lb.kind, lb.id, name);
                  }
                }}
                renderDetail={() => <LbDetail ctx={ctx} lb={lb} />}
                cells={
                  <>
                    <td style={TD_STYLE}>{lb.displayName ?? "-"}</td>
                    <td style={TD_STYLE}>{lb.kind === "nlb" ? "NLB" : "classic"}</td>
                    <td style={TD_STYLE}>{lb.ips.join(", ") || "-"}</td>
                    <td style={TD_STYLE}>{lb.isPrivate === undefined ? "-" : lb.isPrivate ? "private" : "public"}</td>
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

const ROLE_LABEL: Record<string, string> = { lb: "LB", node: "Node", endpoint: "endpoint" };

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
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>{title}</div>
      {note && <div style={SECTION_NOTE_STYLE}>{note}</div>}
      {rows.length === 0 ? (
        <EmptyState message="No target subnets" />
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
            {rows.map((subnet) => (
              <ExpandableRow
                key={subnet.subnetId}
                colSpan={columns}
                renderDetail={() => <SubnetDetail ctx={ctx} subnet={subnet} />}
                cells={
                  <>
                    <td style={TD_STYLE}>{subnet.displayName ?? subnet.subnetId}</td>
                    <td style={TD_STYLE}>{subnet.cidrBlock ?? "-"}</td>
                    <td style={TD_STYLE}>{subnet.roles.map((role) => ROLE_LABEL[role]).join(" / ") || "-"}</td>
                    <td style={TD_STYLE}>
                      {subnet.prohibitPublicIpOnVnic === undefined
                        ? "-"
                        : subnet.prohibitPublicIpOnVnic
                          ? "Prohibited"
                          : "Allowed"}
                    </td>
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
      {(extraNsgIds ?? []).map((nsgId) => (
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
      label={`Policy: ${result?.ok ? result.data.displayName : policyId}`}
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

const DNS_MATCH_BADGE: Record<DnsMatchKind, { label: string; tone: "success" | "error" | "neutral" }> = {
  matched: { label: "Matched", tone: "success" },
  unmatched: { label: "Mismatched", tone: "error" },
  unresolved: { label: "Unresolved", tone: "error" },
};

function DnsSection({ ctx, view }: { ctx: SectionContext; view: NetworkView }) {
  const hosts = Object.keys(ctx.data.dnsChecks).sort();
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>DNS</div>
      <div style={SECTION_NOTE_STYLE}>
        Resolves Ingress / Service (external-dns) hostnames using this machine's resolver and cross-checks them against
        cluster-related LB IPs. In split-DNS environments, results may differ from external resolution.
      </div>
      {hosts.length === 0 ? (
        <EmptyState message="No hostnames to check (no Ingress / external-dns annotations)" />
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
            {hosts.map((host) => {
              const result = ctx.data.dnsChecks[host];
              if (!result?.ok) {
                return (
                  <tr key={host}>
                    <td style={TD_STYLE}>{host}</td>
                    <td style={TD_STYLE} colSpan={2}>
                      {result ? `${RESOLUTION_FAILED_LABEL}: ${result.raw.message}` : LOADING_LABEL}
                    </td>
                    <td style={TD_STYLE}>
                      <StatusBadge label={RESOLUTION_FAILED_LABEL} tone="neutral" />
                    </td>
                  </tr>
                );
              }
              const match = matchDnsToLbs(result.data, view.lbRows);
              const badge = DNS_MATCH_BADGE[match.kind];
              return (
                <tr key={host}>
                  <td style={TD_STYLE}>{host}</td>
                  <td style={TD_STYLE}>{result.data.join(", ") || "-"}</td>
                  <td style={TD_STYLE}>{match.matchedLbNames.join(", ") || "-"}</td>
                  <td style={TD_STYLE}>
                    <StatusBadge label={badge.label} tone={badge.tone} />
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

function WafSection({ ctx, view }: { ctx: SectionContext; view: NetworkView }) {
  const columns = 5;
  return (
    <section>
      <div style={SECTION_TITLE_STYLE}>WAF</div>
      <div style={SECTION_NOTE_STYLE}>
        WAF only applies to classic LB (not NLB). Expand a row to see the policy's rules (block conditions).
      </div>
      {!ctx.data.wafs.ok && ctx.data.wafs.kind !== "not_requested" && (
        <SectionError kind={ctx.data.wafs.kind} raw={ctx.data.wafs.raw} />
      )}
      {view.wafRows.length === 0 ? (
        <EmptyState message="No WAF attached to this cluster's classic LBs" />
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
            {view.wafRows.map((waf) => (
              <ExpandableRow
                key={waf.id}
                colSpan={columns}
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
}

/** 経路軸(外→内)のセクション重ね: WAF → LB/NLB → LBサブネット → ノードサブネット → endpoint。 */
export const NetworkTab = observer(function NetworkTab({ data, region, clusterKey }: NetworkTabProps) {
  const ctx: SectionContext = { data, region, clusterKey };
  // compartment内の全LBではなくクラスタ関連LBのみ表示する(タグ + Service IP + バックエンド連鎖)
  const lbIds = clusterLbIds(
    data,
    ingressIpsOfServices(Renderer.K8sApi.serviceStore.items),
    internalIpsOfNodes(Renderer.K8sApi.nodesStore.items),
  );
  const view = buildNetworkView(data, lbIds);
  return (
    <div>
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
