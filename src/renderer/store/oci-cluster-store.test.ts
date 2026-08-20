import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resolveAnchor } from "../fetch/anchor";
import * as fetchModule from "../fetch/fetch";
import {
  fetchCluster,
  fetchFileSystem,
  fetchFssExport,
  fetchInstances,
  fetchNsgWithRules,
  fetchSubnet,
  fetchVcn,
  fetchVcnGateways,
  fetchVcnNsgs,
  fetchVcnRouteTables,
  fetchVcnSubnets,
} from "../fetch/fetch";
import type { TopologySection } from "../match/page-sections";
import { OciClusterStore, type TopologySectionStatus } from "./oci-cluster-store";

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
const fetchVcnRouteTablesMock = fetchVcnRouteTables as unknown as Mock;
const fetchVcnGatewaysMock = fetchVcnGateways as unknown as Mock;
const fetchVcnNsgsMock = fetchVcnNsgs as unknown as Mock;
const fetchNsgWithRulesMock = fetchNsgWithRules as unknown as Mock;
const fetchVcnMock = fetchVcn as unknown as Mock;
const fetchFileSystemMock = fetchFileSystem as unknown as Mock;
const fetchFssExportMock = fetchFssExport as unknown as Mock;

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
  k8s.persistentVolumeStore.items = [];
});

describe("pv-storageのFSS解決", () => {
  const EXPORT_ID = "ocid1.export.oc1.ap_tokyo_1.aaaaexport1";
  const FILE_SYSTEM_ID = "ocid1.filesystem.oc1.ap_tokyo_1.aaaafs1";
  const FILE_SYSTEM = { ok: true, data: { "display-name": "fss-home" } };
  const EXPORT_DENIED = { ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } };

  function setUpFssPv(volumeHandle: string): void {
    k8s.persistentVolumeStore.items = [{ spec: { csi: { driver: "fss.csi.oraclecloud.com", volumeHandle } } }];
  }

  it("volumeHandleがExport OCIDならexport応答のfile-system-idでFileSystemを取得する", async () => {
    const store = new OciClusterStore();
    setUpFssPv(`${EXPORT_ID}:10.0.0.5:/staging`);
    fetchFssExportMock.mockResolvedValue({ ok: true, data: { "file-system-id": FILE_SYSTEM_ID } });
    fetchFileSystemMock.mockResolvedValue(FILE_SYSTEM);

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();

    expect(fetchFssExportMock.mock.calls.map((call) => call[0])).toEqual([EXPORT_ID]);
    expect(fetchFileSystemMock.mock.calls.map((call) => call[0])).toEqual([FILE_SYSTEM_ID]);
    const state = store.getState(CLUSTER_KEY, "pv-storage");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.fssExports[EXPORT_ID]).toEqual({ ok: true, data: { "file-system-id": FILE_SYSTEM_ID } });
    expect(state.data.fileSystems[FILE_SYSTEM_ID]).toEqual(FILE_SYSTEM);
  });

  it("volumeHandleがFileSystem OCIDならexport getを叩かない", async () => {
    const store = new OciClusterStore();
    setUpFssPv(`${FILE_SYSTEM_ID}:10.0.0.5:/staging`);
    fetchFileSystemMock.mockResolvedValue(FILE_SYSTEM);

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();

    expect(fetchFssExportMock).not.toHaveBeenCalled();
    expect(fetchFileSystemMock.mock.calls.map((call) => call[0])).toEqual([FILE_SYSTEM_ID]);
  });

  it("export取得の失敗はFileSystem本体getへ進まずfssExportsの失敗として残り、セクションは確定する", async () => {
    const store = new OciClusterStore();
    setUpFssPv(`${EXPORT_ID}:10.0.0.5:/staging`);
    fetchFssExportMock.mockResolvedValue(EXPORT_DENIED);

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();

    expect(fetchFileSystemMock).not.toHaveBeenCalled();
    expect(settled(store, "pv-storage")).toBe(true);
    const state = store.getState(CLUSTER_KEY, "pv-storage");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.fssExports[EXPORT_ID]).toEqual(EXPORT_DENIED);
    expect(state.data.fileSystems).toEqual({});
  });
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

const DENIED = { ok: false as const, kind: "forbidden_or_not_found" as const, raw: { message: "denied" } };
const RESOURCE_NOT_FOUND = { ok: false as const, kind: "resource_not_found" as const, raw: { message: "gone" } };
const ORPHAN_FILE_SYSTEM_ID = "ocid1.filesystem.oc1.ap_tokyo_1.aaaaorphan1";

/** endpoint subnetを持たない最小構成のOKEクラスタ(topologyの取得起点はvcn-idのみ)。 */
function setUpTopologyCluster(): void {
  fetchClusterMock.mockResolvedValue({ ok: true, data: { id: ANCHOR.clusterId, "vcn-id": VCN_ID } });
}

function progressOf(store: OciClusterStore): Record<TopologySection, TopologySectionStatus> {
  const entries = store.getTopologyProgress(CLUSTER_KEY).map((entry) => [entry.section, entry.status]);
  return Object.fromEntries(entries) as Record<TopologySection, TopologySectionStatus>;
}

