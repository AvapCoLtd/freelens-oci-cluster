import * as React from "react";

export interface SearchState {
  query: string;
  setQuery: (query: string) => void;
}

/** テーブル絞り込み用の検索文字列を保持する(resetKeyが変わった時のみ空に戻す)。 */
export function useSearchQuery(resetKey?: string): SearchState {
  const [query, setQuery] = React.useState("");
  const [previousKey, setPreviousKey] = React.useState(resetKey);
  if (previousKey !== resetKey) {
    setPreviousKey(resetKey);
    // useEffectに移さない: 古いqueryのまま1フレーム描画してしまう。
    setQuery("");
  }
  return { query, setQuery };
}
