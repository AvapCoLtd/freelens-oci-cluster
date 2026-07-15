import { describe, expect, it } from "vitest";
import { matchServicesToLoadBalancers } from "./service-lb";

describe("matchServicesToLoadBalancers", () => {
  it("matches a service to the LB sharing its ingress IP", () => {
    const services = [{ namespace: "default", name: "web", ingressIps: ["10.0.0.1"] }];
    const lbs = [
      { ocid: "ocid1.loadbalancer.oc1.ap-tokyo-1.aaaa", kind: "lb" as const, ips: ["10.0.0.1", "10.0.0.2"] },
    ];
    expect(matchServicesToLoadBalancers(services, lbs)).toEqual([{ service: services[0], loadBalancer: lbs[0] }]);
  });

  it("marks services with no matching LB as unmatched (未対応)", () => {
    const services = [{ namespace: "default", name: "orphan", ingressIps: ["10.0.0.9"] }];
    expect(matchServicesToLoadBalancers(services, [])).toEqual([{ service: services[0], loadBalancer: null }]);
  });

  it("allows multiple services to match the same LB (many-to-one)", () => {
    const lb = { ocid: "ocid1.networkloadbalancer.oc1.ap-tokyo-1.aaaa", kind: "nlb" as const, ips: ["10.0.0.1"] };
    const services = [
      { namespace: "a", name: "svc-a", ingressIps: ["10.0.0.1"] },
      { namespace: "b", name: "svc-b", ingressIps: ["10.0.0.1"] },
    ];
    const result = matchServicesToLoadBalancers(services, [lb]);
    expect(result.every((r) => r.loadBalancer === lb)).toBe(true);
  });

  it("matches on private IPs too, not only the first IP in the set", () => {
    const services = [{ namespace: "default", name: "web", ingressIps: ["10.0.0.2"] }];
    const lbs = [
      { ocid: "ocid1.loadbalancer.oc1.ap-tokyo-1.aaaa", kind: "lb" as const, ips: ["10.0.0.1", "10.0.0.2"] },
    ];
    expect(matchServicesToLoadBalancers(services, lbs)[0].loadBalancer).toBe(lbs[0]);
  });
});
