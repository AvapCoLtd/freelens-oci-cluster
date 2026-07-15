/**
 * list系("data"が配列そのもの、例: instance/lb/volume list)のCLI応答をパースする。
 * 結果0件時にstdoutが完全に空文字になるコマンドがある(実機のoci CLI 3.56.0で確認済み)ため、
 * その場合はJSON.parseを試みず空配列として扱う。
 */
export function parseBareArrayEnvelope<T>(stdout: string): T[] {
  if (stdout.trim() === "") return [];
  return (JSON.parse(stdout) as { data: T[] }).data;
}

/** "data.items"形式(nlb list, structured-search等)のCLI応答をitems配列としてパースする。 */
export function parseItemsEnvelope<T>(stdout: string): T[] {
  return (JSON.parse(stdout) as { data: { items: T[] } }).data.items;
}
