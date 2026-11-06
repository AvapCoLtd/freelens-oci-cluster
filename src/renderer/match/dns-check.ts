export interface IngressLike {
  spec?: {
    rules?: { host?: string }[];
    tls?: { hosts?: string[]; secretName?: string }[];
  };
}

export interface ServiceLike {
  metadata?: { annotations?: Partial<Record<string, string>> };
}

const EXTERNAL_DNS_HOSTNAME_ANNOTATION = "external-dns.kubernetes.io/hostname";
const EXTERNAL_DNS_HOSTNAME_ANNOTATION_LEGACY = "external-dns.alpha.kubernetes.io/hostname";

/** DNS突合対象のホスト名集合(Ingressのrules/tls + Serviceのexternal-dnsアノテーション)。 */
export function collectHostnames(ingresses: IngressLike[], services: ServiceLike[]): string[] {
  const hosts = new Set<string>();
  for (const ingress of ingresses) {
    for (const rule of ingress.spec?.rules ?? []) {
      if (rule.host) hosts.add(rule.host);
    }
    for (const tls of ingress.spec?.tls ?? []) {
      for (const host of tls.hosts ?? []) hosts.add(host);
    }
  }
  for (const service of services) {
    const annotations = service.metadata?.annotations;
    // 移行していないクラスタ向けに旧prefixも読む
    const annotation =
      annotations?.[EXTERNAL_DNS_HOSTNAME_ANNOTATION] ?? annotations?.[EXTERNAL_DNS_HOSTNAME_ANNOTATION_LEGACY];
    if (!annotation) continue;
    for (const host of annotation.split(",")) {
      const trimmed = host.trim();
      if (trimmed) hosts.add(trimmed);
    }
  }
  // ワイルドカードはresolveできないため除外(表示もしない)
  return [...hosts].filter((host) => !host.startsWith("*"));
}

export type DnsMatchKind = "matched" | "unmatched" | "unresolved";

export interface DnsMatchResult {
  kind: DnsMatchKind;
  /** 解決IPが一致したLB名(かクラスタLB IPそのもの) */
  matchedLbNames: string[];
}

/**
 * 解決IPとクラスタ関連LBのIP集合の突合。
 * unmatched = DNSがクラスタ外(古いLB等)を指している可能性(「繋がらない」の頻出原因)。
 */
export function matchDnsToLbs(
  resolvedIps: readonly string[],
  lbs: readonly { displayName?: string; ips: readonly string[] }[],
): DnsMatchResult {
  if (resolvedIps.length === 0) return { kind: "unresolved", matchedLbNames: [] };
  const matched = lbs.filter((lb) => lb.ips.some((ip) => resolvedIps.includes(ip)));
  if (matched.length === 0) return { kind: "unmatched", matchedLbNames: [] };
  return { kind: "matched", matchedLbNames: matched.map((lb) => lb.displayName ?? "(name unknown)") };
}
