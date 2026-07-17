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

  const VCN = "ocid1.vcn.oc1.ap-tokyo-1.vvvv";

  it("builds subnet/route-table URLs nested under the VCN (実機確認済み 2026-07-17)", () => {
    expect(buildConsoleUrl("subnet", "ocid1.subnet.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1", VCN)).toBe(
      `https://cloud.oracle.com/networking/vcns/${VCN}/subnets/ocid1.subnet.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1`,
    );
    expect(buildConsoleUrl("route-table", "ocid1.routetable.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1", VCN)).toBe(
      `https://cloud.oracle.com/networking/vcns/${VCN}/route-tables/ocid1.routetable.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1`,
    );
  });

  it("builds a security list URL with the /details suffix (実機確認済み 2026-07-17)", () => {
    expect(buildConsoleUrl("security-list", "ocid1.securitylist.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1", VCN)).toBe(
      `https://cloud.oracle.com/networking/vcns/${VCN}/security-lists/ocid1.securitylist.oc1.ap-tokyo-1.aaaa/details?region=ap-tokyo-1`,
    );
  });

  it("builds an NSG URL nested under the VCN (未確認・実機遷移確認の対象)", () => {
    expect(buildConsoleUrl("nsg", "ocid1.networksecuritygroup.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1", VCN)).toBe(
      `https://cloud.oracle.com/networking/vcns/${VCN}/network-security-groups/ocid1.networksecuritygroup.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1`,
    );
  });

  it("builds an FSS snapshot policy URL (実機確認済み 2026-07-17)", () => {
    expect(
      buildConsoleUrl("fss-snapshot-policy", "ocid1.filesystemsnapshotpolicy.oc1.ap_tokyo_1.aaaa", "ap-tokyo-1"),
    ).toBe(
      "https://cloud.oracle.com/fss/snapshot-policies/ocid1.filesystemsnapshotpolicy.oc1.ap_tokyo_1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds an FSS snapshot policy URL (実機確認済み 2026-07-17)", () => {
    expect(
      buildConsoleUrl("fss-snapshot-policy", "ocid1.filesystemsnapshotpolicy.oc1.ap_tokyo_1.aaaa", "ap-tokyo-1"),
    ).toBe(
      "https://cloud.oracle.com/fss/snapshot-policies/ocid1.filesystemsnapshotpolicy.oc1.ap_tokyo_1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds a WAF policy URL (WAF本体URLの親ページ形・単体遷移は未確認)", () => {
    expect(buildConsoleUrl("waf-policy", "ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.pppp", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/waf/policies/ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.pppp?region=ap-tokyo-1",
    );
  });

  it("builds a WAF URL nested under its policy (実機確認済み 2026-07-17)", () => {
    const policy = "ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.pppp";
    expect(buildConsoleUrl("waf", "ocid1.webappfirewall.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1", policy)).toBe(
      `https://cloud.oracle.com/waf/policies/${policy}/firewalls/ocid1.webappfirewall.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1`,
    );
  });

  it("falls back to a flat path when vcnId is missing (呼び出し元契約違反時の防御)", () => {
    expect(buildConsoleUrl("subnet", "ocid1.subnet.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1")).toBe(
      "https://cloud.oracle.com/networking/subnets/ocid1.subnet.oc1.ap-tokyo-1.aaaa?region=ap-tokyo-1",
    );
  });

  it("builds a URL for every resource type rooted at the console base URL with the region present", () => {
    const types: OciConsoleResourceType[] = [
      "cluster",
      "instance",
      "nlb",
      "lb",
      "volume",
      "filesystem",
      "subnet",
      "security-list",
      "nsg",
      "route-table",
      "waf",
    ];
    for (const type of types) {
      const url = buildConsoleUrl(type, "ocid1.x.oc1.ap-tokyo-1.aaaa", "ap-tokyo-1", VCN);
      expect(url.startsWith("https://cloud.oracle.com/")).toBe(true);
      expect(url.includes("region=ap-tokyo-1")).toBe(true);
    }
  });
});
