import { describe, expect, it } from "vitest";
import { sectionsForPage } from "./page-sections";

describe("sectionsForPage", () => {
  it("maps nodes page to instances only", () => {
    expect(sectionsForPage("nodes")).toEqual(["instances"]);
  });

  it("maps service-lb page to taggedResources + nlbs + lbs", () => {
    expect(sectionsForPage("service-lb")).toEqual(["taggedResources", "nlbs", "lbs"]);
  });

  it("maps pv-storage page to taggedResources + volumes + fileSystems (taggedResources shared with service-lb)", () => {
    expect(sectionsForPage("pv-storage")).toEqual(["taggedResources", "volumes", "fileSystems"]);
  });
});
