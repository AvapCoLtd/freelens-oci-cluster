import { PvStorageTab } from "../components/pv-storage-tab";
import { OciPageShell } from "./oci-page-shell";

// @freelensapp/coreがclusterPagesのPage登録時にobserver()で包むため、ここでは包まない(既知の制約)。
export function OciPvStoragePage() {
  return (
    <OciPageShell page="pv-storage" renderLoaded={(data, region) => <PvStorageTab data={data} region={region} />} />
  );
}