describe("topologyページのvcnセクション", () => {
  it("cluster応答のvcn-idを起点にVCN本体を取得し、vcnsへ載せる", async () => {
    setUpTopologyCluster();
    const vcn = { id: VCN_ID, "display-name": "vcn-1", "cidr-block": "10.0.0.0/16" };
    fetchVcnMock.mockResolvedValue({ ok: true, data: vcn });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVcnMock).toHaveBeenCalledWith(VCN_ID, "");
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.settled).toBe(true);
    expect(state.data.vcns[VCN_ID]).toEqual({ ok: true, data: vcn });
    expect(progressOf(store).vcn).toBe("ok");
  });

  it("VCN取得が失敗しても確定扱いになり、失敗結果としてvcnsへ載る", async () => {
    setUpTopologyCluster();
    fetchVcnMock.mockResolvedValue(DENIED);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(settled(store, "topology")).toBe(true);
    expect(progressOf(store).vcn).toBe("failed");
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.vcns[VCN_ID]).toMatchObject({ ok: false, kind: "forbidden_or_not_found" });
  });

  it("cluster取得の失敗はvcnセクションの失敗として観測できる", async () => {
    fetchClusterMock.mockResolvedValue(DENIED);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVcnMock).not.toHaveBeenCalled();
    expect(progressOf(store).vcn).toBe("failed");
  });
});

describe("topologyのセクション進行状態", () => {
  it("必要セクション集合を列挙し、未着手はloadingで返る", () => {
    const store = new OciClusterStore();

    expect(store.getTopologyProgress(CLUSTER_KEY)).toEqual(
      [
        "cluster",
        "taggedResources",
        "instances",
        "nodePools",
        "lbs",
        "nlbs",
        "wafs",
        "volumes",
        "volumeBackupPolicies",
        "fileSystems",
        "fssSnapshotPolicies",
        "vcn",
        "subnets",
        "routeTables",
        "securityLists",
        "nsgs",
        "gateways",
        "managedCerts",
        "dnsChecks",
      ].map((section) => ({ section, status: "loading" })),
    );
  });

  it("取得中のセクションだけがloadingで残る", async () => {
    setUpTopologyCluster();
    pendingQueue(fetchInstancesMock);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    const progress = progressOf(store);
    expect(progress.instances).toBe("loading");
    expect(progress.cluster).toBe("ok");
    expect(progress.subnets).toBe("ok");
  });

  it("型別listの失敗はセクションのfailedとして観測でき、空listのokと区別できる", async () => {
    setUpTopologyCluster();
    fetchVcnSubnetsMock.mockResolvedValue(DENIED);
    fetchVcnGatewaysMock.mockResolvedValue(DENIED);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    const progress = progressOf(store);
    // どちらもMapは空。listの成否を持たなければ「対象なし」と見分けが付かない。
    expect(progress.subnets).toBe("failed");
    expect(progress.gateways).toBe("failed");
    expect(progress.routeTables).toBe("ok");
    expect(fetchVcnRouteTablesMock).toHaveBeenCalled();
  });

  it("参照先の実体なし(孤立PV)はセクションのfailedにしない", async () => {
    setUpTopologyCluster();
    k8s.persistentVolumeStore.items = [
      { spec: { csi: { driver: "fss.csi.oraclecloud.com", volumeHandle: `${ORPHAN_FILE_SYSTEM_ID}:10.0.0.5:/x` } } },
    ];
    fetchFileSystemMock.mockResolvedValue(RESOURCE_NOT_FOUND);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    const progress = progressOf(store);
    expect(progress.fileSystems).toBe("ok");
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.fileSystems[ORPHAN_FILE_SYSTEM_ID]).toEqual(RESOURCE_NOT_FOUND);
  });
});

describe("topologyの確定スナップショット", () => {
  it("全必要セクション確定まで現れず、確定時に世代1で現れる", async () => {
    setUpTopologyCluster();
    const instances = pendingQueue(fetchInstancesMock);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)).toBeUndefined();

    instances[0]?.({ ok: true, data: [{ id: "i-1" }] });
    await settle();

    const snapshot = store.getTopologySnapshot(CLUSTER_KEY);
    expect(snapshot?.generation).toBe(1);
    expect(snapshot?.data.instances).toEqual({ ok: true, data: [{ id: "i-1" }] });
  });

  it("force更新中は直前の世代を返し続け、確定後に一度だけ世代が進む", async () => {
    setUpTopologyCluster();
    fetchInstancesMock.mockResolvedValue({ ok: true, data: [{ id: "old" }] });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);

    const instances = pendingQueue(fetchInstancesMock);
    const poll = store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();
    // 取得中に差し替えると新旧混在の図になる
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.data.instances).toEqual({ ok: true, data: [{ id: "old" }] });

    instances[0]?.({ ok: true, data: [{ id: "new" }] });
    await poll;

    const snapshot = store.getTopologySnapshot(CLUSTER_KEY);
    expect(snapshot?.generation).toBe(2);
    expect(snapshot?.data.instances).toEqual({ ok: true, data: [{ id: "new" }] });
  });

  it("内容が変わらない再確定では世代を進めない", async () => {
    setUpTopologyCluster();
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);
  });

  it("refreshはスナップショットを捨て、採番は戻さない", async () => {
    setUpTopologyCluster();
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);

    const instances = pendingQueue(fetchInstancesMock);
    store.refresh(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)).toBeUndefined();

    instances[0]?.({ ok: true, data: [{ id: "i-1" }] });
    await settle();

    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(2);
  });
});
