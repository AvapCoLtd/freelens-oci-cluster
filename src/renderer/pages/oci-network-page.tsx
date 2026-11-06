import { NetworkTab } from "../components/network-tab";
import { OciPageShell } from "./oci-page-shell";

// observer()で包まない: FreeLensが登録時に包むため、二重になってthrowする。
export function OciNetworkPage() {
  return (
    <OciPageShell
      page="network"
      renderLoaded={(data, region, clusterKey, search, clusterId) => (
        <NetworkTab data={data} region={region} clusterKey={clusterKey} search={search} clusterId={clusterId} />
      )}
    />
  );
}
