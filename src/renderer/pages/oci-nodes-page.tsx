import { NodeTab } from "../components/node-tab";
import { OciPageShell } from "./oci-page-shell";

// observer()で包まない: FreeLensが登録時に包むため、二重になってthrowする。
export function OciNodesPage() {
  return (
    <OciPageShell
      page="nodes"
      renderLoaded={(data, region, _clusterKey, search, clusterId) => (
        <NodeTab data={data} region={region} search={search} clusterId={clusterId} />
      )}
    />
  );
}
