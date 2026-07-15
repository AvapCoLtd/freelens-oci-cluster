/**
 * OCID(`ocid1.<type>.<realm>.<region>.<unique id>`)からregionセグメントを抽出する。
 * realm直後のregionセグメントが空のOCID(例: tenancy)はundefinedを返す。
 * FSSのOCIDはregion部がアンダースコア区切りで出現する(実機確認済み: `ap_tokyo_1`)ため、
 * コンソールURL等のハイフン区切り形式(`ap-tokyo-1`)に正規化する。
 */
export function extractRegionFromOcid(ocid: string): string | undefined {
  const region = ocid.split(".")[3];
  return region ? region.replace(/_/g, "-") : undefined;
}
