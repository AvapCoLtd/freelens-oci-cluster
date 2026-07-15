import type * as React from "react";

const EMPTY_STYLE: React.CSSProperties = {
  padding: "16px 0",
  color: "var(--textColorSecondary, #9aa0a6)",
  fontSize: 13,
};

/** 読み込み中/該当データなしの表示に使う(テーブルのヘッダ行だけが残る空状態を避ける)。 */
export function EmptyState({ message }: { message: string }) {
  return <div style={EMPTY_STYLE}>{message}</div>;
}
