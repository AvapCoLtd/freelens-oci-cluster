const SERVICE_NAME_LABEL = "kubernetes.io/service-name";

const LOCAL_TRAFFIC_POLICY = "Local";

export interface EndpointSliceInput {
  metadata: { namespace: string; labels?: Partial<Record<string, string>> };
  endpoints?: readonly { nodeName?: string; conditions?: { ready?: boolean } }[];
}

export interface LocalTrafficService {
  namespace: string;
  name: string;
  externalTrafficPolicy?: string;
}

/** Serviceの索引キー。EndpointSlice側とService側の両方をこの表記へ寄せる。 */
export function serviceKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

/** 未設定はClusterが既定のため偽。 */
export function isLocalTrafficPolicy(policy: string | undefined): boolean {
  return policy === LOCAL_TRAFFIC_POLICY;
}

/**
 * Service(`namespace/name`)→ready endpointを載せているノード名。
 * ready endpointが1件も無いServiceは載らない(格下げの判定材料が無い状態と同じ扱いになる)。
 * nodeNameを持たないendpointは、どのノードに居るか読めないため数えない。
 */
export function readyEndpointNodesOf(slices: readonly EndpointSliceInput[]): Map<string, Set<string>> {
  const byService = new Map<string, Set<string>>();
  for (const slice of slices) {
    const name = slice.metadata.labels?.[SERVICE_NAME_LABEL];
    if (!name) continue;
    const key = serviceKey(slice.metadata.namespace, name);
    for (const endpoint of slice.endpoints ?? []) {
      // conditions.ready 未設定はready扱い(EndpointSlice仕様)。除外するのはfalseが明示された場合だけ。
      if (endpoint.conditions?.ready === false || !endpoint.nodeName) continue;
      const nodes = byService.get(key);
      if (nodes) nodes.add(endpoint.nodeName);
      else byService.set(key, new Set([endpoint.nodeName]));
    }
  }
  return byService;
}

export function isNoLocalPod(
  services: readonly LocalTrafficService[],
  readyNodes: ReadonlyMap<string, ReadonlySet<string>>,
  nodeName: string,
): boolean {
  if (services.length === 0) return false;
  return services.every((service) => {
    if (!isLocalTrafficPolicy(service.externalTrafficPolicy)) return false;
    // ready endpointがクラスタ内のどこにも無いServiceは全ノードが落ちている状態であり、格下げしない。
    const nodes = readyNodes.get(serviceKey(service.namespace, service.name));
    return nodes !== undefined && nodes.size > 0 && !nodes.has(nodeName);
  });
}
