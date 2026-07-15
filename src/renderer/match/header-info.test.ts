import { describe, expect, it } from "vitest";
import type { ClusterOciData } from "../oci/fetch";
import type { OciClusterViewState, ResolvedAnchor } from "../store/oci-cluster-store";
import { buildHeaderInfo } from "./header-info";

const NOT_REQUESTED = {
  ok: false as const,
  kind: "not_requested" as const,
  raw: { message: "not requested", stderr: "" },
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
    data: {
      cluster: NOT_REQUESTED,
      instances: NOT_REQUESTED,
      taggedResources: NOT_REQUESTED,
      nlbs: NOT_REQUESTED,
      lbs: NOT_REQUESTED,
      volumes: NOT_REQUESTED,
      fileSystems: {},
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
      cluster: { ok: false, kind: "internal", raw: { message: "boom", stderr: "" } },
    });
    expect(buildHeaderInfo(state, "catalog-name")).toEqual({
      clusterName: "catalog-name",
      clusterOcid: ANCHOR.clusterId,
      region: "ap-tokyo-1",
      fetchedAt: 1_700_000_000_000,
      clusterInfoFailed: true,
    });
  });

  it("falls back to the catalog name (or a placeholder) for non-loaded states", () => {
    expect(buildHeaderInfo({ status: "not_fetched" }, "catalog-name")).toEqual({ clusterName: "catalog-name" });
    expect(buildHeaderInfo({ status: "fetching", stage: "anchor" }, undefined)).toEqual({
      clusterName: "(クラスタ名不明)",
    });
  });
});
