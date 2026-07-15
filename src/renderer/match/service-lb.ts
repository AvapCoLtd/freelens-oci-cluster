export interface ServiceLbMatchInput {
  namespace: string;
  name: string;
  ingressIps: string[];
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
