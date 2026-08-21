const OCI_PROVIDER_PREFIX = "oci://";
// CLI引数へ渡す値。前置一致だけだと末尾に$(...)を仕込める(シェル経由のoci互換コマンドで展開される)。
const INSTANCE_OCID_PATTERN = /^ocid1\.instance\.[a-z0-9]+\.[a-z0-9_-]*\.[a-z0-9]+$/;

export type ProviderIdParseResult = { isOke: true; instanceId: string } | { isOke: false };

/**
 * K8s Node の spec.providerID をパースし、OKE(OCI)由来かを判定する。
 * CCMのproviderID形式("oci://<instance ocid>"と素のOCIDの両方)を許容する。
 */
export function parseProviderId(providerId: string | undefined | null): ProviderIdParseResult {
  if (!providerId) return { isOke: false };
  const stripped = providerId.startsWith(OCI_PROVIDER_PREFIX)
    ? providerId.slice(OCI_PROVIDER_PREFIX.length)
    : providerId;
  if (!INSTANCE_OCID_PATTERN.test(stripped)) return { isOke: false };
  return { isOke: true, instanceId: stripped };
}

/**
 * 複数NodeのproviderIDからアンカー解決に使うInstance OCIDを1件選ぶ。
 * 同一クラスタのNodeはどれも同じクラスタに属するため、最初にOKE形式と判定できた1件で足りる。
 */
export function pickAnchorInstanceId(providerIds: (string | undefined | null)[]): string | undefined {
  for (const providerId of providerIds) {
    const parsed = parseProviderId(providerId);
    if (parsed.isOke) return parsed.instanceId;
  }
  return undefined;
}
