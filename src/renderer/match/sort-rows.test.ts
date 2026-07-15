import { describe, expect, it } from "vitest";
import { sortRows } from "./sort-rows";

describe("sortRows", () => {
  const rows = [
    { id: "b", n: 2 },
    { id: "a", n: 1 },
    { id: "c", n: undefined as number | undefined },
  ];

  it("sorts ascending by the given numeric value", () => {
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts descending by the given numeric value", () => {
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps rows with an undefined sort value at the end regardless of direction", () => {
    expect(sortRows(rows, (r) => r.n, "asc").at(-1)?.id).toBe("c");
    expect(sortRows(rows, (r) => r.n, "desc").at(-1)?.id).toBe("c");
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortRows(rows, (r) => r.n, "asc");
    expect(rows).toEqual(copy);
  });

  it("sorts strings alphabetically", () => {
    const strRows = [
      { id: "x", s: "banana" },
      { id: "y", s: "apple" },
    ];
    expect(sortRows(strRows, (r) => r.s, "asc").map((r) => r.id)).toEqual(["y", "x"]);
  });
});
