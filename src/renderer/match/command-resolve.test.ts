import { describe, expect, it } from "vitest";
import { resolveOciCommand } from "./command-resolve";

describe("resolveOciCommand", () => {
  it("returns oci when no override is given", () => {
    expect(resolveOciCommand("")).toEqual(["oci"]);
    expect(resolveOciCommand("   ")).toEqual(["oci"]);
  });

  it("splits an override string on whitespace", () => {
    expect(resolveOciCommand("oci --profile FOO")).toEqual(["oci", "--profile", "FOO"]);
  });

  it("collapses repeated whitespace in the override string", () => {
    expect(resolveOciCommand("  oci   --profile   FOO  ")).toEqual(["oci", "--profile", "FOO"]);
  });

  it("allows a fully custom command such as wsl.exe oci", () => {
    expect(resolveOciCommand("wsl.exe oci")).toEqual(["wsl.exe", "oci"]);
  });
});
