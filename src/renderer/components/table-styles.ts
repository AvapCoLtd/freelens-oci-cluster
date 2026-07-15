import type * as React from "react";

export const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  color: "var(--textColorPrimary, #fff)",
};

export const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  borderBottom: "1px solid var(--borderColor, #3f4041)",
  color: "var(--textColorSecondary, #9aa0a6)",
  fontWeight: "normal",
  whiteSpace: "nowrap",
};

export const TD_STYLE: React.CSSProperties = {
  padding: "6px 10px",
  borderBottom: "1px solid var(--borderColor, #3f4041)",
  verticalAlign: "middle",
};

export const UNMATCHED_ROW_STYLE: React.CSSProperties = {
  color: "var(--textColorSecondary, #9aa0a6)",
  fontStyle: "italic",
};
