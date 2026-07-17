import { NetworkTab } from "../components/network-tab";
import { OciPageShell } from "./oci-page-shell";

// @freelensapp/coreがclusterPagesのPage登録時にobserver()で包むため、ここでは包まない(既知の制約)。
export function OciNetworkPage() {
  return (
    <OciPageShell
      page="network"
      renderLoaded={(data, region, clusterKey) => <NetworkTab data={data} region={region} clusterKey={clusterKey} />}
    />
  );
}
