import { observable, runInAction } from "mobx";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { resolveAnchor } from "../fetch/anchor";
import * as fetchModule from "../fetch/fetch";
import {
  fetchBackendSetHealth,
  fetchCluster,
  fetchFileSystem,
  fetchFssExport,
  fetchFssMountEntries,
  fetchInstances,
  fetchLbs,
  fetchNlbs,
  fetchNodePool,
  fetchNodePools,
  fetchNsgWithRules,
  fetchResourceSearches,
  fetchSubnet,
  fetchTaggedResources,
  fetchVcn,
  fetchVcnGateways,
  fetchVcnNsgs,
  fetchVcnRouteTables,
  fetchVcnSubnets,
  fetchVnic,
  fetchVnicAttachments,
  fetchVolumeAttachments,
  fetchVolumeBackupPolicyName,
} from "../fetch/fetch";
import { backendHealthKey } from "../match/backend-health";
import type { TopologySection } from "../match/page-sections";
import { OciClusterStore, type TopologySectionStatus } from "./oci-cluster-store";

// @freelensapp/extensionsの実体はFreeLens本体のrendererバンドルで、node環境のimportで例外を出す。
const k8s = vi.hoisted(() => ({
  nodesStore: {
    loadAll: () => Promise.resolve(),
    isLoaded: true,
    items: [{ spec: { providerID: "oci://ocid1.instance.oc1..aaaa1" } }],
  },
  persistentVolumeStore: { loadAll: () => Promise.resolve(), items: [] as unknown[] },
  serviceStore: { loadAll: () => Promise.resolve(), items: [] as unknown[] },
  // 実際のKubeObjectStore#loadAllは成功時に配列、失敗時にundefinedを返す。
  endpointSliceStore: { loadAll: vi.fn(() => Promise.resolve([])), items: [] as unknown[] },
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
const fetchFssMountEntriesMock = fetchFssMountEntries as unknown as Mock;
const fetchResourceSearchesMock = fetchResourceSearches as unknown as Mock;
const fetchVolumeBackupPolicyNameMock = fetchVolumeBackupPolicyName as unknown as Mock;
const fetchVnicAttachmentsMock = fetchVnicAttachments as unknown as Mock;
const fetchVnicMock = fetchVnic as unknown as Mock;
const fetchVolumeAttachmentsMock = fetchVolumeAttachments as unknown as Mock;
const fetchTaggedResourcesMock = fetchTaggedResources as unknown as Mock;
const fetchNlbsMock = fetchNlbs as unknown as Mock;
const fetchLbsMock = fetchLbs as unknown as Mock;
const fetchBackendSetHealthMock = fetchBackendSetHealth as unknown as Mock;
const fetchNodePoolsMock = fetchNodePools as unknown as Mock;
const fetchNodePoolMock = fetchNodePool as unknown as Mock;

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
  fetchFssMountEntriesMock.mockResolvedValue({ ok: true, data: { entries: [], mountTargetIps: [] } });
  // 既定はどのOCIDもSearchでヒットしない(不在か権限不足か決まらない)。
  fetchResourceSearchesMock.mockImplementation((ids: string[]) =>
    Promise.resolve(Object.fromEntries(ids.map((id) => [id, { ok: true, data: null }]))),
  );
  resolveAnchorMock.mockReset().mockResolvedValue(ANCHOR);
  k8s.persistentVolumeStore.loadAll = () => Promise.resolve();
  k8s.persistentVolumeStore.items = [];
  k8s.nodesStore.items = [{ spec: { providerID: "oci://ocid1.instance.oc1..aaaa1" } }];
  k8s.nodesStore.isLoaded = true;
  k8s.endpointSliceStore.loadAll.mockClear();
  k8s.namespaceStore.items = [];
});

describe("topologyページのEndpointSlice取得", () => {
  // subscribe()だけではnamespaced storeのitemsは埋まらないため、loadAllを明示的に呼ぶ必要がある。
  it("全namespaceを指定してloadAllする", async () => {
    k8s.namespaceStore.items = [{ getName: () => "app" }, { getName: () => "ops" }];
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(k8s.endpointSliceStore.loadAll).toHaveBeenCalledWith({ namespaces: ["app", "ops"] });
  });

  it("topology以外のページでは呼ばない", async () => {
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "service-lb");
    await settle();

    expect(k8s.endpointSliceStore.loadAll).not.toHaveBeenCalled();
  });

  it("同じクラスタで再度ensureLoadedしても1回しか呼ばない", async () => {
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(k8s.endpointSliceStore.loadAll).toHaveBeenCalledTimes(1);
  });
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

  it("IP:pathで照合できたPVはexport getを叩かず、照合先のFileSystemを取得する", async () => {
    const store = new OciClusterStore();
    const MATCHED_FS_ID = "ocid1.filesystem.oc1.ap_tokyo_1.aaaamatched";
    setUpFssPv(`${EXPORT_ID}:10.0.0.5:/staging`);
    fetchFssMountEntriesMock.mockResolvedValue({
      ok: true,
      data: {
        entries: [{ ipAddress: "10.0.0.5", path: "/staging", exportId: EXPORT_ID, fileSystemId: MATCHED_FS_ID }],
        mountTargetIps: ["10.0.0.5"],
      },
    });
    fetchFileSystemMock.mockResolvedValue(FILE_SYSTEM);

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();

    expect(fetchFssMountEntriesMock).toHaveBeenCalledTimes(1);
    expect(fetchFssExportMock).not.toHaveBeenCalled();
    expect(fetchFileSystemMock.mock.calls.map((call) => call[0])).toEqual([MATCHED_FS_ID]);
    expect(settled(store, "pv-storage")).toBe(true);
  });

  it("IP:pathを持たないFSS PVだけならmount target / exportの一覧を取得しない", async () => {
    const store = new OciClusterStore();
    setUpFssPv(FILE_SYSTEM_ID);
    fetchFileSystemMock.mockResolvedValue(FILE_SYSTEM);

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();

    expect(fetchFssMountEntriesMock).not.toHaveBeenCalled();
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

describe("pv-storageの参照先の存在確認", () => {
  const VOLUME_A = "ocid1.volume.oc1.ap-tokyo-1.aaaavolumea";
  const VOLUME_B = "ocid1.volume.oc1.ap-tokyo-1.aaaavolumeb";
  const FILE_SYSTEM_ID = "ocid1.filesystem.oc1.ap_tokyo_1.aaaafs1";
  const NOT_FOUND = { ok: false, kind: "resource_not_found", raw: { message: "404" } };

  function setUpPvs(): void {
    k8s.persistentVolumeStore.items = [
      { spec: { csi: { driver: "blockvolume.csi.oraclecloud.com", volumeHandle: VOLUME_A } } },
      { spec: { csi: { driver: "blockvolume.csi.oraclecloud.com", volumeHandle: VOLUME_B } } },
      { spec: { csi: { driver: "fss.csi.oraclecloud.com", volumeHandle: `${FILE_SYSTEM_ID}:10.0.0.5:/x` } } },
    ];
  }

  it("getが404だった参照先を種別をまたいで1回のSearchにまとめ、結果をOCIDごとに載せる", async () => {
    setUpPvs();
    fetchVolumeBackupPolicyNameMock.mockResolvedValue(NOT_FOUND);
    fetchFileSystemMock.mockResolvedValue(NOT_FOUND);
    const hit = { identifier: VOLUME_A, "resource-type": "Volume", "lifecycle-state": "AVAILABLE" };
    fetchResourceSearchesMock.mockResolvedValue({
      [VOLUME_A]: { ok: true, data: hit },
      [VOLUME_B]: { ok: true, data: null },
      [FILE_SYSTEM_ID]: { ok: true, data: null },
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();

    expect(fetchResourceSearchesMock).toHaveBeenCalledTimes(1);
    expect(fetchResourceSearchesMock.mock.calls[0]?.[0]).toEqual([VOLUME_A, VOLUME_B, FILE_SYSTEM_ID]);
    expect(settled(store, "pv-storage")).toBe(true);
    const state = store.getState(CLUSTER_KEY, "pv-storage");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.resourceSearches).toEqual({
      [VOLUME_A]: { ok: true, data: hit },
      [VOLUME_B]: { ok: true, data: null },
      [FILE_SYSTEM_ID]: { ok: true, data: null },
    });
  });

  it("参照先のgetがどれも成功する正常系ではSearchを呼ばない", async () => {
    setUpPvs();
    fetchVolumeBackupPolicyNameMock.mockResolvedValue({ ok: true, data: { policyName: undefined } });
    fetchFileSystemMock.mockResolvedValue({ ok: true, data: { "display-name": "fss-home" } });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();

    expect(fetchResourceSearchesMock).not.toHaveBeenCalled();
    expect(settled(store, "pv-storage")).toBe(true);
  });

  it("Search自体の失敗はセクションの失敗にせず、Topologyの進行状態もokで確定する", async () => {
    setUpTopologyCluster();
    setUpPvs();
    fetchVolumeBackupPolicyNameMock.mockResolvedValue(NOT_FOUND);
    fetchFileSystemMock.mockResolvedValue(NOT_FOUND);
    const failure = { ok: false, kind: "other", raw: { message: "search failed" } };
    fetchResourceSearchesMock.mockImplementation((ids: string[]) =>
      Promise.resolve(Object.fromEntries(ids.map((id) => [id, failure]))),
    );
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(settled(store, "topology")).toBe(true);
    const progress = progressOf(store);
    expect(progress.fileSystems).toBe("ok");
    expect(progress.volumeBackupPolicies).toBe("ok");
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.resourceSearches[VOLUME_A]).toEqual(failure);
  });

  it("取得済みの存在確認は自動更新以外で再照会しない", async () => {
    setUpPvs();
    fetchVolumeBackupPolicyNameMock.mockResolvedValue(NOT_FOUND);
    fetchFileSystemMock.mockResolvedValue({ ok: true, data: {} });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();
    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchResourceSearchesMock).toHaveBeenCalledTimes(1);
    expect(fetchResourceSearchesMock.mock.calls[0]?.[0]).toEqual([VOLUME_A, VOLUME_B]);
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

/** topologyページのVNIC Map(セクション確定前は空)。 */
function vnicsOf(store: OciClusterStore): Record<string, unknown> {
  const state = store.getState(CLUSTER_KEY, "topology");
  return state.status === "loaded" ? state.data.vnics : {};
}

describe("topologyページのVNIC取得", () => {
  const INSTANCE_ID = "ocid1.instance.oc1..aaaa1";
  const OTHER_INSTANCE_ID = "ocid1.instance.oc1..other";
  const VNIC_ID = "ocid1.vnic.oc1..aaaa1";
  const OTHER_VNIC_ID = "ocid1.vnic.oc1..other";

  function attachment(instanceId: string, vnicId: string, lifecycleState = "ATTACHED"): unknown {
    return {
      id: `${vnicId}-attachment`,
      "instance-id": instanceId,
      "vnic-id": vnicId,
      "lifecycle-state": lifecycleState,
    };
  }

  it("クラスタのNodeに対応するInstanceのVNICだけをgetする", async () => {
    fetchVnicAttachmentsMock.mockResolvedValue({
      ok: true,
      data: [attachment(INSTANCE_ID, VNIC_ID), attachment(OTHER_INSTANCE_ID, OTHER_VNIC_ID)],
    });
    fetchVnicMock.mockResolvedValue({ ok: true, data: { id: VNIC_ID, "is-primary": true } });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVnicAttachmentsMock).toHaveBeenCalledWith(ANCHOR.compartmentId, "");
    expect(fetchVnicMock.mock.calls.map((call) => call[0])).toEqual([VNIC_ID]);
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.vnics[VNIC_ID]).toEqual({ ok: true, data: { id: VNIC_ID, "is-primary": true } });
  });

  it("切り離し済みのattachmentはVNIC getへ進まない", async () => {
    fetchVnicAttachmentsMock.mockResolvedValue({
      ok: true,
      data: [attachment(INSTANCE_ID, VNIC_ID, "DETACHED")],
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVnicMock).not.toHaveBeenCalled();
  });

  it("再取得で一覧から消えたVNICはMapから落ちる", async () => {
    const SECOND_VNIC_ID = "ocid1.vnic.oc1..aaaa2";
    fetchVnicAttachmentsMock.mockResolvedValue({
      ok: true,
      data: [attachment(INSTANCE_ID, VNIC_ID), attachment(INSTANCE_ID, SECOND_VNIC_ID)],
    });
    fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(Object.keys(vnicsOf(store))).toEqual([VNIC_ID, SECOND_VNIC_ID]);

    fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    expect(Object.keys(vnicsOf(store))).toEqual([VNIC_ID]);
  });

  it("attachment一覧の失敗では既存のVNICを刈り込まない", async () => {
    fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
    fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    fetchVnicAttachmentsMock.mockResolvedValue({
      ok: false,
      kind: "forbidden_or_not_found",
      raw: { message: "denied" },
    });
    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    expect(Object.keys(vnicsOf(store))).toEqual([VNIC_ID]);
  });

  it("ポーリングは一覧だけ取り直し、未取得のVNIC本体だけをgetする", async () => {
    const SECOND_VNIC_ID = "ocid1.vnic.oc1..aaaa2";
    fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
    fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(fetchVnicMock.mock.calls.map((call) => call[0])).toEqual([VNIC_ID]);

    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();
    expect(fetchVnicAttachmentsMock).toHaveBeenCalledTimes(2);
    expect(fetchVnicMock.mock.calls.map((call) => call[0])).toEqual([VNIC_ID]);

    fetchVnicAttachmentsMock.mockResolvedValue({
      ok: true,
      data: [attachment(INSTANCE_ID, VNIC_ID), attachment(INSTANCE_ID, SECOND_VNIC_ID)],
    });
    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();
    expect(fetchVnicMock.mock.calls.map((call) => call[0])).toEqual([VNIC_ID, SECOND_VNIC_ID]);
  });

  it("手動更新はVNIC本体を全件取り直す", async () => {
    fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
    fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    store.refresh(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVnicMock.mock.calls.map((call) => call[0])).toEqual([VNIC_ID, VNIC_ID]);
  });

  it("バックグラウンドの手動更新はVNIC本体を全件取り直す", async () => {
    fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
    fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    await store.pollRefresh(CLUSTER_KEY, "topology", true);

    expect(fetchVnicMock.mock.calls.map((call) => call[0])).toEqual([VNIC_ID, VNIC_ID]);
  });

  it("K8s Nodeを1件も読めていない回は確定させず、既存のVNICも刈り込まない", async () => {
    fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
    fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(Object.keys(vnicsOf(store))).toEqual([VNIC_ID]);

    k8s.nodesStore.isLoaded = false;
    k8s.nodesStore.items = [];
    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    // 列挙元を叩かずに戻るため、attachment listの呼び出しも増えない。
    expect(fetchVnicAttachmentsMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(vnicsOf(store))).toEqual([VNIC_ID]);
  });

  it("K8s Nodeがロード済みで0件なら空のVNICセクションとして確定する", async () => {
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    k8s.nodesStore.items = [];
    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVnicAttachmentsMock).toHaveBeenCalledTimes(1);
    expect(progressOf(store).vnics).toBe("ok");
    expect(settled(store, "topology")).toBe(true);
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.vnicAttachments).toEqual({ ok: true, data: [] });
    expect(state.data.vnics).toEqual({});
  });

  it("VNIC取得中の例外はvnicsセクションの失敗として確定する", async () => {
    setUpTopologyCluster();
    fetchVnicAttachmentsMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(progressOf(store).vnics).toBe("failed");
    expect(settled(store, "topology")).toBe(true);
  });

  it("attachment一覧の失敗はvnicsセクションの失敗として確定する", async () => {
    fetchVnicAttachmentsMock.mockResolvedValue({
      ok: false,
      kind: "forbidden_or_not_found",
      raw: { message: "denied" },
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVnicMock).not.toHaveBeenCalled();
    expect(progressOf(store).vnics).toBe("failed");
    expect(settled(store, "topology")).toBe(true);
  });
});

describe("topologyページのボリュームアタッチメント取得", () => {
  it("アンカーcompartmentの一括listを1回だけ叩く", async () => {
    fetchVolumeAttachmentsMock.mockResolvedValue({ ok: true, data: [] });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(fetchVolumeAttachmentsMock.mock.calls).toEqual([[ANCHOR.compartmentId, ""]]);
    expect(progressOf(store).volumeAttachments).toBe("ok");
  });

  it("他ページでは叩かず、topologyの結果はvolumeAttachmentsとして載る", async () => {
    const attachments = [{ id: "ocid1.volumeattachment.oc1..a1" }];
    fetchVolumeAttachmentsMock.mockResolvedValue({ ok: true, data: attachments });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "pv-storage");
    await settle();
    expect(fetchVolumeAttachmentsMock).not.toHaveBeenCalled();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.volumeAttachments).toEqual({ ok: true, data: attachments });
  });

  it("list失敗はvolumeAttachmentsセクションの失敗として確定する", async () => {
    fetchVolumeAttachmentsMock.mockResolvedValue({
      ok: false,
      kind: "forbidden_or_not_found",
      raw: { message: "denied" },
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(progressOf(store).volumeAttachments).toBe("failed");
    expect(settled(store, "topology")).toBe(true);
  });
});

describe("topologyページのbackend health一括取得", () => {
  const NLB_ID = "ocid1.networkloadbalancer.oc1..aaaa1";
  const LB_ID = "ocid1.loadbalancer.oc1..aaaa1";
  const UNRELATED_LB_ID = "ocid1.loadbalancer.oc1..other";

  /** タグ検索でクラスタ関連と判定されるNLB1台(セット2つ)とLB1台(セット1つ)。 */
  function setUpLoadBalancers(nlbBackendSetNames: string[] = ["TCP-80", "TCP-443"]): void {
    fetchTaggedResourcesMock.mockResolvedValue({
      ok: true,
      data: [{ identifier: NLB_ID }, { identifier: LB_ID }],
    });
    fetchNlbsMock.mockResolvedValue({
      ok: true,
      data: [{ id: NLB_ID, "backend-sets": Object.fromEntries(nlbBackendSetNames.map((name) => [name, {}])) }],
    });
    fetchLbsMock.mockResolvedValue({
      ok: true,
      data: [
        { id: LB_ID, "backend-sets": { https: {} } },
        { id: UNRELATED_LB_ID, "backend-sets": { other: {} } },
      ],
    });
  }

  function healthCalls(): string[][] {
    return fetchBackendSetHealthMock.mock.calls.map((call) => [call[0], call[1], call[2]] as string[]);
  }

  it("クラスタ関連LB/NLBの全backend setを取得してbackendHealthsへ載せる", async () => {
    setUpLoadBalancers();
    fetchBackendSetHealthMock.mockResolvedValue({ ok: true, data: { status: "OK" } });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(healthCalls()).toEqual([
      ["nlb", NLB_ID, "TCP-80"],
      ["nlb", NLB_ID, "TCP-443"],
      ["lb", LB_ID, "https"],
    ]);
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.backendHealths[backendHealthKey("nlb", NLB_ID, "TCP-80")]).toEqual({
      ok: true,
      data: { status: "OK" },
    });
  });

  it("クラスタ関連でないLBのbackend setは叩かない", async () => {
    setUpLoadBalancers();
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(healthCalls().some(([, lbId]) => lbId === UNRELATED_LB_ID)).toBe(false);
  });

  it("networkページは一括取得せず展開時オンデマンドのままにする", async () => {
    setUpLoadBalancers();
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();
    expect(fetchBackendSetHealthMock).not.toHaveBeenCalled();

    store.ensureBackendHealth(CLUSTER_KEY, "nlb", NLB_ID, "TCP-80");
    await settle();
    expect(healthCalls()).toEqual([["nlb", NLB_ID, "TCP-80"]]);
  });

  it("networkページの周期更新はオンデマンド要求した分だけを取り直す", async () => {
    setUpLoadBalancers();
    fetchBackendSetHealthMock.mockResolvedValue({ ok: true, data: { status: "OK" } });
    const store = new OciClusterStore();

    // topologyページの一括取得が全backend setをキャッシュへ書いた後にnetworkページを開く。
    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();
    store.ensureBackendHealth(CLUSTER_KEY, "nlb", NLB_ID, "TCP-80");
    await settle();
    fetchBackendSetHealthMock.mockClear();

    await store.pollRefresh(CLUSTER_KEY, "network");
    await settle();

    expect(healthCalls()).toEqual([["nlb", NLB_ID, "TCP-80"]]);
  });

  it("個別の失敗はログへ出し、残りのbackend setの取得は続ける", async () => {
    setUpLoadBalancers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchBackendSetHealthMock.mockImplementation((_kind: string, _lbId: string, backendSetName: string) =>
      Promise.resolve(
        backendSetName === "TCP-80"
          ? { ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } }
          : { ok: true, data: { status: "OK" } },
      ),
    );
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(healthCalls()).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith(
      "[freelens-oci-cluster] backend set health fetch failed",
      expect.objectContaining({ kind: "nlb", loadBalancerId: NLB_ID, backendSetName: "TCP-80" }),
    );
    expect(settled(store, "topology")).toBe(true);
    warn.mockRestore();
  });

  it("同時実行数を4に抑える", async () => {
    setUpLoadBalancers(Array.from({ length: 9 }, (_, index) => `set-${index}`));
    let inFlight = 0;
    let peak = 0;
    fetchBackendSetHealthMock.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight -= 1;
          resolve({ ok: true, data: { status: "OK" } });
        }, 0),
      );
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(healthCalls()).toHaveLength(10);
    expect(peak).toBe(4);
  });

  it("ヘルスの完了を待たずに図を確定させ、揃った時点で世代を進める", async () => {
    setUpLoadBalancers(["TCP-80"]);
    const resolvers = pendingQueue(fetchBackendSetHealthMock);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.data.backendHealths).toEqual({});

    for (const resolve of resolvers) resolve({ ok: true, data: { status: "OK" } });
    await settle();

    const snapshot = store.getTopologySnapshot(CLUSTER_KEY);
    expect(snapshot?.generation).toBe(2);
    expect(snapshot?.data.backendHealths[backendHealthKey("nlb", NLB_ID, "TCP-80")]).toEqual({
      ok: true,
      data: { status: "OK" },
    });
  });

  it("ポーリングはbackend setの索引ごと取り直し、増えたセットも取る", async () => {
    setUpLoadBalancers(["TCP-80"]);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(healthCalls()).toEqual([
      ["nlb", NLB_ID, "TCP-80"],
      ["lb", LB_ID, "https"],
    ]);

    fetchBackendSetHealthMock.mockClear();
    setUpLoadBalancers(["TCP-80", "TCP-443"]);
    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    expect(healthCalls()).toEqual([
      ["nlb", NLB_ID, "TCP-80"],
      ["nlb", NLB_ID, "TCP-443"],
      ["lb", LB_ID, "https"],
    ]);
  });
});

