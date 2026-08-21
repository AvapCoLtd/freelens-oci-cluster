import * as React from "react";

const COPIED_RESET_MS = 1500;

export type CopyStatus = "idle" | "copied" | "failed";

/** クリップボードへの書き出しと、その結果をボタンに一定時間出してidleへ戻す表示状態。 */
export function useCopyFeedback(): { status: CopyStatus; copy: (text: string) => void } {
  const [status, setStatus] = React.useState<CopyStatus>("idle");
  const resetTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = React.useRef(true);
  // アンマウント後・連打時の発火をここで止めないと、消えたコンポーネントへのsetStateが残る。
  React.useEffect(
    () => () => {
      mountedRef.current = false;
      clearTimeout(resetTimer.current);
    },
    [],
  );

  const show = (next: CopyStatus) => {
    if (!mountedRef.current) return;
    setStatus(next);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), COPIED_RESET_MS);
  };

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => show("copied"))
      .catch((error: unknown) => {
        console.error("[freelens-oci-cluster] clipboard write failed", error);
        show("failed");
      });
  };

  return { status, copy };
}
