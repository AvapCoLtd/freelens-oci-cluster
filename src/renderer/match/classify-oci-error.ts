import type { OciErrorKind, OciRawErrorInfo } from "../sdk/result";

interface ServiceErrorLike {
  statusCode?: unknown;
  serviceCode?: unknown;
  opcRequestId?: unknown;
  message?: unknown;
}

/**
 * SDK呼び出し失敗の分類(非OKE判定・認証コマンド失敗はこの前段で別途行う)。
 * OciErrorクラスはinstanceofでなく構造(statusCode)で判定する: バンドル境界でクラス同一性が保てないため。
 */
export function classifyOciError(error: unknown): { kind: OciErrorKind; raw: OciRawErrorInfo } {
  const e = (error ?? {}) as ServiceErrorLike;
  const message = typeof e.message === "string" ? e.message : String(error);
  if (typeof e.statusCode === "number") {
    const raw: OciRawErrorInfo = {
      message,
      statusCode: e.statusCode,
      serviceCode: typeof e.serviceCode === "string" ? e.serviceCode : undefined,
      opcRequestId: typeof e.opcRequestId === "string" ? e.opcRequestId : undefined,
    };
    if (e.statusCode === 401) return { kind: "not_authenticated", raw };
    if (e.statusCode === 403 || e.statusCode === 404) return { kind: "forbidden_or_not_found", raw };
    return { kind: "other", raw };
  }
  return { kind: "other", raw: { message } };
}
