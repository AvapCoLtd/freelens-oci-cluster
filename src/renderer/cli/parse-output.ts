import type { OciCommandOutput } from "./command-defs";

/** stdoutがoci CLIのJSON契約(`{"data": …}`)から外れている場合。 */
export class OciStdoutShapeError extends Error {}

export interface OciParsedPage {
  /** `data`(collectionでは要素配列) */
  value: unknown;
  /** トップレベルの`opc-next-page`。最終ページではキー自体が無い */
  nextPage?: string;
}

function collectionItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data !== null && typeof data === "object") {
    const items = (data as Record<string, unknown>).items;
    if (Array.isArray(items)) return items;
  }
  throw new OciStdoutShapeError('oci output "data" is neither a list nor a collection');
}

/**
 * oci CLIのstdoutからデータ部を取り出す(キー表記は変換しない)。
 * getの`etag`は使わないため読み捨てる。
 */
export function parseOciStdout(stdout: string, output: OciCommandOutput): OciParsedPage {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    // 該当リソースが無いとき何も出力しないコマンドがある(exit 0 / stdout 0バイト)。
    if (output === "collection") return { value: [] };
    throw new OciStdoutShapeError("oci produced no output");
  }

  let root: unknown;
  try {
    root = JSON.parse(trimmed);
  } catch (error) {
    throw new OciStdoutShapeError(
      `oci output is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    throw new OciStdoutShapeError("oci output is not a JSON object");
  }

  const record = root as Record<string, unknown>;
  if (!("data" in record)) {
    throw new OciStdoutShapeError('oci output has no "data" key');
  }
  const nextPageValue = record["opc-next-page"];
  const nextPage = typeof nextPageValue === "string" ? nextPageValue : undefined;

  if (output === "collection") {
    return { value: collectionItems(record.data), nextPage };
  }
  const data = record.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new OciStdoutShapeError('oci output "data" is not an object');
  }
  return { value: data, nextPage };
}
