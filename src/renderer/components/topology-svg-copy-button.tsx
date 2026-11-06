import type { TopologyFlow } from "../match/topology-flow";
import { type TopologySvgMeta, toSvg } from "../match/topology-svg";
import { Icon } from "./freelens-ui";
import { type CopyStatus, useCopyFeedback } from "./use-copy-feedback";

const ICON: Record<CopyStatus, string> = { idle: "image", copied: "done", failed: "error_outline" };
const TOOLTIP: Record<CopyStatus, string> = { idle: "Copy as SVG", copied: "Copied", failed: "Copy failed" };

export function TopologySvgCopyButton({ flow, meta }: { flow?: TopologyFlow; meta?: TopologySvgMeta }) {
  const { status, copy } = useCopyFeedback();

  return (
    <Icon
      material={ICON[status]}
      tooltip={TOOLTIP[status]}
      interactive
      small
      disabled={!flow}
      onClick={() => {
        if (flow) copy(toSvg(flow, meta), TOOLTIP.idle);
      }}
    />
  );
}
