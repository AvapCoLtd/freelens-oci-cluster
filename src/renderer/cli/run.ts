import type { OciExecResult } from "../../common/oci-ipc";
import type { OciResult } from "../oci/result";
import { invokeExecOci } from "../oci-ipc";
import { classifyOciCliFailure } from "./classify-error";
import type { OciCommandDef } from "./command-defs";
import { parseOciStdout } from "./parse-output";

const DEFAULT_OCI_COMMAND = "oci";
/** 同時に起動するociプロセス数の上限(プロセス起動スパイクの抑制) */
export const MAX_CONCURRENT_PROCESSES = 8;
/** 手動ページングの打ち切り(ページトークンが終わらない実装を無限ループさせない) */
const MAX_PAGES = 100;
const MAX_ITEMS = 50_000;
// 1ページごとのタイムアウト(main側)は全体の待ち時間を縛らない(MAX_PAGES分積み上がる)。
const PAGING_DEADLINE_MS = 5 * 60 * 1000;

let running = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT_PROCESSES) {
    running++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  // 待機者へ実行権を引き渡すのでrunningは減らさない。
  if (next) next();
  else running--;
}

/** 設定値(空欄・空白のみはPATHの`oci`)を空白区切りで実行ファイルと前置引数に分解する。 */
export function splitOciCommand(command: string): { file: string; args: string[] } {
  const [file = DEFAULT_OCI_COMMAND, ...args] = command.split(/\s+/).filter((part) => part.length > 0);
  return { file, args };
}

export async function execOci(command: string, args: readonly string[]): Promise<OciExecResult> {
  const { file, args: prefixArgs } = splitOciCommand(command);
  await acquire();
  try {
    return await invokeExecOci(file, [...prefixArgs, ...args, "--output", "json"]);
  } finally {
    release();
  }
}

/** コマンド定義1件を実行し、応答型の値かエラー分類を返す。ociCommandはPreferencesの「ociコマンド」(空欄はPATHの`oci`)。 */
export async function runOciCommand<Params, Result>(
  def: OciCommandDef<Params, Result>,
  params: Params,
  ociCommand: string,
): Promise<OciResult<Result>> {
  const baseArgs = def.args(params);
  const items: unknown[] = [];
  let page: string | undefined;
  const startedAt = Date.now();

  for (let pages = 0; pages < MAX_PAGES; pages++) {
    if (Date.now() - startedAt > PAGING_DEADLINE_MS) {
      return {
        ok: false,
        kind: "other",
        raw: { message: `oci paging exceeded ${PAGING_DEADLINE_MS / 60_000} minutes` },
      };
    }
    const argv = page === undefined ? baseArgs : [...baseArgs, "--page", page];
    let exec: OciExecResult;
    try {
      exec = await execOci(ociCommand, argv);
    } catch (error) {
      return {
        ok: false,
        kind: "other",
        raw: { message: `oci call via the extension main process failed: ${String(error)}` },
      };
    }
    if (!exec.ok) return { ok: false, ...classifyOciCliFailure(exec.failure) };

    let parsed: { value: unknown; nextPage?: string };
    try {
      parsed = parseOciStdout(exec.stdout, def.output);
    } catch (error) {
      return {
        ok: false,
        kind: "other",
        raw: {
          message: error instanceof Error ? error.message : String(error),
          stderr: exec.stderr.trim() || undefined,
        },
      };
    }

    if (def.output === "single") return { ok: true, data: def.decode(parsed.value) };
    // spread展開だと大量件数で引数上限に当たるため1件ずつ積む。
    for (const item of parsed.value as unknown[]) items.push(item);
    if (items.length > MAX_ITEMS) {
      return { ok: false, kind: "other", raw: { message: `oci returned more than ${MAX_ITEMS} items` } };
    }
    if (!def.manualPaging || parsed.nextPage === undefined) return { ok: true, data: def.decode(items) };
    page = parsed.nextPage;
  }
  return { ok: false, kind: "other", raw: { message: `oci returned more than ${MAX_PAGES} pages` } };
}
