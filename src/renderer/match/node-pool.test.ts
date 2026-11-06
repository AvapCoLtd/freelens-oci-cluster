import { describe, expect, it } from "vitest";
import type { OciResult } from "../oci/result";
import type { OciInstance, OciNodePool, OciNodePoolSummary } from "../oci/types";
import { nodePoolIdOfInstance, nodePoolIdsByInstance, nodePoolNameOfInstance, resolveNodePoolId } from "./node-pool";

const POOL_ID = "ocid1.nodepool.oc1.ap-tokyo-1.aaaaexample";

function instanceWithCreatedBy(createdBy: unknown): OciInstance {
  return {
    id: "ocid1.instance.oc1.ap-tokyo-1.aaaaexample",
    "defined-tags": { "Oracle-Tags": { CreatedBy: createdBy } },
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

const OTHER_POOL_ID = "ocid1.nodepool.oc1.ap-tokyo-1.aaaaother";
const INSTANCE_ID = "ocid1.instance.oc1.ap-tokyo-1.aaaaexample";
const FAILED: OciResult<OciNodePool> = {
  ok: false,
  kind: "forbidden_or_not_found",
  raw: { message: "denied" },
};

function poolDetails(nodes: Record<string, string[]>): Record<string, OciResult<OciNodePool>> {
  return Object.fromEntries(
    Object.entries(nodes).map(([poolId, ids]) => [poolId, { ok: true, data: { nodes: ids.map((id) => ({ id })) } }]),
  );
}

describe("nodePoolIdsByInstance", () => {
  it("プール本体のnodes[]からInstance OCID→プールOCIDを引く", () => {
    const index = nodePoolIdsByInstance(
      poolDetails({ [POOL_ID]: [INSTANCE_ID], [OTHER_POOL_ID]: ["ocid1.instance.x"] }),
    );
    expect(index.get(INSTANCE_ID)).toBe(POOL_ID);
    expect(index.get("ocid1.instance.x")).toBe(OTHER_POOL_ID);
  });

  it("取得失敗・nodes未設定のプールは索引に載せない", () => {
    const index = nodePoolIdsByInstance({ [POOL_ID]: FAILED, [OTHER_POOL_ID]: { ok: true, data: {} } });
    expect(index.size).toBe(0);
  });
});

describe("resolveNodePoolId", () => {
  it("索引が引ければCreatedByタグより優先する", () => {
    const instance = instanceWithCreatedBy(OTHER_POOL_ID);
    expect(resolveNodePoolId(instance, new Map([[INSTANCE_ID, POOL_ID]]))).toBe(POOL_ID);
  });

  it("索引が引けなければCreatedByタグへ落とす", () => {
    expect(resolveNodePoolId(instanceWithCreatedBy(POOL_ID), new Map())).toBe(POOL_ID);
  });

  it("どちらも無ければundefined", () => {
    expect(resolveNodePoolId(instanceWithCreatedBy(undefined), new Map())).toBeUndefined();
  });
});
