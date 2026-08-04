import type * as React from "react";
import type { InjectedStyle } from "./injected-style";

// Renderer.Component はSpinnerをexportしない(FreeLens 1.10.3のrenderer-api/componentsで確認)。
// 見た目はFreeLens本体のspinner.scssに合わせる(枠線幅=直径/6、1秒/回転)。
const SPINNER_CLASS = "oci-spinner";

export const SPINNER_STYLE: InjectedStyle = {
  id: SPINNER_CLASS,
  css: [
    `.${SPINNER_CLASS} {`,
    "  display: inline-block;",
    "  border-style: solid;",
    "  border-color: transparent var(--textColorSecondary, #9aa0a6) transparent transparent;",
    "  border-radius: 50%;",
    `  animation: ${SPINNER_CLASS}-rotate 1s linear infinite;`,
    "}",
    `@keyframes ${SPINNER_CLASS}-rotate { to { transform: rotate(360deg); } }`,
  ].join("\n"),
};

export interface SpinnerProps {
  /** 直径(px)。表の行内は12、セクション本体は24を使う。 */
  size?: number;
}

export function Spinner({ size = 24 }: SpinnerProps) {
  return (
    <span
      className={SPINNER_CLASS}
      role="progressbar"
      aria-label="Loading"
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 6)) }}
    />
  );
}

const BLOCK_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "16px 0",
};

/** セクション/テーブル本体の取得中表示。枠(見出し・テーブルヘッダ)は呼び出し側が先に確保する。 */
export function LoadingBlock() {
  return (
    <div style={BLOCK_STYLE}>
      <Spinner />
    </div>
  );
}
