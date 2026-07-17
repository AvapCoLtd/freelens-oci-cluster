import { describe, expect, it } from "vitest";
import { classifyOciError } from "./classify-oci-error";

function serviceError(statusCode: number, serviceCode: string): unknown {
  return { statusCode, serviceCode, message: `${serviceCode} error`, opcRequestId: "req-1" };
}

describe("classifyOciError", () => {
  it("401はnot_authenticated", () => {
    const { kind, raw } = classifyOciError(serviceError(401, "NotAuthenticated"));
    expect(kind).toBe("not_authenticated");
    expect(raw.statusCode).toBe(401);
    expect(raw.opcRequestId).toBe("req-1");
  });

  it("403/404はforbidden_or_not_found", () => {
    expect(classifyOciError(serviceError(403, "NotAllowed")).kind).toBe("forbidden_or_not_found");
    expect(classifyOciError(serviceError(404, "NotAuthorizedOrNotFound")).kind).toBe("forbidden_or_not_found");
  });

  it("その他のHTTPステータスはother(詳細を保持)", () => {
    const { kind, raw } = classifyOciError(serviceError(429, "TooManyRequests"));
    expect(kind).toBe("other");
    expect(raw.serviceCode).toBe("TooManyRequests");
  });

  it("statusCodeを持たない例外(ネットワーク等)はotherでmessageのみ", () => {
    const { kind, raw } = classifyOciError(new Error("fetch failed"));
    expect(kind).toBe("other");
    expect(raw).toEqual({ message: "fetch failed" });
  });

  it("非Errorのthrowも文字列化して分類する", () => {
    const { kind, raw } = classifyOciError("boom");
    expect(kind).toBe("other");
    expect(raw.message).toBe("boom");
  });
});
