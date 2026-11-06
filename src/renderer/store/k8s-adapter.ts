import { Renderer } from "@freelensapp/extensions";
import { getCsiSource } from "../match/pv-storage";
import type {
  TopologyK8sEndpointSlice,
  TopologyK8sNode,
  TopologyK8sPv,
  TopologyK8sService,
} from "../match/topology-graph";

export interface TopologyK8sInput {
  nodes: TopologyK8sNode[];
  services: TopologyK8sService[];
  persistentVolumes: TopologyK8sPv[];
  endpointSlices: TopologyK8sEndpointSlice[];
}

/** 進捗表示の分母に数える、K8s側3ストアそれぞれの初回ロード完了。 */
export interface TopologyK8sLoaded {
  nodes: boolean;
  services: boolean;
  persistentVolumes: boolean;
}

export interface TopologyK8sState {
  input: TopologyK8sInput;
  loaded: TopologyK8sLoaded;
}

function nodeOf(node: Renderer.K8sApi.Node): TopologyK8sNode {
  return {
    metadata: { name: node.getName() },
    spec: { providerID: node.spec.providerID },
    status: {
      addresses: (node.status?.addresses ?? []).map((address) => ({
        type: address.type,
        address: address.address,
      })),
    },
  };
}

function serviceOf(service: Renderer.K8sApi.Service): TopologyK8sService {
  return {
    metadata: { name: service.getName(), namespace: service.getNs() ?? "" },
    spec: { type: service.spec.type, externalTrafficPolicy: service.spec.externalTrafficPolicy },
    status: {
      loadBalancer: {
        ingress: (service.status?.loadBalancer?.ingress ?? []).map((ingress) => ({ ip: ingress.ip })),
      },
    },
  };
}

// endpointsはaddress・targetRefまで載せると再導出の判定に使うJSONが桁で膨らむ。読む2値だけへ落とす。
function endpointSliceOf(slice: Renderer.K8sApi.EndpointSlice): TopologyK8sEndpointSlice {
  return {
    metadata: { namespace: slice.getNs() ?? "", labels: slice.metadata.labels },
    endpoints: (slice.endpoints ?? []).map((endpoint) => ({
      nodeName: endpoint.nodeName,
      conditions: { ready: endpoint.conditions?.ready },
    })),
  };
}

function pvOf(pv: Renderer.K8sApi.PersistentVolume): TopologyK8sPv {
  const csi = getCsiSource(pv.spec);
  return {
    metadata: { name: pv.getName() },
    spec: {
      csi: csi ? { driver: csi.driver, volumeHandle: csi.volumeHandle } : undefined,
      capacity: { storage: pv.spec.capacity?.storage },
    },
  };
}

/**
 * トポロジー図が読むK8sリソースの取得口。
 * ここに寄せることで、MOCKビルドはOCI取得層と同じVite aliasの一手でK8s側もダミーへ差し替えられる。
 */
export function subscribeTopologyK8s(): () => void {
  const disposers = [
    Renderer.K8sApi.nodesStore.subscribe(),
    Renderer.K8sApi.serviceStore.subscribe(),
    Renderer.K8sApi.persistentVolumeStore.subscribe(),
    Renderer.K8sApi.endpointSliceStore.subscribe(),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** 導出層が読むフィールドだけに射影して返す。呼び出しごとに新しい配列を返す(同一性は呼び出し側で管理する)。 */
export function readTopologyK8s(): TopologyK8sState {
  const nodesStore = Renderer.K8sApi.nodesStore;
  const serviceStore = Renderer.K8sApi.serviceStore;
  const pvStore = Renderer.K8sApi.persistentVolumeStore;
  const lbServiceKeys = new Set(
    serviceStore.items
      .filter((service) => service.spec.type === "LoadBalancer")
      .map((service) => `${service.getNs() ?? ""}/${service.getName()}`),
  );
  const lbEndpointSlices = Renderer.K8sApi.endpointSliceStore.items.filter((slice) => {
    const serviceName = slice.metadata.labels?.["kubernetes.io/service-name"];
    return serviceName !== undefined && lbServiceKeys.has(`${slice.getNs() ?? ""}/${serviceName}`);
  });
  return {
    input: {
      nodes: nodesStore.items.map(nodeOf),
      services: serviceStore.items.map(serviceOf),
      persistentVolumes: pvStore.items.map(pvOf),
      // loadedへ数えない: 取れなくても図はbackendエッジの格下げが起きないだけで成立する。
      endpointSlices: lbEndpointSlices.map(endpointSliceOf),
    },
    loaded: {
      nodes: nodesStore.isLoaded,
      services: serviceStore.isLoaded,
      persistentVolumes: pvStore.isLoaded,
    },
  };
}
