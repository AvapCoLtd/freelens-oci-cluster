import * as React from "react";
import { Icon } from "./freelens-ui";

const COPIED_RESET_MS = 1500;

export function OcidCopyButton({ ocid }: { ocid: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleClick = () => {
    navigator.clipboard
      .writeText(ocid)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_RESET_MS);
      })
      .catch((error: unknown) => console.error("[freelens-oci-cluster] clipboard write failed", error));
  };

  return (
    <Icon
      material={copied ? "done" : "content_copy"}
      tooltip={copied ? "コピーしました" : "OCIDをコピー"}
      interactive
      small
      onClick={handleClick}
    />
  );
}
