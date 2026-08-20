import { describe, expect, it } from "vitest";
import { filterRows, matchesQuery } from "./filter-rows";

interface Row {
  id: string;
  name: string;
  shape: string | undefined;
  ocpus: number;
}

const rows: Row[] = [
  { id: "a", name: "worker-01", shape: "VM.Standard.E4.Flex", ocpus: 2 },
  { id: "b", name: "worker-02", shape: "VM.Standard.A1.Flex", ocpus: 4 },
  { id: "c", name: "control-plane", shape: undefined, ocpus: 8 },
];

const searchText = (row: Row) => [row.name, row.shape, row.ocpus];

describe("filterRows", () => {
  it("returns every row for an empty or whitespace-only query", () => {
    expect(filterRows(rows, "", searchText).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterRows(rows, "   ", searchText).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("matches partially and ignores case", () => {
    expect(filterRows(rows, "WORKER", searchText).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("matches when any of the search values contains the token", () => {
    expect(filterRows(rows, "a1", searchText).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, "8", searchText).map((r) => r.id)).toEqual(["c"]);
  });

  it("requires every whitespace-separated token to match (AND)", () => {
    expect(filterRows(rows, "worker flex", searchText).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterRows(rows, "worker a1", searchText).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, "worker nope", searchText)).toEqual([]);
  });

  it("ignores undefined search values", () => {
    expect(filterRows(rows, "undefined", searchText)).toEqual([]);
    expect(filterRows(rows, "control", searchText).map((r) => r.id)).toEqual(["c"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    filterRows(rows, "worker", searchText);
    expect(rows).toEqual(copy);
  });
});

describe("matchesQuery", () => {
  it("matches when a search value contains the token", () => {
    expect(matchesQuery(["worker-01", "VM.Standard.E4.Flex", 2], "flex")).toBe(true);
  });

  it("does not match when no search value contains the token", () => {
    expect(matchesQuery(["worker-01", "VM.Standard.E4.Flex", 2], "nope")).toBe(false);
  });
});
