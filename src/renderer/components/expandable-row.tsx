import * as React from "react";
import { Icon } from "./freelens-ui";
import { TD_STYLE } from "./table-styles";

export interface ExpandableRowProps {
  /** サマリ行のセル群(<td>を並べる)。先頭に展開ボタンセルが自動で付く。 */
  cells: React.ReactNode;
  /** 展開領域(行全体幅)。 */
  renderDetail: () => React.ReactNode;
  colSpan: number;
  onExpand?: () => void;
  rowStyle?: React.CSSProperties;
}

const DETAIL_CELL_STYLE: React.CSSProperties = {
  padding: "8px 12px 12px 32px",
  borderBottom: "1px solid var(--borderFaintColor, #2d2f31)",
  background: "var(--layoutBackground, #24272b)",
};

// inline styleは:hoverを表現できないためスタイルを注入する。色はFreeLens標準テーブルの選択行と同じCSS変数に寄せる。
const HOVER_CLASS = "oci-expandable-row";

/** 拡張機能の有効化時に呼ぶ。既に注入済みなら何もしない(冪等)。 */
export function ensureExpandableRowStyle(): void {
  if (typeof document === "undefined" || document.getElementById(HOVER_CLASS)) return;
  const style = document.createElement("style");
  style.id = HOVER_CLASS;
  style.textContent = `.${HOVER_CLASS}:hover { background: var(--tableSelectedRowBackground, rgba(255, 255, 255, 0.06)); }`;
  document.head.appendChild(style);
}

/** 拡張機能の無効化時に呼ぶ。未注入なら何もしない(冪等)。 */
export function removeExpandableRowStyle(): void {
  document.getElementById(HOVER_CLASS)?.remove();
}

const TOGGLE_BUTTON_STYLE: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "inherit",
};

// セル内のコピー/コンソール/再取得等の操作要素。これらのクリックは行の開閉に使わない。
const INTERACTIVE_SELECTOR = "button, a, input, i, svg, [role='button']";

/**
 * 行クリックで直下に詳細を挿入する行。展開状態はローカルstate(storeに持たない)。
 * キーボード操作は行頭の展開ボタンが担う(行のonClickはマウス向けの補助)。
 */
export function ExpandableRow({ cells, renderDetail, colSpan, onExpand, rowStyle }: ExpandableRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onExpand?.();
  };
  const onRowClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR)) return;
    toggle();
  };
  return (
    <>
      <tr className={HOVER_CLASS} style={{ cursor: "pointer", ...rowStyle }} onClick={onRowClick}>
        <td style={{ ...TD_STYLE, width: 24 }}>
          <button type="button" onClick={toggle} style={TOGGLE_BUTTON_STYLE} title={expanded ? "Collapse" : "Expand"}>
            <Icon material={expanded ? "expand_more" : "chevron_right"} small />
          </button>
        </td>
        {cells}
      </tr>
      {expanded && (
        <tr>
          <td style={DETAIL_CELL_STYLE} colSpan={colSpan + 1}>
            {renderDetail()}
          </td>
        </tr>
      )}
    </>
  );
}
