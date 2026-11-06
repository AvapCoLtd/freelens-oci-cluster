import { execFile } from "node:child_process";
import type { OciExecResult } from "../common/oci-ipc";

const CALL_TIMEOUT_MS = 60_000;
// execFileのtimeoutはSIGTERM止まりで、無視されるとコールバックが来ずrendererのセマフォ枠が戻らない。
const WATCHDOG_GRACE_MS = 5_000;
// 実測由来: 全リソースのJSONを受け切る側に倒している。超過はセクション単位のエラーになる。
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** exit 0ならstderrが空でなくても成功(`--all`無しlistのWARNING等)。 */
export function execOciProcess(file: string, argv: readonly string[]): Promise<OciExecResult> {
  return new Promise<OciExecResult>((resolve) => {
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const child = execFile(
      file,
      argv,
      { timeout: CALL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        if (watchdog !== undefined) clearTimeout(watchdog);
        if (!error) {
          resolve({ ok: true, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve({ ok: false, failure: { reason: "output_limit", maxBytes: MAX_OUTPUT_BYTES, stderr } });
          return;
        }
        if (error.killed) {
          // execFileのtimeoutはSIGTERM止まりなので、無視するラッパ経由でも残留させないよう追い打ちする。
          child.kill("SIGKILL");
          resolve({ ok: false, failure: { reason: "timeout", timeoutMs: CALL_TIMEOUT_MS, stderr } });
          return;
        }
        if (typeof code === "string") {
          resolve({
            ok: false,
            failure: { reason: "launch", message: `Failed to run "${file}": ${error.message}`, code },
          });
          return;
        }
        resolve({
          ok: false,
          failure: { reason: "exit", exitCode: typeof code === "number" ? code : 1, stdout, stderr },
        });
      },
    );
    watchdog = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, failure: { reason: "timeout", timeoutMs: CALL_TIMEOUT_MS } });
    }, CALL_TIMEOUT_MS + WATCHDOG_GRACE_MS);
    // config不在時に対話プロンプトを出す経路がある。stdinを閉じないとEOFが来ずタイムアウトまで待つ。
    child.stdin?.on("error", () => undefined);
    child.stdin?.end();
  });
}
