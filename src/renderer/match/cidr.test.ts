import { describe, expect, it } from "vitest";
import { cidrContains, cidrOverlaps, cidrPrefixLength, ipInCidr } from "./cidr";

describe("cidrContains", () => {
  it("外側が内側を丸ごと含むときだけtrueになる", () => {
    expect(cidrContains("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
    expect(cidrContains("10.0.1.0/24", "10.0.0.0/16")).toBe(false);
    expect(cidrContains("10.0.1.0/24", "10.0.2.0/24")).toBe(false);
  });

  it("同一CIDRは含む扱いにする", () => {
    expect(cidrContains("10.0.1.0/24", "10.0.1.0/24")).toBe(true);
  });

  it("0.0.0.0/0は全IPv4を含む", () => {
    expect(cidrContains("0.0.0.0/0", "10.0.0.0/16")).toBe(true);
    expect(cidrContains("::/0", "2001:db8::/32")).toBe(true);
  });

  it("アドレスファミリを跨いだ包含は成立しない", () => {
    expect(cidrContains("0.0.0.0/0", "2001:db8::/32")).toBe(false);
    expect(cidrContains("::/0", "10.0.0.0/16")).toBe(false);
  });

  it("不正表記・プレフィクス無しはfalse", () => {
    expect(cidrContains("10.0.0.0", "10.0.1.0/24")).toBe(false);
    expect(cidrContains("10.0.0.0/33", "10.0.1.0/24")).toBe(false);
    expect(cidrContains("all-nrt-services-in-oracle-services-network", "10.0.1.0/24")).toBe(false);
    expect(cidrContains(undefined, "10.0.1.0/24")).toBe(false);
  });
});

describe("cidrOverlaps", () => {
  it("どちらの向きの包含でも重なりと判定する", () => {
    expect(cidrOverlaps("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
    expect(cidrOverlaps("10.0.1.0/24", "10.0.0.0/16")).toBe(true);
  });

  it("素なCIDRは重ならない", () => {
    expect(cidrOverlaps("10.0.1.0/24", "10.0.2.0/24")).toBe(false);
    expect(cidrOverlaps("10.0.10.80/28", "10.0.10.96/28")).toBe(false);
  });

  it("IPv6も同じ規則で判定する", () => {
    expect(cidrOverlaps("2001:db8:0:4500::/56", "2001:db8::/32")).toBe(true);
    expect(cidrOverlaps("2001:db8:0:4500::/56", "2001:db8:0:4600::/56")).toBe(false);
  });
});

describe("cidrPrefixLength", () => {
  it("プレフィクス長を返す", () => {
    expect(cidrPrefixLength("10.0.1.0/24")).toBe(24);
    expect(cidrPrefixLength("0.0.0.0/0")).toBe(0);
    expect(cidrPrefixLength("::/0")).toBe(0);
  });

  it("不正表記はundefined", () => {
    expect(cidrPrefixLength("10.0.1.0")).toBeUndefined();
    expect(cidrPrefixLength(undefined)).toBeUndefined();
  });
});

describe("ipInCidr", () => {
  it("IPv4の包含を判定する", () => {
    expect(ipInCidr("10.0.1.10", "10.0.1.0/24")).toBe(true);
    expect(ipInCidr("10.0.2.10", "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("10.0.1.10", "0.0.0.0/0")).toBe(true);
    expect(ipInCidr("10.0.10.91", "10.0.10.80/28")).toBe(true);
    expect(ipInCidr("10.0.10.96", "10.0.10.80/28")).toBe(false);
  });

  it("IPv6の包含を判定する(圧縮表記・埋め込みIPv4を含む)", () => {
    expect(ipInCidr("2001:db8:0:4500::5", "2001:db8:0:4500::/56")).toBe(true);
    expect(ipInCidr("2001:db8:0:4600::5", "2001:db8:0:4500::/56")).toBe(false);
    expect(ipInCidr("::ffff:10.0.1.10", "::ffff:10.0.1.0/120")).toBe(true);
  });

  it("アドレスファミリ不一致・不正表記は例外にせずfalseを返す", () => {
    expect(ipInCidr("10.0.1.10", "2001:db8::/32")).toBe(false);
    expect(ipInCidr("2001:db8::1", "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("10.0.1.999", "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("10.0.1.10", "10.0.1.0/33")).toBe(false);
    expect(ipInCidr("10.0.1.10", "10.0.1.0")).toBe(false);
    expect(ipInCidr("10.0.1.10", "not-a-cidr")).toBe(false);
    expect(ipInCidr(undefined, "10.0.1.0/24")).toBe(false);
    expect(ipInCidr("1::2::3", "1::/16")).toBe(false);
  });
});