describe("topologyページのノードプール本体取得", () => {
  const POOL_1 = "ocid1.nodepool.oc1..aaaa1";
  const POOL_2 = "ocid1.nodepool.oc1..aaaa2";

  function setUpNodePools(poolIds: string[] = [POOL_1, POOL_2]): void {
    fetchNodePoolsMock.mockResolvedValue({ ok: true, data: poolIds.map((id) => ({ id, name: id.slice(-5) })) });
  }

  function poolCalls(): string[] {
    return fetchNodePoolMock.mock.calls.map((call) => call[0] as string);
  }

  it("クラスタのノードプール全件を取得してnodePoolDetailsへ載せる", async () => {
    setUpNodePools();
    fetchNodePoolMock.mockImplementation((poolId: string) =>
      Promise.resolve({ ok: true, data: { nodes: [{ id: `instance-of-${poolId}` }] } }),
    );
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(poolCalls()).toEqual([POOL_1, POOL_2]);
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.data.nodePoolDetails[POOL_1]).toEqual({
      ok: true,
      data: { nodes: [{ id: `instance-of-${POOL_1}` }] },
    });
  });

  it("nodes/networkページでは一括取得しない", async () => {
    setUpNodePools();
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "nodes");
    store.ensureLoaded(CLUSTER_KEY, "network");
    await settle();

    expect(fetchNodePoolMock).not.toHaveBeenCalled();
  });

  it("個別の失敗はログへ出し、残りのプールの取得は続ける", async () => {
    setUpNodePools();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchNodePoolMock.mockImplementation((poolId: string) =>
      Promise.resolve(
        poolId === POOL_1
          ? { ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } }
          : { ok: true, data: { nodes: [] } },
      ),
    );
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(poolCalls()).toEqual([POOL_1, POOL_2]);
    expect(warn).toHaveBeenCalledWith(
      "[freelens-oci-cluster] node pool fetch failed",
      expect.objectContaining({ nodePoolId: POOL_1 }),
    );
    expect(settled(store, "topology")).toBe(true);
    warn.mockRestore();
  });

  it("同時実行数を4に抑える", async () => {
    setUpNodePools(Array.from({ length: 10 }, (_, index) => `ocid1.nodepool.oc1..pool${index}`));
    let inFlight = 0;
    let peak = 0;
    fetchNodePoolMock.mockImplementation(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight -= 1;
          resolve({ ok: true, data: { nodes: [] } });
        }, 0),
      );
    });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    expect(poolCalls()).toHaveLength(10);
    expect(peak).toBe(4);
  });

  it("プール本体の完了を待たずに図を確定させ、揃った時点で世代を進める", async () => {
    setUpNodePools([POOL_1]);
    const resolvers = pendingQueue(fetchNodePoolMock);
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.data.nodePoolDetails).toEqual({});

    for (const resolve of resolvers) resolve({ ok: true, data: { nodes: [] } });
    await settle();

    const snapshot = store.getTopologySnapshot(CLUSTER_KEY);
    expect(snapshot?.generation).toBe(2);
    expect(snapshot?.data.nodePoolDetails[POOL_1]).toEqual({ ok: true, data: { nodes: [] } });
  });

  it("ポーリングはプール一覧ごと取り直し、消えたプールのエントリは残さない", async () => {
    setUpNodePools();
    fetchNodePoolMock.mockResolvedValue({ ok: true, data: { nodes: [] } });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(poolCalls()).toEqual([POOL_1, POOL_2]);

    fetchNodePoolMock.mockClear();
    setUpNodePools([POOL_2]);
    await store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    expect(poolCalls()).toEqual([POOL_2]);
    const state = store.getState(CLUSTER_KEY, "topology");
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(Object.keys(state.data.nodePoolDetails)).toEqual([POOL_2]);
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
        "vnics",
        "nodePools",
        "lbs",
        "nlbs",
        "wafs",
        "volumes",
        "volumeAttachments",
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
        "dnsZones",
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
  it("同じクラスタの重複pollは進行中の1サイクルへ集約する", async () => {
    setUpTopologyCluster();
    const store = new OciClusterStore();
    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();

    const clusters = pendingQueue(fetchClusterMock);
    const first = store.pollRefresh(CLUSTER_KEY, "topology");
    const second = store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    expect(second).toBe(first);
    expect(fetchClusterMock).toHaveBeenCalledTimes(2);
    clusters[0]?.({ ok: true, data: {} });
    await first;
  });

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

  it("ポーリング中の再マウントでは新旧混在のスナップショットを確定させない", async () => {
    setUpTopologyCluster();
    fetchInstancesMock.mockResolvedValue({ ok: true, data: [{ id: "old" }] });
    const store = new OciClusterStore();

    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);

    const instances = pendingQueue(fetchInstancesMock);
    fetchVolumeAttachmentsMock.mockResolvedValue({ ok: true, data: [{ id: "att-new" }] });
    const poll = store.pollRefresh(CLUSTER_KEY, "topology");
    await settle();

    // 再マウント。進行中のforceサイクルを待たずに確定させると、instancesだけ旧世代の図になる。
    store.ensureLoaded(CLUSTER_KEY, "topology");
    await settle();
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);
    expect(store.getTopologySnapshot(CLUSTER_KEY)?.data.instances).toEqual({ ok: true, data: [{ id: "old" }] });

    instances[0]?.({ ok: true, data: [{ id: "new" }] });
    await poll;
    await settle();

    const snapshot = store.getTopologySnapshot(CLUSTER_KEY);
    expect(snapshot?.generation).toBe(2);
    expect(snapshot?.data.instances).toEqual({ ok: true, data: [{ id: "new" }] });
    expect(snapshot?.data.volumeAttachments).toEqual({ ok: true, data: [{ id: "att-new" }] });
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

describe("topologyのK8s Node追従", () => {
  const INSTANCE_ID = "ocid1.instance.oc1..aaaa1";
  const NEW_INSTANCE_ID = "ocid1.instance.oc1..aaaa2";
  const VNIC_ID = "ocid1.vnic.oc1..aaaa1";
  const NEW_VNIC_ID = "ocid1.vnic.oc1..aaaa2";

  function attachment(instanceId: string, vnicId: string): unknown {
    return { id: `${vnicId}-attachment`, "instance-id": instanceId, "vnic-id": vnicId, "lifecycle-state": "ATTACHED" };
  }

  it("Node集合が変わるとVNICを取り直し、スナップショットを確定し直す", async () => {
    vi.useFakeTimers();
    try {
      setUpTopologyCluster();
      // 監視はmobxのreactionのため、Node一覧はobservableでないと変化を観測できない。
      const nodeItems = observable.array([{ spec: { providerID: `oci://${INSTANCE_ID}` } }]);
      k8s.nodesStore.items = nodeItems;
      fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
      fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
      const store = new OciClusterStore();

      store.ensureLoaded(CLUSTER_KEY, "topology");
      await vi.advanceTimersByTimeAsync(50);
      expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);
      expect(Object.keys(vnicsOf(store))).toEqual([VNIC_ID]);

      fetchVnicAttachmentsMock.mockResolvedValue({
        ok: true,
        data: [attachment(INSTANCE_ID, VNIC_ID), attachment(NEW_INSTANCE_ID, NEW_VNIC_ID)],
      });
      runInAction(() => nodeItems.push({ spec: { providerID: `oci://${NEW_INSTANCE_ID}` } }));
      await vi.advanceTimersByTimeAsync(2500);

      expect(Object.keys(vnicsOf(store))).toEqual([VNIC_ID, NEW_VNIC_ID]);
      expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(2);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Node追従は進行中のpoll完了前にスナップショットを確定しない", async () => {
    vi.useFakeTimers();
    try {
      setUpTopologyCluster();
      const nodeItems = observable.array([{ spec: { providerID: `oci://${INSTANCE_ID}` } }]);
      k8s.nodesStore.items = nodeItems;
      fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
      fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
      const store = new OciClusterStore();

      store.ensureLoaded(CLUSTER_KEY, "topology");
      await vi.advanceTimersByTimeAsync(50);
      expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);

      const instances = pendingQueue(fetchInstancesMock);
      const poll = store.pollRefresh(CLUSTER_KEY, "topology");
      await vi.advanceTimersByTimeAsync(50);
      fetchVnicAttachmentsMock.mockResolvedValue({
        ok: true,
        data: [attachment(INSTANCE_ID, VNIC_ID), attachment(NEW_INSTANCE_ID, NEW_VNIC_ID)],
      });
      runInAction(() => nodeItems.push({ spec: { providerID: `oci://${NEW_INSTANCE_ID}` } }));
      await vi.advanceTimersByTimeAsync(2500);

      expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(1);
      instances[0]?.({ ok: true, data: [{ id: INSTANCE_ID }, { id: NEW_INSTANCE_ID }] });
      await poll;
      await vi.advanceTimersByTimeAsync(50);
      expect(store.getTopologySnapshot(CLUSTER_KEY)?.generation).toBe(2);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Node集合が変わらなければ取り直さない", async () => {
    vi.useFakeTimers();
    try {
      setUpTopologyCluster();
      const nodeItems = observable.array([{ spec: { providerID: `oci://${INSTANCE_ID}` } }]);
      k8s.nodesStore.items = nodeItems;
      fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
      fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
      const store = new OciClusterStore();

      store.ensureLoaded(CLUSTER_KEY, "topology");
      await vi.advanceTimersByTimeAsync(50);

      // 同じNodeの再掲(watchの再送)ではproviderID集合が変わらない。
      runInAction(() => nodeItems.replace([{ spec: { providerID: `oci://${INSTANCE_ID}` } }]));
      await vi.advanceTimersByTimeAsync(2500);

      expect(fetchVnicAttachmentsMock).toHaveBeenCalledTimes(1);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("クラスタ切替時は旧クラスタの監視を解除する", async () => {
    vi.useFakeTimers();
    try {
      setUpTopologyCluster();
      const nodeItems = observable.array([{ spec: { providerID: `oci://${INSTANCE_ID}` } }]);
      k8s.nodesStore.items = nodeItems;
      fetchVnicAttachmentsMock.mockResolvedValue({ ok: true, data: [attachment(INSTANCE_ID, VNIC_ID)] });
      fetchVnicMock.mockImplementation((vnicId: string) => Promise.resolve({ ok: true, data: { id: vnicId } }));
      const store = new OciClusterStore();

      store.ensureLoaded(CLUSTER_KEY, "topology");
      await vi.advanceTimersByTimeAsync(50);
      store.ensureLoaded("cluster-2", "topology");
      await vi.advanceTimersByTimeAsync(50);
      expect(fetchVnicAttachmentsMock).toHaveBeenCalledTimes(2);

      runInAction(() => nodeItems.push({ spec: { providerID: `oci://${NEW_INSTANCE_ID}` } }));
      await vi.advanceTimersByTimeAsync(2500);

      expect(fetchVnicAttachmentsMock).toHaveBeenCalledTimes(3);
      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
