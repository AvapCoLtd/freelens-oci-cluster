export interface ServiceLbMatchInput {
  namespace: string;
  name: string;
  ingressIps: string[];
  /** 以下はLB照合には使わない表示用属性(externalTrafficPolicy=LocalはbackendがCRITICALになる典型原因) */
  externalTrafficPolicy?: string;
  portsLabel?: string;
}

interface ServiceLike {
  spec: { type?: string };
  status?: { loadBalancer?: { ingress?: { ip?: string }[] } };
}

/** type=LoadBalancerのServiceのingress IP集合(networkページのクラスタ関連LB判定=経路2に使う)。 */
export function ingressIpsOfServices(services: ServiceLike[]): string[] {
  const ips = new Set<string>();
  for (const service of services) {
    if (service.spec.type !== "LoadBalancer") continue;
    for (const ingress of service.status?.loadBalancer?.ingress ?? []) {
      if (ingress.ip) ips.add(ingress.ip);
    }
  }
  return [...ips];
}

export interface LoadBalancerCandidate {
  ocid: string;
  kind: "nlb" | "lb";
  ips: string[];
}

export interface ServiceLbMatch {
  service: ServiceLbMatchInput;
  loadBalancer: LoadBalancerCandidate | null;
}

/**
 * Service の ingress IP と LB の IP 集合(public/private 両方)を完全一致で照合する。
 * 複数ServiceがひとつのLBに一致する多対一を許容する(設計Decision #12)。一致しなければ未対応(null)。
 */
export function matchServicesToLoadBalancers(
  services: ServiceLbMatchInput[],
  loadBalancers: LoadBalancerCandidate[],
): ServiceLbMatch[] {
  return services.map((service) => ({
    service,
    loadBalancer: loadBalancers.find((lb) => lb.ips.some((ip) => service.ingressIps.includes(ip))) ?? null,
  }));
}
