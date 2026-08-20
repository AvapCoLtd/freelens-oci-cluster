import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type { ClusterOciData } from "../fetch/fetch";
import { filterRows } from "../match/filter-rows";
import { lbKindLabel } from "../match/network-labels";
import { sectionsReady } from "../match/section-ready";
import type { LoadBalancerCandidate, ServiceLbMatchInput } from "../match/service-lb";
import { matchServicesToLoadBalancers } from "../match/service-lb";
import { sortRows } from "../match/sort-rows";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { OcidCopyButton } from "./ocid-copy-button";
import { SearchBar } from "./search-bar";
import { SortableHeaderCell } from "./sortable-header-cell";
import { LoadingBlock } from "./spinner";
import { LifecycleBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE, UNMATCHED_ROW_STYLE } from "./table-styles";
import { useColumnSort } from "./use-column-sort";
import type { SearchState } from "./use-search-query";

interface LbInfo {
  displayName?: string;
  lifecycleState?: string;
  kind: "nlb" | "lb";
}

function buildLbInfo(data: ClusterOciData): Map<string, LbInfo> {
  const info = new Map<string, LbInfo>();
  if (data.nlbs.ok) {
    for (const nlb of data.nlbs.data) {
      info.set(nlb.id, { displayName: nlb["display-name"], lifecycleState: nlb["lifecycle-state"], kind: "nlb" });
    }
  }
  if (data.lbs.ok) {
    for (const lb of data.lbs.data) {
      info.set(lb.id, { displayName: lb["display-name"], lifecycleState: lb["lifecycle-state"], kind: "lb" });
    }
  }
  return info;
}

function buildCandidates(data: ClusterOciData): LoadBalancerCandidate[] {
  const candidates: LoadBalancerCandidate[] = [];
  if (data.nlbs.ok) {
    for (const nlb of data.nlbs.data) {
      const ips = (nlb["ip-addresses"] ?? []).map((ip) => ip["ip-address"]).filter((ip): ip is string => !!ip);
      candidates.push({ ocid: nlb.id, kind: "nlb", ips });
    }
  }
  if (data.lbs.ok) {
    for (const lb of data.lbs.data) {
      const ips = (lb["ip-addresses"] ?? []).map((ip) => ip["ip-address"]).filter((ip): ip is string => !!ip);
      candidates.push({ ocid: lb.id, kind: "lb", ips });
    }
  }
  return candidates;
}

function buildServiceInputs(services: Renderer.K8sApi.Service[]): ServiceLbMatchInput[] {
  return services
    .filter((service) => service.spec.type === "LoadBalancer")
    .map((service) => {
      const spec = service.spec as {
        externalTrafficPolicy?: string;
        healthCheckNodePort?: number;
        ports?: { port: number; nodePort?: number }[];
      };
      const ports = (spec.ports ?? []).map((port) => `${port.port}→${port.nodePort ?? "-"}`).join(", ");
      return {
        namespace: service.getNs() ?? "",
        name: service.getName(),
        ingressIps: (service.status?.loadBalancer?.ingress ?? [])
          .map((ingress) => ingress.ip)
          .filter((ip): ip is string => !!ip),
        externalTrafficPolicy: spec.externalTrafficPolicy,
        portsLabel: spec.healthCheckNodePort ? `${ports} (healthCheck: ${spec.healthCheckNodePort})` : ports,
      };
    });
}

type ServiceLbColumn = "service" | "lbName" | "kind" | "ip" | "trafficPolicy" | "nodePorts" | "lifecycle";

interface ServiceLbRow {
  key: string;
  serviceLabel: string;
  lbInfo: LbInfo | undefined;
  matchedIp: string | undefined;
  trafficPolicy: string | undefined;
  nodePorts: string | undefined;
  ocid: string | undefined;
  consoleType: "nlb" | "lb" | undefined;
}

const SORT_VALUE: Record<ServiceLbColumn, (row: ServiceLbRow) => string | number | undefined> = {
  service: (row) => row.serviceLabel,
  lbName: (row) => row.lbInfo?.displayName,
  kind: (row) => row.lbInfo?.kind,
  ip: (row) => row.matchedIp,
  trafficPolicy: (row) => row.trafficPolicy,
  nodePorts: (row) => row.nodePorts,
  lifecycle: (row) => row.lbInfo?.lifecycleState,
};

function searchValues(row: ServiceLbRow): (string | number | undefined)[] {
  // LB未マッチ行はService名以外を表示しないため、見えない値では絞り込ませない。
  if (!row.ocid || !row.consoleType) return [row.serviceLabel];
  return [
    row.serviceLabel,
    row.lbInfo?.displayName,
    lbKindLabel(row.consoleType),
    row.matchedIp,
    row.trafficPolicy,
    row.nodePorts,
    row.lbInfo?.lifecycleState,
  ];
}

