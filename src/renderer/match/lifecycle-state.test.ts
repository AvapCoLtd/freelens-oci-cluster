import { describe, expect, it } from "vitest";
import { isAbnormalLifecycleState, isAttachedState } from "./lifecycle-state";

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

describe("isAttachedState", () => {
  it("treats missing state as attached (no data to reject the attachment)", () => {
    expect(isAttachedState(undefined)).toBe(true);
  });

  it("treats ATTACHED as attached", () => {
    expect(isAttachedState("ATTACHED")).toBe(true);
  });

  it.each(["ATTACHING", "DETACHING", "DETACHED", ""])("treats %s as not attached", (state) => {
    expect(isAttachedState(state)).toBe(false);
  });
});
