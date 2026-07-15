import { execFile } from "node:child_process";
import { type CliRawErrorInfo, classifyCliError } from "../match/classify-cli-error";
import { resolveOciCommand } from "../match/command-resolve";
import { parseBareArrayEnvelope, parseItemsEnvelope } from "../match/oci-envelope";
import type { CliResult } from "./types";

const TIMEOUT_MS = 60_000; // 設計: docker ラッパー経由の突発遅延を許容する実測ベースの値
const MAX_BUFFER = 32 * 1024 * 1024; // 既定1MBだとstructured-search等の大きい結果でtruncateするため引き上げる

function execOci(args: string[], overrideCommand: string): Promise<CliResult<string>> {
  const [command, ...prefixArgs] = resolveOciCommand(overrideCommand);
  const fullArgs = [...prefixArgs, ...args, "--output", "json"];

  return new Promise((resolvePromise) => {
    execFile(command, fullArgs, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        const raw: CliRawErrorInfo = { code: error.code, errno: error.errno, message: error.message, stderr };
        resolvePromise({ ok: false, kind: classifyCliError(raw), raw });
        return;
      }
      resolvePromise({ ok: true, data: stdout });
    });
  });
}

function toParseFailure(error: unknown): { ok: false; kind: "internal"; raw: CliRawErrorInfo } {
  return { ok: false, kind: "internal", raw: { message: (error as Error).message, stderr: "" } };
}

/** oci CLI をexecFileで実行し、`--output json`のJSONをパースして返す。失敗時は分類済みエラーを返す。 */
export async function runOci<T>(args: string[], overrideCommand: string): Promise<CliResult<T>> {
  const result = await execOci(args, overrideCommand);
  if (!result.ok) return result;
  try {
    return { ok: true, data: JSON.parse(result.data) as T };
  } catch (error) {
    return toParseFailure(error);
  }
}

/** "data"配列そのもの形式(instance/lb/volume list)専用。0件時の空stdoutも空配列として扱う。 */
export async function runOciBareArrayList<T>(args: string[], overrideCommand: string): Promise<CliResult<T[]>> {
  const result = await execOci(args, overrideCommand);
  if (!result.ok) return result;
  try {
    return { ok: true, data: parseBareArrayEnvelope<T>(result.data) };
  } catch (error) {
    return toParseFailure(error);
  }
}

/** "data.items"形式(nlb list, structured-search)専用。 */
export async function runOciItemsList<T>(args: string[], overrideCommand: string): Promise<CliResult<T[]>> {
  const result = await execOci(args, overrideCommand);
  if (!result.ok) return result;
  try {
    return { ok: true, data: parseItemsEnvelope<T>(result.data) };
  } catch (error) {
    return toParseFailure(error);
  }
}
