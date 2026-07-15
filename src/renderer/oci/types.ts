import type { CliErrorKind, CliRawErrorInfo } from "../match/classify-cli-error";

export type CliResult<T> = { ok: true; data: T } | { ok: false; kind: CliErrorKind; raw: CliRawErrorInfo };

// oci CLI(--output json)のJSONはkebab-caseフィールド。実機のoci CLI出力での検証は次工程(実機検証)で行う。
export interface OciDefinedTags {
  [namespace: string]: Record<string, string> | undefined;
}

export interface OciClusterSummary {
  id: string;
  name?: string;
  "kubernetes-version"?: string;
  "lifecycle-state"?: string;
  "compartment-id"?: string;
}

export interface OciNodePoolSummary {
  id: string;
  "cluster-id"?: string;
  "compartment-id"?: string;
}

export interface OciInstanceSummary {
  id: string;
  "display-name"?: string;
  shape?: string;
  "availability-domain"?: string;
  "fault-domain"?: string;
  "lifecycle-state"?: string;
  "compartment-id"?: string;
  "defined-tags"?: OciDefinedTags;
}

export interface OciSearchResourceSummary {
  identifier: string;
  "display-name"?: string;
  "resource-type"?: string;
  "compartment-id"?: string;
  "lifecycle-state"?: string;
}

export interface OciIpAddress {
  "ip-address"?: string;
  "is-public"?: boolean;
}

export interface OciNetworkLoadBalancerSummary {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "compartment-id"?: string;
  "ip-addresses"?: OciIpAddress[];
}

export interface OciLoadBalancerSummary {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "compartment-id"?: string;
  "ip-addresses"?: OciIpAddress[];
}

export interface OciVolumeSummary {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "compartment-id"?: string;
  "size-in-gbs"?: number;
}

export interface OciFileSystemSummary {
  id: string;
  "display-name"?: string;
  "lifecycle-state"?: string;
  "compartment-id"?: string;
}
