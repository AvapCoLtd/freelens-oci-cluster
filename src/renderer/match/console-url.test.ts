import { describe, expect, it } from "vitest";
import { buildConsoleUrl, type OciConsoleResourceType } from "./console-url";

describe("buildConsoleUrl", () => {
  it("builds a cluster console URL with the region query parameter (実機確認済み)", () => {
    expect(buildConsoleUrl("cluster", "ocid1.cluster.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/containers/clusters/ocid1.cluster.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds a volume console URL with the region query parameter (実機確認済み)", () => {
    expect(buildConsoleUrl("volume", "ocid1.volume.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/block-storage/volumes/ocid1.volume.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds an instance console URL with the region query parameter (実機確認済み)", () => {
    expect(buildConsoleUrl("instance", "ocid1.instance.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/compute/instances/ocid1.instance.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds a filesystem console URL without the exports segment (基本形で開けることを実機確認済み)", () => {
    expect(buildConsoleUrl("filesystem", "ocid1.filesystem.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/fss/file-systems/ocid1.filesystem.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds an NLB console URL with the region query parameter (実機確認済み)", () => {
    expect(buildConsoleUrl("nlb", "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/networking/load-balancers/network-load-balancer/ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds a classic LB console URL with the region query parameter (実機確認済み)", () => {
    expect(buildConsoleUrl("lb", "ocid1.loadbalancer.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/load-balancer/load-balancers/ocid1.loadbalancer.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds a URL for every resource type rooted at the console base URL with the region present", () => {
    const types: OciConsoleResourceType[] = ["cluster", "instance", "nlb", "lb", "volume", "filesystem"];
    for (const type of types) {
      const url = buildConsoleUrl(type, "ocid1.x.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1");
      expect(url.startsWith("https://cloud.oracle.com/")).toBe(true);
      expect(url.includes("region=ap-tokyo-1")).toBe(true);
    }
  });
});
