import type * as React from "react";
import { isAbnormalLifecycleState } from "../match/lifecycle-state";
import { Badge } from "./freelens-ui";

export type StatusTone = "success" | "error" | "neutral";

const TONE_STYLE: Record<StatusTone, React.CSSProperties> = {
  success: { background: "var(--colorSuccess, #4caf50)", color: "#fff" },
  error: { background: "var(--colorError, #e05a5a)", color: "#fff" },
  neutral: { background: "var(--halfGray, #6b6f76)", color: "#fff" },
};

/** lifecycle-state・K8s Ready等の状態表示を、FreeLensのBadge(pill形状)で正常=success系/異常=error系に色分けする。 */
export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return <Badge label={label} small style={TONE_STYLE[tone]} />;
}

/** OCIリソースのlifecycle-state表示(設計:表示フィールド)。未取得時は"-"をneutralで表示する。 */
export function LifecycleBadge({ state }: { state: string | undefined }) {
  if (!state) return <StatusBadge label="-" tone="neutral" />;
  return <StatusBadge label={state} tone={isAbnormalLifecycleState(state) ? "error" : "success"} />;
}

export function ReadyBadge({ ready }: { ready: boolean }) {
  return <StatusBadge label={ready ? "Ready" : "NotReady"} tone={ready ? "success" : "error"} />;
}
