export type SortDirection = "asc" | "desc";

/**
 * テーブル表示専用の並び替え(引数配列やstoreのデータ順は変更しない)。
 * ソート値がundefinedの行は方向によらず常に末尾に残す(欠損データが先頭に来て紛らわしくなるのを防ぐ)。
 */
export function sortRows<T>(
  rows: T[],
  getSortValue: (row: T) => string | number | undefined,
  direction: SortDirection,
): T[] {
  const withValue: T[] = [];
  const withoutValue: T[] = [];
  for (const row of rows) {
    (getSortValue(row) === undefined ? withoutValue : withValue).push(row);
  }
  withValue.sort((a, b) => {
    const av = getSortValue(a) as string | number;
    const bv = getSortValue(b) as string | number;
    if (av < bv) return direction === "asc" ? -1 : 1;
    if (av > bv) return direction === "asc" ? 1 : -1;
    return 0;
  });
  return [...withValue, ...withoutValue];
}
