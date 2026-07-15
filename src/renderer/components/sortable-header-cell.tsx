import type * as React from "react";
import { TH_STYLE } from "./table-styles";
import type { ColumnSortState } from "./use-column-sort";

const SORT_ICON: Record<"asc" | "desc", string> = { asc: " ▲", desc: " ▼" };

const CLICKABLE_TH_STYLE: React.CSSProperties = {
  ...TH_STYLE,
  cursor: "pointer",
  userSelect: "none",
};

export interface SortableHeaderCellProps<K extends string> {
  column: K;
  sort: ColumnSortState<K>;
  onSort: (column: K) => void;
  children: React.ReactNode;
}

/** クリックで昇順/降順ソートを切り替える列ヘッダ(表示専用、storeのデータ順は変えない)。 */
export function SortableHeaderCell<K extends string>({ column, sort, onSort, children }: SortableHeaderCellProps<K>) {
  return (
    <th style={CLICKABLE_TH_STYLE} onClick={() => onSort(column)}>
      {children}
      {sort.column === column ? SORT_ICON[sort.direction] : ""}
    </th>
  );
}
