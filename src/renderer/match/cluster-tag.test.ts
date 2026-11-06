import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OciInstance, OciLoadBalancer, OciTagged } from "../oci/types";
import { clusterTagMismatchesOf, clusterTagMismatchText } from "./cluster-tag";

const STDOUT_DIR = join(import.meta.dirname, "..", "cli", "__fixtures__", "stdout");

const CURRENT = "ocid1.cluster.oc1.ap-tokyo-1.aaaaexample0001";
const OTHER = "ocid1.cluster.oc1.ap-tokyo-1.aaaaexample0002";
const ANOTHER = "ocid1.cluster.oc1.ap-tokyo-1.aaaaexample0003";
const NODE_POOL = "ocid1.nodepool.oc1.ap-tokyo-1.aaaaexample0009";

function tagged(systemCluster: string | undefined, createdBy: string | undefined): OciTagged {
  return {
    "system-tags": systemCluster ? { "orcl-containerengine": { Cluster: systemCluster } } : {},
    "defined-tags": createdBy ? { "Oracle-Tags": { CreatedBy: createdBy, CreatedOn: "2026-01-01T00:00:00Z" } } : {},
  };
}

function stdoutData<T>(file: string): T {
  return (JSON.parse(readFileSync(join(STDOUT_DIR, file), "utf8")) as { data: T }).data;
}

describe("clusterTagMismatchesOf", () => {
  it("system tagだけが別クラスタを指せば、管理下の食い違いだけを返す", () => {
    expect(clusterTagMismatchesOf(tagged(OTHER, CURRENT), CURRENT)).toEqual([
      { source: "system-tag", clusterId: OTHER },
    ]);
  });

  it("CreatedByだけが別クラスタを指せば、作成元の食い違いだけを返す(管理が現クラスタへ移ったFSS)", () => {
    expect(clusterTagMismatchesOf(tagged(CURRENT, OTHER), CURRENT)).toEqual([
      { source: "created-by", clusterId: OTHER },
    ]);
  });

  it("両方が別クラスタを指せば出所ごとに1件ずつ返す(指す先が違っても書き分ける)", () => {
    expect(clusterTagMismatchesOf(tagged(OTHER, ANOTHER), CURRENT)).toEqual([
      { source: "system-tag", clusterId: OTHER },
      { source: "created-by", clusterId: ANOTHER },
    ]);
  });

  it("両方が現クラスタを指せば何も返さない", () => {
    expect(clusterTagMismatchesOf(tagged(CURRENT, CURRENT), CURRENT)).toEqual([]);
  });

  it("クラスタ系タグが無ければ何も返さない(手動作成のFSS・classic LB)", () => {
    expect(clusterTagMismatchesOf(tagged(undefined, undefined), CURRENT)).toEqual([]);
    expect(clusterTagMismatchesOf({}, CURRENT)).toEqual([]);
  });

  it("CreatedByが人名ならクラスタとして比較しない", () => {
    expect(clusterTagMismatchesOf(tagged(undefined, "default/someone@example.com"), CURRENT)).toEqual([]);
  });

  it("CreatedByがノードプールOCIDならクラスタとして比較しない", () => {
    expect(clusterTagMismatchesOf(tagged(undefined, NODE_POOL), CURRENT)).toEqual([]);
  });

  it("Instanceはsystem tagだけを見る(CreatedByはノードプールを指す)", () => {
    const instance = tagged(OTHER, NODE_POOL);
    expect(clusterTagMismatchesOf(instance, CURRENT, ["system-tag"])).toEqual([
      { source: "system-tag", clusterId: OTHER },
    ]);
    expect(clusterTagMismatchesOf(tagged(CURRENT, OTHER), CURRENT, ["system-tag"])).toEqual([]);
  });

  it("現クラスタが未確定・リソースが未取得なら何も返さない", () => {
    expect(clusterTagMismatchesOf(tagged(OTHER, OTHER), undefined)).toEqual([]);
    expect(clusterTagMismatchesOf(undefined, CURRENT)).toEqual([]);
  });

  it("タグ値が文字列でなければ読まない", () => {
    const resource = {
      "system-tags": { "orcl-containerengine": { Cluster: 1 } },
      "defined-tags": { "Oracle-Tags": { CreatedBy: null } },
    } as unknown as OciTagged;
    expect(clusterTagMismatchesOf(resource, CURRENT)).toEqual([]);
  });

  it("実機採取のLB一覧: 別クラスタのLBは両方の出所で食い違う", () => {
    const lbs = stdoutData<OciLoadBalancer[]>("06-lb-load-balancer-list.json");
    expect(lbs.map((lb) => clusterTagMismatchesOf(lb, CURRENT))).toEqual([
      [
        { source: "system-tag", clusterId: OTHER },
        { source: "created-by", clusterId: OTHER },
      ],
      [
        { source: "system-tag", clusterId: ANOTHER },
        { source: "created-by", clusterId: ANOTHER },
      ],
    ]);
  });

  it("実機採取のInstance一覧: 現クラスタのノードは食い違わない", () => {
    const instances = stdoutData<OciInstance[]>("03-compute-instance-list.json");
    expect(instances.flatMap((instance) => clusterTagMismatchesOf(instance, CURRENT, ["system-tag"]))).toEqual([]);
  });
});

describe("clusterTagMismatchText", () => {
  it("出所の意味とクラスタOCIDを1行にする", () => {
    expect(clusterTagMismatchText({ source: "system-tag", clusterId: OTHER })).toBe(
      `Managed by another cluster (system tag): ${OTHER}`,
    );
    expect(clusterTagMismatchText({ source: "created-by", clusterId: OTHER })).toBe(
      `Created by another cluster (CreatedBy tag): ${OTHER}`,
    );
  });
});
