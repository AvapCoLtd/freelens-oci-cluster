import { describe, expect, it } from "vitest";
import { classifyCliError } from "./classify-cli-error";

describe("classifyCliError", () => {
  it("classifies ENOENT as enoent", () => {
    expect(classifyCliError({ code: "ENOENT", message: "spawn oci ENOENT", stderr: "" })).toBe("enoent");
  });

  it("classifies NotAuthenticated in stderr as not_authenticated", () => {
    expect(classifyCliError({ message: "Command failed", stderr: "ServiceError: NotAuthenticated" })).toBe(
      "not_authenticated",
    );
  });

  it("classifies NotAuthenticated in message as not_authenticated", () => {
    expect(classifyCliError({ message: "NotAuthenticated: token expired", stderr: "" })).toBe("not_authenticated");
  });

  it("classifies anything else as other", () => {
    expect(classifyCliError({ code: 1, message: "Command failed", stderr: "404 NotFound" })).toBe("other");
  });

  // 実機の `oci compute instance get` を存在しないOCIDで実行した際のServiceError本文(匿名化)。
  const SERVICE_ERROR_404 = JSON.stringify({
    code: "NotAuthorizedOrNotFound",
    message: "Authorization failed or requested resource not found.",
    status: 404,
  });

  it("classifies a real OCI ServiceError status:404 body as forbidden_or_not_found", () => {
    expect(classifyCliError({ code: 1, message: "Command failed", stderr: SERVICE_ERROR_404 })).toBe(
      "forbidden_or_not_found",
    );
  });

  it("classifies a status:403 body as forbidden_or_not_found", () => {
    expect(
      classifyCliError({ code: 1, message: "Command failed", stderr: '{"code":"NotAuthorized","status":403}' }),
    ).toBe("forbidden_or_not_found");
  });
});
