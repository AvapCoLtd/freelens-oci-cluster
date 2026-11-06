import { describe, expect, it } from "vitest";
import {
  type EndpointSliceInput,
  isLocalTrafficPolicy,
  isNoLocalPod,
  readyEndpointNodesOf,
  serviceKey,
} from "./local-traffic-policy";

function slice(
  namespace: string,
  serviceName: string | undefined,
  endpoints: { nodeName?: string; ready?: boolean }[],
): EndpointSliceInput {
  return {
    metadata: {
      namespace,
      labels: serviceName === undefined ? {} : { "kubernetes.io/service-name": serviceName },
    },
    endpoints: endpoints.map((endpoint) => ({
      nodeName: endpoint.nodeName,
      conditions: { ready: endpoint.ready },
    })),
  };
}

const LOCAL = { namespace: "app", name: "web", externalTrafficPolicy: "Local" };
const CLUSTER = { namespace: "app", name: "web", externalTrafficPolicy: "Cluster" };

describe("serviceKey", () => {
  it("namespaceとnameを1つのキーへ畳む", () => {
    expect(serviceKey("app", "web")).toBe("app/web");
  });
});

describe("isLocalTrafficPolicy", () => {
  it("Localだけを真とし、未設定・Clusterは偽", () => {
    expect(isLocalTrafficPolicy("Local")).toBe(true);
    expect(isLocalTrafficPolicy("Cluster")).toBe(false);
    expect(isLocalTrafficPolicy(undefined)).toBe(false);
  });
});

describe("readyEndpointNodesOf", () => {
  it("ready endpointのノード名をService単位に集める", () => {
    const nodes = readyEndpointNodesOf([
      slice("app", "web", [
        { nodeName: "node-1", ready: true },
        { nodeName: "node-2", ready: true },
      ]),
    ]);
    expect([...(nodes.get("app/web") ?? [])].sort()).toEqual(["node-1", "node-2"]);
  });

  it("同じServiceの複数EndpointSliceを1つへ合流させる", () => {
    const nodes = readyEndpointNodesOf([
      slice("app", "web", [{ nodeName: "node-1", ready: true }]),
      slice("app", "web", [{ nodeName: "node-2", ready: true }]),
    ]);
    expect([...(nodes.get("app/web") ?? [])].sort()).toEqual(["node-1", "node-2"]);
  });

  it("namespaceが違うServiceは別のキーになる", () => {
    const nodes = readyEndpointNodesOf([
      slice("app", "web", [{ nodeName: "node-1", ready: true }]),
      slice("ops", "web", [{ nodeName: "node-2", ready: true }]),
    ]);
    expect([...(nodes.get("app/web") ?? [])]).toEqual(["node-1"]);
    expect([...(nodes.get("ops/web") ?? [])]).toEqual(["node-2"]);
  });

  it("ready:false・nodeName無しのendpointは数えない", () => {
    const nodes = readyEndpointNodesOf([slice("app", "web", [{ nodeName: "node-1", ready: false }, { ready: true }])]);
    expect(nodes.has("app/web")).toBe(false);
  });

  it("conditions.ready未設定のendpointはready扱いで数える", () => {
    const nodes = readyEndpointNodesOf([slice("app", "web", [{ nodeName: "node-2" }])]);
    expect([...(nodes.get("app/web") ?? [])]).toEqual(["node-2"]);
  });

  it("service-nameラベルを持たないEndpointSliceは載せない", () => {
    expect([...readyEndpointNodesOf([slice("app", undefined, [{ nodeName: "node-1", ready: true }])])]).toEqual([]);
  });

  it("endpointsを持たないEndpointSliceも載せない", () => {
    const nodes = readyEndpointNodesOf([
      { metadata: { namespace: "app", labels: { "kubernetes.io/service-name": "web" } } },
    ]);
    expect(nodes.has("app/web")).toBe(false);
  });
});

describe("isNoLocalPod", () => {
  const readyOnNode2 = readyEndpointNodesOf([slice("app", "web", [{ nodeName: "node-2", ready: true }])]);

  it("Localかつ当該ノードにready endpointが無ければ真", () => {
    expect(isNoLocalPod([LOCAL], readyOnNode2, "node-1")).toBe(true);
  });

  it("当該ノードにready endpointがあれば偽", () => {
    expect(isNoLocalPod([LOCAL], readyOnNode2, "node-2")).toBe(false);
  });

  it("externalTrafficPolicyがLocalでなければ偽", () => {
    expect(isNoLocalPod([CLUSTER], readyOnNode2, "node-1")).toBe(false);
    expect(isNoLocalPod([{ namespace: "app", name: "web" }], readyOnNode2, "node-1")).toBe(false);
  });

  it("ready endpointがクラスタ内のどこにも無ければ偽", () => {
    expect(isNoLocalPod([LOCAL], new Map(), "node-1")).toBe(false);
  });

  it("対応Serviceが1つも無ければ偽", () => {
    expect(isNoLocalPod([], readyOnNode2, "node-1")).toBe(false);
  });

  it("複数Serviceは全てが説明できるときだけ真", () => {
    const ready = readyEndpointNodesOf([
      slice("app", "web", [{ nodeName: "node-2", ready: true }]),
      slice("app", "api", [{ nodeName: "node-2", ready: true }]),
    ]);
    const api = { namespace: "app", name: "api", externalTrafficPolicy: "Local" };
    expect(isNoLocalPod([LOCAL, api], ready, "node-1")).toBe(true);
    expect(isNoLocalPod([LOCAL, { ...api, externalTrafficPolicy: "Cluster" }], ready, "node-1")).toBe(false);
  });
});
