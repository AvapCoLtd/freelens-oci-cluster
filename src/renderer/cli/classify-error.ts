import type { OciErrorKind, OciRawErrorInfo } from "../oci/result";

/** oci CLIがstderrに出す`ServiceError:`のJSON(キーはdata側と別系統のsnake_case)。 */
export interface OciCliServiceError {
  code?: string;
  message?: string;
  status?: number;
  opcRequestId?: string;
}

export type OciCliFailure =
  /** 実行ファイルを起動できなかった(ENOENT等) */
  | { reason: "launch"; message: string; code?: string }
  | { reason: "timeout"; timeoutMs: number; stderr?: string }
  | { reason: "output_limit"; maxBytes: number; stderr?: string }
  | { reason: "exit"; exitCode: number; stdout: string; stderr: string };

const SERVICE_ERROR_MARKER = "ServiceError:";

/** stderrから`ServiceError:`のJSONを取り出す。APIキーの警告行等が前置されることがある。 */
export function parseServiceError(stderr: string): OciCliServiceError | undefined {
  const markerAt = stderr.indexOf(SERVICE_ERROR_MARKER);
  if (markerAt < 0) return undefined;
  const body = stderr.slice(markerAt + SERVICE_ERROR_MARKER.length);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const fields = parsed as Record<string, unknown>;
  return {
    code: typeof fields.code === "string" ? fields.code : undefined,
    message: typeof fields.message === "string" ? fields.message : undefined,
    status: typeof fields.status === "number" ? fields.status : undefined,
    opcRequestId: typeof fields["opc-request-id"] === "string" ? fields["opc-request-id"] : undefined,
  };
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** CLIの引数解釈エラー(未知のサブコマンド・オプション、必須オプション欠落)。 */
function isUsageError(text: string): boolean {
  return text.trimStart().startsWith("Usage:") && /^Error:/m.test(text);
}

function isConfigSetupError(text: string): boolean {
  return text.includes("Could not find config file") || text.includes("not found in config file");
}

/** config読み込み中のkey_file不在等、oci CLIがPythonの例外を素通しするケース。 */
function isCredentialFileError(text: string): boolean {
  // oci CLI内部のスタックトレース文字列に依存する: 出力が変わればother(ポーリング継続)に戻るだけ
  return (
    !text.includes(SERVICE_ERROR_MARKER) &&
    text.includes("Traceback (most recent call last):") &&
    text.includes("FileNotFoundError")
  );
}

function failureMessage(exitCode: number, stdout: string, stderr: string): string {
  const errorLine = [...lines(stderr), ...lines(stdout)].find((line) => /^(ERROR|Error):/.test(line));
  if (errorLine) return errorLine;
  return lines(stderr).at(-1) ?? `oci exited with code ${exitCode}`;
}

/** exit code + stdout/stderr からエラー種別を決める(分類不能はother=ポーリング継続側に倒す)。 */
export function classifyOciExit(
  exitCode: number,
  stdout: string,
  stderr: string,
): { kind: OciErrorKind; raw: OciRawErrorInfo } {
  const service = parseServiceError(stderr);
  if (service) {
    const raw: OciRawErrorInfo = {
      message: service.message ?? `oci returned ${service.code ?? "a service error"}`,
      statusCode: service.status,
      serviceCode: service.code,
      opcRequestId: service.opcRequestId,
      code: exitCode,
      stderr: stderr.trim() || undefined,
    };
    if (service.code === "NotAuthenticated" || service.status === 401) return { kind: "not_authenticated", raw };
    if (service.code === "NotAuthorizedOrNotFound" || service.status === 403 || service.status === 404) {
      return { kind: "forbidden_or_not_found", raw };
    }
    return { kind: "other", raw };
  }

  const raw: OciRawErrorInfo = {
    message: failureMessage(exitCode, stdout, stderr),
    code: exitCode,
    stderr: stderr.trim() || undefined,
  };
  // 引数を組み立てているのはコマンド定義表だが、互換コマンドが引数を転送しない・oci CLIが古い等
  // 利用者環境起因でも拒否されうるため、拡張側のバグと決め付けない。
  if (isUsageError(stdout) || isUsageError(stderr)) return { kind: "command_incompatible", raw };
  if (isConfigSetupError(stdout) || isConfigSetupError(stderr)) return { kind: "not_authenticated", raw };
  if (isCredentialFileError(stdout) || isCredentialFileError(stderr)) return { kind: "not_authenticated", raw };
  return { kind: "other", raw };
}

export function classifyOciCliFailure(failure: OciCliFailure): { kind: OciErrorKind; raw: OciRawErrorInfo } {
  switch (failure.reason) {
    case "launch":
      return { kind: "command_launch_failed", raw: { message: failure.message, code: failure.code } };
    case "timeout":
      return {
        kind: "other",
        raw: {
          message: `oci did not complete within ${failure.timeoutMs / 1000} seconds`,
          code: "ETIMEDOUT",
          stderr: failure.stderr?.trim() || undefined,
        },
      };
    case "output_limit":
      return {
        kind: "other",
        raw: {
          message: `oci output exceeded the ${failure.maxBytes} byte limit`,
          stderr: failure.stderr?.trim() || undefined,
        },
      };
    case "exit":
      return classifyOciExit(failure.exitCode, failure.stdout, failure.stderr);
  }
}
