import type * as React from "react";
import { CLUSTER_TAG_KEY, type ClusterTagMismatch, clusterTagMismatchText } from "../match/cluster-tag";

const NOTE_STYLE: React.CSSProperties = {
  color: "var(--colorWarning, #c9a227)",
  fontSize: 12,
  wordBreak: "break-all",
};

export function ClusterTagNotes({ mismatches }: { mismatches: readonly ClusterTagMismatch[] }) {
  if (mismatches.length === 0) return null;
  return (
    <>
      {mismatches.map((mismatch) => (
        <div key={mismatch.source} style={NOTE_STYLE} title={`Tag: ${CLUSTER_TAG_KEY[mismatch.source]}`}>
          {clusterTagMismatchText(mismatch)}
        </div>
      ))}
    </>
  );
}
