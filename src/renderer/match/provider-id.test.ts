import { describe, expect, it } from "vitest";
import { parseProviderId, pickAnchorInstanceId } from "./provider-id";

const INSTANCE_OCID = "ocid1.instance.oc1.ap-tokyo-1.aaaaexample1234567890abcdefghijklmnop";

describe("parseProviderId", () => {
  it("parses a bare instance OCID as OKE", () => {
    expect(parseProviderId(INSTANCE_OCID)).toEqual({ isOke: true, instanceId: INSTANCE_OCID });
  });

  it("strips an oci:// scheme prefix", () => {
    expect(parseProviderId(`oci://${INSTANCE_OCID}`)).toEqual({ isOke: true, instanceId: INSTANCE_OCID });
  });

  it("rejects undefined/null providerID", () => {
    expect(parseProviderId(undefined)).toEqual({ isOke: false });
    expect(parseProviderId(null)).toEqual({ isOke: false });
  });

  it("rejects empty providerID", () => {
    expect(parseProviderId("")).toEqual({ isOke: false });
  });

  it("rejects non-instance OCIDs", () => {
    expect(parseProviderId("ocid1.volume.oc1.ap-tokyo-1.aaaaexample")).toEqual({ isOke: false });
  });
});

describe("pickAnchorInstanceId", () => {
  it("picks the first OKE-parseable providerID", () => {
    expect(pickAnchorInstanceId([undefined, "not-an-ocid", INSTANCE_OCID, `oci://${INSTANCE_OCID}`])).toBe(
      INSTANCE_OCID,
    );
  });

  it("returns undefined when no providerID is OKE-shaped", () => {
    expect(pickAnchorInstanceId([undefined, null, "not-an-ocid"])).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(pickAnchorInstanceId([])).toBeUndefined();
  });
});
