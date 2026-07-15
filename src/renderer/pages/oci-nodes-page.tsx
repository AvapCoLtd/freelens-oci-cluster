import { NodeTab } from "../components/node-tab";
import { OciPageShell } from "./oci-page-shell";

// @freelensapp/coreがclusterPagesのPage登録時にobserver()で包むため、ここでは包まない(既知の制約)。
export function OciNodesPage() {
  return <OciPageShell page="nodes" renderLoaded={(data, region) => <NodeTab data={data} region={region} />} />;
}
