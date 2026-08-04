import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resolveAnchor } from "../fetch/anchor";
import * as fetchModule from "../fetch/fetch";
import {
  fetchCluster,
  fetchInstances,
  fetchNsgWithRules,
  fetchSubnet,
  fetchVcnNsgs,
  fetchVcnSubnets,
} from "../fetch/fetch";
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

const VCN_ID = "ocid1.vcn.oc1..aaaa1";
const ENDPOINT_SUBNET_ID = "ocid1.subnet.oc1..endpoint";
const NSG_ID = "ocid1.networksecuritygroup.oc1..aaaa1";

const resolveAnchorMock = resolveAnchor as unknown as Mock;
const fetchInstancesMock = fetchInstances as unknown as Mock;
const fetchClusterMock = fetchCluster as unknown as Mock;
const fetchSubnetMock = fetchSubnet as unknown as Mock;
const fetchVcnSubnetsMock = fetchVcnSubnets as unknown as Mock;
const fetchVcnNsgsMock = fetchVcnNsgs as unknown as Mock;
const fetchNsgWithRulesMock = fetchNsgWithRules as unknown as Mock;

/** 保留中のfetchを1件ずつ解決するためのキュー。 */
function pendingQueue(mock: Mock): ((result: unknown) => void)[] {
  const resolvers: ((result: unknown) => void)[] = [];
  mock.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  return resolvers;
}

/** ページの全セクションが確定したか(段階表示のため status は anchor 解決時点で loaded になる)。 */
function settled(store: OciClusterStore, page: Parameters<OciClusterStore["getState"]>[1]): boolean {
  const state = store.getState(CLUSTER_KEY, page);
  return state.status === "loaded" && state.settled;
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
    expect(settled(store, "nodes")).toBe(false);

    instances[1]?.({ ok: true, data: [{ id: "new" }] });
    await settle();
    const state = store.getState(CLUSTER_KEY, "nodes");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.settled).toBe(true);
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
    expect(settled(store, "network")).toBe(false);

    clusters[1]?.({ ok: true, data: {} });
    await settle();
    expect(settled(store, "network")).toBe(true);
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
    expect(settled(store, "pv-storage")).toBe(false);

    pvLoads[1]?.();
    await settle();
    expect(settled(store, "pv-storage")).toBe(true);
  });
});

describe("networkページの型別list", () => {
  /** endpoint subnetとNSGを1件ずつ持つクラスタ。 */
  function setUpCluster(): void {
    fetchClusterMock.mockResolvedValue({
      ok: true,
      data: {
        id: ANCHOR.clusterId,
        "vcn-id": VCN_ID,
        "endpoint-config": { "subnet-id": ENDPOINT_SUBNET_ID, "nsg-ids": [NSG_ID] },
      },
    });
  }

  it("listで埋まったsubnetはper-OCID getを叩かない", async () => {
    setUpCluster();
    fetchVcnSubnetsMock.mockResolvedValue({
      ok: true,
      data: [{ id: ENDPOINT_SUBNET_ID, "display-name": "endpoint", "security-list-ids": [] }],
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();

    expect(fetchSubnetMock).not.toHaveBeenCalled();
    const state = store.getState(CLUSTER_KEY, "network");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.settled).toBe(true);
    expect(state.data.subnets[ENDPOINT_SUBNET_ID]).toEqual({
      ok: true,
      data: { id: ENDPOINT_SUBNET_ID, "display-name": "endpoint", "security-list-ids": [] },
    });
  });

  it("listに現れなかったsubnetはper-OCID getへフォールバックする", async () => {
    setUpCluster();
    fetchVcnSubnetsMock.mockResolvedValue({ ok: true, data: [] });
    fetchSubnetMock.mockResolvedValue({ ok: true, data: { id: ENDPOINT_SUBNET_ID } });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();

    expect(fetchSubnetMock).toHaveBeenCalledWith(ENDPOINT_SUBNET_ID, "");
  });

  it("NSG本体はlistの結果を渡し、rules listだけを叩かせる", async () => {
    setUpCluster();
    const nsg = { id: NSG_ID, "display-name": "nsg-1", "vcn-id": VCN_ID };
    fetchVcnNsgsMock.mockResolvedValue({ ok: true, data: [nsg] });
    fetchNsgWithRulesMock.mockResolvedValue({ ok: true, data: { nsg, rules: [] } });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();

    expect(fetchNsgWithRulesMock).toHaveBeenCalledWith(NSG_ID, "", nsg);
  });
});

describe("セクション単位の段階表示", () => {
  it("取得中セクションはkind=loading、他ページ専用セクションはnot_requestedで返る", async () => {
    const store = new OciClusterStore();
    pendingQueue(fetchInstancesMock);

    store.ensureLoaded(CLUSTER_KEY, "nodes");
    await settle();

    const state = store.getState(CLUSTER_KEY, "nodes");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.settled).toBe(false);
    expect(state.data.instances).toMatchObject({ ok: false, kind: "loading" });
    expect(state.data.volumes).toMatchObject({ ok: false, kind: "not_requested" });
  });

  it("アンカー解決前はloadedにならない", async () => {
    const store = new OciClusterStore();
    resolveAnchorMock.mockImplementation(() => new Promise(() => undefined));

    store.ensureLoaded(CLUSTER_KEY, "nodes");
    await settle();

    expect(store.getState(CLUSTER_KEY, "nodes").status).toBe("fetching");
  });
});

describe("一覧セクションの確定", () => {
  function setUpNetworkCluster(): void {
    fetchClusterMock.mockResolvedValue({
      ok: true,
      data: {
        id: ANCHOR.clusterId,
        "vcn-id": VCN_ID,
        "endpoint-config": { "subnet-id": ENDPOINT_SUBNET_ID, "nsg-ids": [NSG_ID] },
      },
    });
    fetchVcnSubnetsMock.mockResolvedValue({
      ok: true,
      data: [{ id: ENDPOINT_SUBNET_ID, "security-list-ids": [] }],
    });
    fetchVcnNsgsMock.mockResolvedValue({ ok: true, data: [{ id: NSG_ID }] });
  }

  it("一覧の材料(subnet)は展開側(NSGルール)の完了を待たずにRecordへ載る", async () => {
    setUpNetworkCluster();
    pendingQueue(fetchNsgWithRulesMock);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();

    const state = store.getState(CLUSTER_KEY, "network");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.subnets[ENDPOINT_SUBNET_ID]).toMatchObject({ ok: true });
    // 展開側が未完なのでページ全体はまだsettledにならない(ヘッダは取得中表示のまま)。
    expect(state.settled).toBe(false);
    expect(state.data.nsgs[NSG_ID]).toBeUndefined();
  });

  it("セクションが失敗しても待ち続けず、失敗結果としてRecordへ載る", async () => {
    setUpNetworkCluster();
    fetchVcnSubnetsMock.mockResolvedValue({ ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } });
    fetchSubnetMock.mockResolvedValue({ ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();

    expect(settled(store, "network")).toBe(true);
    const state = store.getState(CLUSTER_KEY, "network");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.subnets[ENDPOINT_SUBNET_ID]).toMatchObject({ ok: false, kind: "forbidden_or_not_found" });
  });
});
