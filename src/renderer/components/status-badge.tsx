import type * as React from "react";
import { isAbnormalLifecycleState } from "../match/lifecycle-state";

export type BadgeTone = "ok" | "fail" | "warn" | "info" | "muted";

const TONE_COLOR: Record<BadgeTone, string> = {
  ok: "var(--colorSuccess, #4caf50)",
  fail: "var(--colorError, #e05a5a)",
  warn: "var(--colorWarning, #c9a227)",
  info: "var(--colorInfo, #3d90ce)",
  muted: "var(--halfGray, #6b6f76)",
};

const BASE_STYLE: React.CSSProperties = {
  display: "inline-block",
  borderRadius: 3,
  padding: "1px 6px",
  fontSize: 11,
  whiteSpace: "nowrap",
  color: "#fff",
};

export function ToneBadge({ label, tone }: { label: React.ReactNode; tone: BadgeTone }) {
  return <span style={{ ...BASE_STYLE, background: TONE_COLOR[tone] }}>{label}</span>;
}

/** OCIリソースのlifecycle-state表示。未取得時は"-"をmutedで表示する。 */
export function LifecycleBadge({ state }: { state: string | undefined }) {
  if (!state) return <ToneBadge label="-" tone="muted" />;
  return <ToneBadge label={state} tone={isAbnormalLifecycleState(state) ? "fail" : "ok"} />;
}

export function ReadyBadge({ ready }: { ready: boolean }) {
  return <ToneBadge label={ready ? "Ready" : "NotReady"} tone={ready ? "ok" : "fail"} />;
}
