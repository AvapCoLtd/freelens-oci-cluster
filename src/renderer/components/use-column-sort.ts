import * as React from "react";
import type { SortDirection } from "../match/sort-rows";

export interface ColumnSortState<K extends string> {
  column: K;
  direction: SortDirection;
}

/** 同じ列を再クリックで昇順/降順を反転、他列クリックでその列の昇順に切り替える(表示専用)。 */
export function useColumnSort<K extends string>(initialColumn: K): [ColumnSortState<K>, (column: K) => void] {
  const [state, setState] = React.useState<ColumnSortState<K>>({ column: initialColumn, direction: "asc" });
  const toggle = (column: K) => {
    setState((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  };
  return [state, toggle];
}
