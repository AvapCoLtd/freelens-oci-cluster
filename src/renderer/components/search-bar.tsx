import type * as React from "react";
import { SearchInput } from "./freelens-ui";

const SEARCH_BAR_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginBottom: 8,
};

export interface SearchBarProps {
  query: string;
  onChange: (query: string) => void;
  placeholder?: string;
}

/** テーブル上部に置く絞り込み入力(表示専用、storeのデータは変えない)。 */
export function SearchBar({ query, onChange, placeholder }: SearchBarProps) {
  return (
    <div style={SEARCH_BAR_STYLE}>
      <SearchInput
        compact
        showClearIcon
        value={query}
        placeholder={placeholder}
        onChange={onChange}
        onClear={() => onChange("")}
      />
    </div>
  );
}
