import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type { LoadBalancerCandidate, ServiceLbMatchInput } from "../match/service-lb";
import { matchServicesToLoadBalancers } from "../match/service-lb";
import { sortRows } from "../match/sort-rows";
import type { ClusterOciData } from "../oci/fetch";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { OcidCopyButton } from "./ocid-copy-button";
import { SortableHeaderCell } from "./sortable-header-cell";
import { LifecycleBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE, UNMATCHED_ROW_STYLE } from "./table-styles";
import { useColumnSort } from "./use-column-sort";

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
    .map((service) => ({
      namespace: service.getNs() ?? "",
      name: service.getName(),
      ingressIps: (service.status?.loadBalancer?.ingress ?? [])
        .map((ingress) => ingress.ip)
        .filter((ip): ip is string => !!ip),
    }));
}

type ServiceLbColumn = "service" | "lbName" | "kind" | "ip" | "lifecycle";

interface ServiceLbRow {
  key: string;
  serviceLabel: string;
  lbInfo: LbInfo | undefined;
  matchedIp: string | undefined;
  ocid: string | undefined;
  consoleType: "nlb" | "lb" | undefined;
}

const SORT_VALUE: Record<ServiceLbColumn, (row: ServiceLbRow) => string | number | undefined> = {
  service: (row) => row.serviceLabel,
  lbName: (row) => row.lbInfo?.displayName,
  kind: (row) => row.lbInfo?.kind,
  ip: (row) => row.matchedIp,
  lifecycle: (row) => row.lbInfo?.lifecycleState,
};

export interface ServiceLbTabProps {
  data: ClusterOciData;
  region: string | undefined;
}

export const ServiceLbTab = observer(function ServiceLbTab({ data, region }: ServiceLbTabProps) {
  const serviceStore = Renderer.K8sApi.serviceStore;
  const [sort, toggleSort] = useColumnSort<ServiceLbColumn>("service");

  if (!serviceStore.isLoaded) {
    return <EmptyState message="読み込み中..." />;
  }
  const serviceInputs = buildServiceInputs(serviceStore.items);
  if (serviceInputs.length === 0) {
    return <EmptyState message="type=LoadBalancer の Service がありません" />;
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
      ocid: match.loadBalancer.ocid,
      consoleType: match.loadBalancer.kind,
    };
  });
  const sortedRows = sortRows(rows, SORT_VALUE[sort.column], sort.direction);

  return (
    <div>
      {!data.nlbs.ok && <SectionError kind={data.nlbs.kind} raw={data.nlbs.raw} />}
      {!data.lbs.ok && <SectionError kind={data.lbs.kind} raw={data.lbs.raw} />}
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <SortableHeaderCell column="service" sort={sort} onSort={toggleSort}>
              Service
            </SortableHeaderCell>
            <SortableHeaderCell column="lbName" sort={sort} onSort={toggleSort}>
              LB名
            </SortableHeaderCell>
            <SortableHeaderCell column="kind" sort={sort} onSort={toggleSort}>
              種別
            </SortableHeaderCell>
            <SortableHeaderCell column="ip" sort={sort} onSort={toggleSort}>
              IP
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
                  <td style={TD_STYLE} colSpan={5}>
                    未対応(対応する LB が見つかりません)
                  </td>
                </tr>
              );
            }
            return (
              <tr key={row.key}>
                <td style={TD_STYLE}>{row.serviceLabel}</td>
                <td style={TD_STYLE}>{row.lbInfo?.displayName ?? "-"}</td>
                <td style={TD_STYLE}>{row.consoleType === "nlb" ? "NLB" : "classic"}</td>
                <td style={TD_STYLE}>{row.matchedIp ?? "-"}</td>
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
    </div>
  );
});
