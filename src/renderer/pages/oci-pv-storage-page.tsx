import { PvStorageTab } from "../components/pv-storage-tab";
import { OciPageShell } from "./oci-page-shell";

// observer()で包まない: FreeLensが登録時に包むため、二重になってthrowする。
export function OciPvStoragePage() {
  return (
    <OciPageShell
      page="pv-storage"
      renderLoaded={(data, region, _clusterKey, search, clusterId) => (
        <PvStorageTab data={data} region={region} search={search} clusterId={clusterId} />
      )}
    />
  );
}
