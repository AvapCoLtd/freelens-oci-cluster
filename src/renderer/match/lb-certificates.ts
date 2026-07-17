import { X509Certificate } from "node:crypto";
import type { OciLoadBalancer } from "../sdk/types";

export interface LbCertInfo {
  name: string;
  /** ISO 8601。パース失敗時はundefined */
  validTo?: string;
  subject?: string;
  sans?: string;
  parseError?: boolean;
  /** この証明書を使うlistener名 */
  listenerNames: string[];
}

// publicCertificateはチェーン連結PEMのことがある。先頭ブロック(リーフ証明書)だけをパース対象にする。
const FIRST_CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/;

function parsePem(pem: string | undefined): Pick<LbCertInfo, "validTo" | "subject" | "sans" | "parseError"> {
  const block = pem?.match(FIRST_CERT_BLOCK)?.[0];
  if (!block) return { parseError: true };
  try {
    const cert = new X509Certificate(block);
    return {
      validTo: new Date(cert.validTo).toISOString(),
      subject: cert.subject?.replace(/\n/g, ", "),
      sans: cert.subjectAltName,
    };
  } catch {
    return { parseError: true };
  }
}

/**
 * classic LBのlistener証明書一覧(期限はHTTPS不通の定番原因)。
 * PEMはlb get応答に同梱されているため追加取得なしでパースできる。
 */
export function lbCertificateRows(lb: OciLoadBalancer): LbCertInfo[] {
  const listenersByCert = new Map<string, string[]>();
  for (const [listenerName, listener] of Object.entries(lb.listeners ?? {})) {
    const certName = (listener as { sslConfiguration?: { certificateName?: string } }).sslConfiguration
      ?.certificateName;
    if (!certName) continue;
    listenersByCert.set(certName, [...(listenersByCert.get(certName) ?? []), listenerName]);
  }
  return Object.values(lb.certificates ?? {}).map((cert) => ({
    name: cert.certificateName,
    ...parsePem(cert.publicCertificate),
    listenerNames: listenersByCert.get(cert.certificateName) ?? [],
  }));
}

/** listenerのcertificate-ids(Certificatesサービス方式)を重複なしで集める。期限はAPIで別途引く。 */
export function managedCertificateIdsOf(lb: OciLoadBalancer): string[] {
  const ids = new Set<string>();
  for (const listener of Object.values(lb.listeners ?? {})) {
    const certIds = (listener as { sslConfiguration?: { certificateIds?: string[] } }).sslConfiguration?.certificateIds;
    for (const id of certIds ?? []) ids.add(id);
  }
  return [...ids];
}

/** 期限までの残日数(負=期限切れ)。表示時にDate.now()を渡す(パース結果は純粋に保つ)。 */
export function daysUntil(validToIso: string | undefined, nowMs: number): number | undefined {
  if (!validToIso) return undefined;
  return Math.floor((new Date(validToIso).getTime() - nowMs) / 86_400_000);
}
