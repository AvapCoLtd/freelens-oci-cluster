import { describe, expect, it } from "vitest";
import type { OciResult } from "../oci/result";
import { entriesReady, sectionsReady } from "./section-ready";

const READY: OciResult<unknown> = { ok: true, data: [] };
const LOADING: OciResult<unknown> = { ok: false, kind: "loading", raw: { message: "loading" } };
const FAILED: OciResult<unknown> = { ok: false, kind: "forbidden_or_not_found", raw: { message: "denied" } };
const NOT_REQUESTED: OciResult<unknown> = { ok: false, kind: "not_requested", raw: { message: "n/a" } };

describe("sectionsReady", () => {
  it("取得中が1つでもあれば未確定", () => {
    expect(sectionsReady(READY, LOADING)).toBe(false);
  });

  it("失敗は確定として扱う(1セクションの失敗で表を止めない)", () => {
    expect(sectionsReady(READY, FAILED)).toBe(true);
  });

  it("そのページが要求していないセクションは確定として扱う", () => {
    expect(sectionsReady(NOT_REQUESTED)).toBe(true);
  });

  it("対象が無ければ確定", () => {
    expect(sectionsReady()).toBe(true);
  });
});

describe("entriesReady", () => {
  it("必要なOCIDが全て載っていれば確定", () => {
    expect(entriesReady({ a: READY, b: FAILED }, ["a", "b"])).toBe(true);
  });

  it("1つでも未登載なら未確定(行の中身が後から生えるのを防ぐ)", () => {
    expect(entriesReady({ a: READY }, ["a", "b"])).toBe(false);
  });

  it("必要なOCIDが無ければ確定", () => {
    expect(entriesReady({}, [])).toBe(true);
  });
});
