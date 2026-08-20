/** 検索対象値。OCI CLIは未設定を明示的nullで返すため、undefinedと同じく除外する。 */
export type SearchText = string | number | undefined | null;

function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function matchesTokens(values: readonly SearchText[], tokens: readonly string[]): boolean {
  const haystack = values.filter((v) => v !== undefined && v !== null).map((v) => String(v).toLowerCase());
  return tokens.every((token) => haystack.some((text) => text.includes(token)));
}

/**
 * 単一行分の検索対象値が、クエリに一致するか(空白区切りの各トークンがANDで部分一致)。
 * 空クエリは常に一致とみなす。
 */
export function matchesQuery(values: readonly SearchText[], query: string): boolean {
  const tokens = tokenize(query);
  return tokens.length === 0 || matchesTokens(values, tokens);
}

/**
 * テーブル表示専用の絞り込み(引数配列やstoreのデータ順は変更しない)。
 * 空白区切りの各トークンが、いずれかの検索対象値に部分一致する行だけを残す(トークン間はAND)。
 */
export function filterRows<T>(
  rows: readonly T[],
  query: string,
  getSearchText: (row: T) => readonly SearchText[],
): T[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [...rows];
  return rows.filter((row) => matchesTokens(getSearchText(row), tokens));
}
