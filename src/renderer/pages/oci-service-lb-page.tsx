import { ServiceLbTab } from "../components/service-lb-tab";
import { OciPageShell } from "./oci-page-shell";

// @freelensapp/coreがclusterPagesのPage登録時にobserver()で包むため、ここでは包まない(既知の制約)。
export function OciServiceLbPage() {
  return (
    <OciPageShell page="service-lb" renderLoaded={(data, region) => <ServiceLbTab data={data} region={region} />} />
  );
}
