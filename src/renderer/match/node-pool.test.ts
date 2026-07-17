import { describe, expect, it } from "vitest";
import type { OciInstance, OciNodePoolSummary } from "../sdk/types";
import { nodePoolIdOfInstance, nodePoolNameOfInstance } from "./node-pool";

const POOL_ID = "ocid1.nodepool.oc1.ap-tokyo-1.aaaaexample";

function instanceWithCreatedBy(createdBy: unknown): OciInstance {
  return {
    id: "ocid1.instance.oc1.ap-tokyo-1.aaaaexample",
    definedTags: { "Oracle-Tags": { CreatedBy: createdBy } },
  } as unknown as OciInstance;
}

const POOLS = [{ id: POOL_ID, name: "amd64-general" }] as OciNodePoolSummary[];

describe("nodePoolIdOfInstance", () => {
  it("CreatedByがnodepool OCIDならそれを返す", () => {
    expect(nodePoolIdOfInstance(instanceWithCreatedBy(POOL_ID))).toBe(POOL_ID);
  });

  it("CreatedByがユーザー等(virtual node / self-managed)ならundefined", () => {
    expect(nodePoolIdOfInstance(instanceWithCreatedBy("default/user@example.com"))).toBeUndefined();
    expect(nodePoolIdOfInstance(instanceWithCreatedBy(undefined))).toBeUndefined();
  });

  it("instance自体が未解決ならundefined", () => {
    expect(nodePoolIdOfInstance(undefined)).toBeUndefined();
  });
});

describe("nodePoolNameOfInstance", () => {
  it("プール一覧から名前を引く", () => {
    expect(nodePoolNameOfInstance(POOLS, instanceWithCreatedBy(POOL_ID))).toBe("amd64-general");
  });

  it("一覧に該当プールがなければundefined(削除済みプールの残骸ノード)", () => {
    expect(nodePoolNameOfInstance([], instanceWithCreatedBy(POOL_ID))).toBeUndefined();
  });
});
