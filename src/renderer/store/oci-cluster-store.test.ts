import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resolveAnchor } from "../fetch/anchor";
import * as fetchModule from "../fetch/fetch";
import { fetchCluster, fetchInstances } from "../fetch/fetch";
import { OciClusterStore } from "./oci-cluster-store";

// @freelensapp/extensionsの実体はFreeLens本体のrendererバンドルで、node環境のimportで例外を出す。
const k8s = vi.hoisted(() => ({
  nodesStore: {
    loadAll: () => Promise.resolve(),
    items: [{ spec: { providerID: "oci://ocid1.instance.oc1..aaaa1" } }],
  },
  persistentVolumeStore: { loadAll: () => Promise.resolve(), items: [] as unknown[] },
  serviceStore: { loadAll: () => Promise.resolve(), items: [] as unknown[] },
  ingressStore: { loadAll: () => Promise.resolve(), items: [] as unknown[] },
  namespaceStore: { loadAll: () => Promise.resolve(), items: [] as { getName(): string }[] },
}));

vi.mock("@freelensapp/extensions", () => ({ Renderer: { K8sApi: k8s } }));
vi.mock("../fetch/anchor", () => ({ resolveAnchor: vi.fn() }));
// fetch*を1つでも実物のまま残すとociプロセスを起動しうるため、全件をモックに置き換える。
vi.mock("../fetch/fetch", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, value]) => [
      name,
      name.startsWith("fetch") && typeof value === "function" ? vi.fn() : value,
    ]),
  );
});

const CLUSTER_KEY = "cluster-1";
const ANCHOR = {
  kind: "resolved",
  instanceId: "ocid1.instance.oc1..aaaa1",
  clusterId: "ocid1.cluster.oc1..aaaa1",
  compartmentId: "ocid1.compartment.oc1..aaaa1",
};

const resolveAnchorMock = resolveAnchor as unknown as Mock;
const fetchInstancesMock = fetchInstances as unknown as Mock;
const fetchClusterMock = fetchCluster as unknown as Mock;

/** 保留中のfetchを1件ずつ解決するためのキュー。 */
function pendingQueue(mock: Mock): ((result: unknown) => void)[] {
  const resolvers: ((result: unknown) => void)[] = [];
  mock.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  return resolvers;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await flush();
}

beforeEach(() => {
  for (const value of Object.values(fetchModule)) {
    if (vi.isMockFunction(value)) value.mockReset().mockResolvedValue({ ok: true, data: [] });
  }
  resolveAnchorMock.mockReset().mockResolvedValue(ANCHOR);
  k8s.persistentVolumeStore.loadAll = () => Promise.resolve();
});

describe("OciClusterStore 取得世代", () => {
  it("refresh前に始まったセクション取得の結果は書き戻さず、新しい取得の結果を採用する", async () => {
    const store = new OciClusterStore();
    const instances = pendingQueue(fetchInstancesMock);

    store.ensureLoaded(CLUSTER_KEY, "nodes");
    await settle();
    expect(fetchInstancesMock).toHaveBeenCalledTimes(1);

    store.refresh(CLUSTER_KEY, "nodes");
    await settle();
    // 世代が変わるので進行中Promiseへの相乗りは起きず、取得がやり直される
    expect(fetchInstancesMock).toHaveBeenCalledTimes(2);

    instances[0]?.({ ok: true, data: [{ id: "old" }] });
    await settle();
    expect(store.getState(CLUSTER_KEY, "nodes").status).toBe("fetching");

    instances[1]?.({ ok: true, data: [{ id: "new" }] });
    await settle();
    const state = store.getState(CLUSTER_KEY, "nodes");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.instances).toEqual({ ok: true, data: [{ id: "new" }] });
  });

  it("refresh前に始まったnetwork reconcileはnetworkReconciledを書き戻さない", async () => {
    const store = new OciClusterStore();
    const clusters = pendingQueue(fetchClusterMock);

    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();
    store.refresh(CLUSTER_KEY, "network");
    await settle();
    expect(fetchClusterMock).toHaveBeenCalledTimes(2);

    clusters[0]?.({ ok: true, data: {} });
    await settle();
    expect(store.getState(CLUSTER_KEY, "network").status).toBe("fetching");

    clusters[1]?.({ ok: true, data: {} });
    await settle();
    expect(store.getState(CLUSTER_KEY, "network").status).toBe("loaded");
  });

  it("refresh前に始まったfileSystems reconcileはfileSystemsReconciledを書き戻さない", async () => {
    const store = new OciClusterStore();
    const pvLoads: (() => void)[] = [];
    k8s.persistentVolumeStore.loadAll = () => new Promise<void>((resolve) => pvLoads.push(() => resolve()));

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();
    store.refresh(CLUSTER_KEY, "pv-storage");
    await settle();
    expect(pvLoads).toHaveLength(2);

    pvLoads[0]?.();
    await settle();
    expect(store.getState(CLUSTER_KEY, "pv-storage").status).toBe("fetching");

    pvLoads[1]?.();
    await settle();
    expect(store.getState(CLUSTER_KEY, "pv-storage").status).toBe("loaded");
  });
});
