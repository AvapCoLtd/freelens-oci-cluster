import { lookup } from "node:dns/promises";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { lookupHostIps } from "./dns";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

const lookupMock = lookup as unknown as Mock;

beforeEach(() => {
  lookupMock.mockReset();
});

describe("lookupHostIps", () => {
  it("OSリゾルバでIPv4を全件引き、重複を除く", async () => {
    lookupMock.mockResolvedValue([
      { address: "10.0.0.1", family: 4 },
      { address: "10.0.0.2", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    expect(await lookupHostIps("app.example.com")).toEqual({ ok: true, addresses: ["10.0.0.1", "10.0.0.2"] });
    expect(lookupMock).toHaveBeenCalledWith("app.example.com", { all: true, family: 4 });
  });

  it.each(["ENOTFOUND", "ENODATA"])("未解決(%s)は空の観測結果", async (code) => {
    lookupMock.mockRejectedValue(Object.assign(new Error(`queryA ${code}`), { code }));
    expect(await lookupHostIps("missing.example.com")).toEqual({ ok: true, addresses: [] });
  });

  it("それ以外の失敗はコード付きで返す", async () => {
    lookupMock.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    expect(await lookupHostIps("app.example.com")).toEqual({
      ok: false,
      message: "Error: connect ECONNREFUSED",
      code: "ECONNREFUSED",
    });
  });
});
