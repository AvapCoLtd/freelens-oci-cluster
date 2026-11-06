import type { TopologyGraph } from "../match/topology-graph";
import { type TopologyMermaidMeta, toMermaid } from "../match/topology-mermaid";
import { Icon } from "./freelens-ui";
import { type CopyStatus, useCopyFeedback } from "./use-copy-feedback";

const ICON: Record<CopyStatus, string> = { idle: "account_tree", copied: "done", failed: "error_outline" };
const TOOLTIP: Record<CopyStatus, string> = { idle: "Copy as Mermaid", copied: "Copied", failed: "Copy failed" };

export function TopologyMermaidCopyButton({ graph, meta }: { graph?: TopologyGraph; meta?: TopologyMermaidMeta }) {
  const { status, copy } = useCopyFeedback();

  return (
    <Icon
      material={ICON[status]}
      tooltip={TOOLTIP[status]}
      interactive
      small
      disabled={!graph}
      onClick={() => {
        if (graph) copy(toMermaid(graph, meta), TOOLTIP.idle);
      }}
    />
  );
}
