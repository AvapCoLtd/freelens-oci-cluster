import { describe, expect, it } from "vitest";
import { isAbnormalLifecycleState } from "./lifecycle-state";

describe("isAbnormalLifecycleState", () => {
  it.each(["AVAILABLE", "RUNNING", "ACTIVE"])("treats %s as normal", (state) => {
    expect(isAbnormalLifecycleState(state)).toBe(false);
  });

  it.each(["TERMINATED", "FAILED", "UPDATING"])("treats %s as abnormal", (state) => {
    expect(isAbnormalLifecycleState(state)).toBe(true);
  });

  it("treats missing state as not abnormal (no data, not flagged)", () => {
    expect(isAbnormalLifecycleState(undefined)).toBe(false);
  });
});
