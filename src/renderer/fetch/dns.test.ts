import { describe, expect, it, vi } from "vitest";
import { invokeLookupHostIps } from "../oci-ipc";
import { resolveHostIps } from "./dns";

vi.mock("../oci-ipc", () => ({ invokeLookupHostIps: vi.fn() }));

const invokeMock = vi.mocked(invokeLookupHostIps);

describe("resolveHostIps", () => {
  it("mainの解決結果をそのまま返す", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, addresses: ["10.0.0.1"] });
    expect(await resolveHostIps("app.example.com")).toEqual({ ok: true, data: ["10.0.0.1"] });
    expect(invokeMock).toHaveBeenCalledWith("app.example.com");
  });

  it("mainでの失敗はotherで、コードを残す", async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, message: "Error: connect ECONNREFUSED", code: "ECONNREFUSED" });
    expect(await resolveHostIps("app.example.com")).toEqual({
      ok: false,
      kind: "other",
      raw: { message: "DNS resolution failed: Error: connect ECONNREFUSED", code: "ECONNREFUSED" },
    });
  });

  it("IPC自体の失敗もotherで返す", async () => {
    invokeMock.mockRejectedValueOnce(new Error("No handler registered for lookup-host-ips"));
    const result = await resolveHostIps("app.example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("other");
    expect(result.raw.message).toContain("No handler registered");
  });
});
