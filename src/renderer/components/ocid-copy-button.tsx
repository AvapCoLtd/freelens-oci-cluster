import { Icon } from "./freelens-ui";
import { type CopyStatus, useCopyFeedback } from "./use-copy-feedback";

const ICON: Record<CopyStatus, string> = { idle: "content_copy", copied: "done", failed: "error_outline" };
const TOOLTIP: Record<CopyStatus, string> = { idle: "Copy OCID", copied: "Copied", failed: "Copy failed" };

export function OcidCopyButton({ ocid }: { ocid: string }) {
  const { status, copy } = useCopyFeedback();

  return (
    <Icon
      material={ICON[status]}
      tooltip={TOOLTIP[status]}
      interactive
      small
      onClick={() => copy(ocid, TOOLTIP.idle)}
    />
  );
}