export interface ServiceLbTabProps {
  data: ClusterOciData;
  region: string | undefined;
  search: SearchState;
}

export const ServiceLbTab = observer(function ServiceLbTab({ data, region, search }: ServiceLbTabProps) {
  const serviceStore = Renderer.K8sApi.serviceStore;
  const [sort, toggleSort] = useColumnSort<ServiceLbColumn>("service");
  const { query, setQuery } = search;

  // 行のLB列が後から埋まるとテーブルがガタつくため、依存セクションが確定してから表を出す。
  if (!serviceStore.isLoaded || !sectionsReady(data.nlbs, data.lbs, data.taggedResources)) {
    return <LoadingBlock />;
  }
  const serviceInputs = buildServiceInputs(serviceStore.items);
  if (serviceInputs.length === 0) {
    return <EmptyState message="No Service with type=LoadBalancer" />;
  }

  const matches = matchServicesToLoadBalancers(serviceInputs, buildCandidates(data));
  const lbInfoByOcid = buildLbInfo(data);

  const rows: ServiceLbRow[] = matches.map((match) => {
    const key = `${match.service.namespace}/${match.service.name}`;
    if (!match.loadBalancer) {
      return {
        key,
        serviceLabel: key,
        lbInfo: undefined,
        matchedIp: undefined,
        trafficPolicy: match.service.externalTrafficPolicy,
        nodePorts: match.service.portsLabel,
        ocid: undefined,
        consoleType: undefined,
      };
    }
    const info = lbInfoByOcid.get(match.loadBalancer.ocid);
    const matchedIp = match.loadBalancer.ips.find((ip) => match.service.ingressIps.includes(ip));
    return {
      key,
      serviceLabel: key,
      lbInfo: info,
      matchedIp,
      trafficPolicy: match.service.externalTrafficPolicy,
      nodePorts: match.service.portsLabel,
      ocid: match.loadBalancer.ocid,
      consoleType: match.loadBalancer.kind,
    };
  });
  const sortedRows = sortRows(filterRows(rows, query, searchValues), SORT_VALUE[sort.column], sort.direction);

  return (
    <div>
      {!data.nlbs.ok && <SectionError kind={data.nlbs.kind} raw={data.nlbs.raw} />}
      {!data.lbs.ok && <SectionError kind={data.lbs.kind} raw={data.lbs.raw} />}
      <SearchBar query={query} onChange={setQuery} placeholder="Search services" />
      {sortedRows.length === 0 && <EmptyState message={`No services match "${query}"`} />}
      {sortedRows.length > 0 && (
        <table style={TABLE_STYLE}>
          <thead>
            <tr>
              <SortableHeaderCell column="service" sort={sort} onSort={toggleSort}>
                Service
              </SortableHeaderCell>
              <SortableHeaderCell column="lbName" sort={sort} onSort={toggleSort}>
                LB Name
              </SortableHeaderCell>
              <SortableHeaderCell column="kind" sort={sort} onSort={toggleSort}>
                Kind
              </SortableHeaderCell>
              <SortableHeaderCell column="ip" sort={sort} onSort={toggleSort}>
                IP
              </SortableHeaderCell>
              <SortableHeaderCell column="trafficPolicy" sort={sort} onSort={toggleSort}>
                extTrafficPolicy
              </SortableHeaderCell>
              <SortableHeaderCell column="nodePorts" sort={sort} onSort={toggleSort}>
                port→NodePort
              </SortableHeaderCell>
              <SortableHeaderCell column="lifecycle" sort={sort} onSort={toggleSort}>
                lifecycle-state
              </SortableHeaderCell>
              <th style={TH_STYLE}>OCID</th>
              <th style={TH_STYLE} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              if (!row.ocid || !row.consoleType) {
                return (
                  <tr key={row.key} style={UNMATCHED_ROW_STYLE}>
                    <td style={TD_STYLE}>{row.serviceLabel}</td>
                    <td style={TD_STYLE} colSpan={7}>
                      Unsupported (no matching LB found)
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={row.key}>
                  <td style={TD_STYLE}>{row.serviceLabel}</td>
                  <td style={TD_STYLE}>{row.lbInfo?.displayName ?? "-"}</td>
                  <td style={TD_STYLE}>{lbKindLabel(row.consoleType)}</td>
                  <td style={TD_STYLE}>{row.matchedIp ?? "-"}</td>
                  <td style={TD_STYLE}>{row.trafficPolicy ?? "-"}</td>
                  <td style={TD_STYLE}>{row.nodePorts || "-"}</td>
                  <td style={TD_STYLE}>
                    <LifecycleBadge state={row.lbInfo?.lifecycleState} />
                  </td>
                  <td style={TD_STYLE}>
                    <OcidCopyButton ocid={row.ocid} />
                  </td>
                  <td style={TD_STYLE}>
                    {region && <ConsoleButton type={row.consoleType} ocid={row.ocid} region={region} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
});
