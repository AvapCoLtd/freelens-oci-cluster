import { ServiceLbTab } from "../components/service-lb-tab";
import { OciPageShell } from "./oci-page-shell";

// observer()で包まない: FreeLensが登録時に包むため、二重になってthrowする。
export function OciServiceLbPage() {
  return (
    <OciPageShell
      page="service-lb"
      renderLoaded={(data, region, _clusterKey, search, clusterId) => (
        <ServiceLbTab data={data} region={region} search={search} clusterId={clusterId} />
      )}
    />
  );
}
