import { describe, expect, it } from "vitest";
import type { ClusterOciData } from "../fetch/fetch";
import type { OciClusterViewState, ResolvedAnchor } from "../store/oci-cluster-store";
import { buildHeaderInfo } from "./header-info";

const NOT_REQUESTED = {
  ok: false as const,
  kind: "not_requested" as const,
  raw: { message: "not requested" },
};

const ANCHOR: ResolvedAnchor = {
  instanceId: "ocid1.instance.oc1.ap-tokyo-1.aaaaexample",
  clusterId: "ocid1.cluster.oc1.ap-tokyo-1.aaaaexample",
  compartmentId: "ocid1.compartment.oc1..aaaaexample",
};

function loadedState(data: Partial<ClusterOciData>): OciClusterViewState {
  return {
    status: "loaded",
    anchor: ANCHOR,
    fetchedAt: 1_700_000_000_000,
    settled: true,
    data: {
      cluster: NOT_REQUESTED,
      instances: NOT_REQUESTED,
      taggedResources: NOT_REQUESTED,
      nlbs: NOT_REQUESTED,
      lbs: NOT_REQUESTED,
      volumes: NOT_REQUESTED,
      nodePools: NOT_REQUESTED,
      wafs: NOT_REQUESTED,
      fileSystems: {},
      fssExports: {},
      vcns: {},
      subnets: {},
      securityLists: {},
      routeTables: {},
      nsgs: {},
      wafPolicies: {},
      gateways: {},
      dnsChecks: {},
      managedCerts: {},
      volumeBackupPolicies: {},
      fssSnapshotPolicies: {},
      backendHealths: {},
      ...data,
    },
  };
}

describe("buildHeaderInfo", () => {
  it("builds header info from a loaded cluster", () => {
    const state = loadedState({
      cluster: {
        ok: true,
        data: {
          id: ANCHOR.clusterId,
          name: "my-cluster",
          "kubernetes-version": "v1.29.1",
          "lifecycle-state": "ACTIVE",
        },
      },
    });
    expect(buildHeaderInfo(state, "catalog-name")).toEqual({
      clusterName: "my-cluster",
      lifecycleState: "ACTIVE",
      kubernetesVersion: "v1.29.1",
      clusterOcid: ANCHOR.clusterId,
      region: "ap-tokyo-1",
      fetchedAt: 1_700_000_000_000,
    });
  });

  it("degrades to the catalog name and marks clusterInfoFailed when cluster fetch failed", () => {
    const state = loadedState({
      cluster: { ok: false, kind: "internal", raw: { message: "boom" } },
    });
    expect(buildHeaderInfo(state, "catalog-name")).toEqual({
      clusterName: "catalog-name",
      clusterOcid: ANCHOR.clusterId,
      region: "ap-tokyo-1",
      fetchedAt: 1_700_000_000_000,
      clusterInfoFailed: true,
    });
  });

  it("does not mark clusterInfoFailed while the cluster section is still loading", () => {
    const state = loadedState({
      cluster: { ok: false, kind: "loading", raw: { message: "loading" } },
    });
    expect(buildHeaderInfo(state, "catalog-name").clusterInfoFailed).toBe(false);
  });

  it("falls back to the catalog name (or a placeholder) for non-loaded states", () => {
    expect(buildHeaderInfo({ status: "not_fetched" }, "catalog-name")).toEqual({ clusterName: "catalog-name" });
    expect(buildHeaderInfo({ status: "fetching" }, undefined)).toEqual({
      clusterName: "(cluster name unknown)",
    });
  });
});
