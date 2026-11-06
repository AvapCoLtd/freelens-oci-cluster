import { generateKeyPairSync, sign, X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OciLoadBalancer } from "../oci/types";
import { lbCertificateRows } from "./lb-certificates";
import { parseX509Pem } from "./x509";

type Bytes = Uint8Array | number[];

function concat(parts: Bytes[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)));
}

function tlv(tag: number, ...content: Bytes[]): Uint8Array {
  const body = concat(content);
  const length: number[] = [];
  if (body.length < 0x80) {
    length.push(body.length);
  } else {
    for (let n = body.length; n > 0; n >>= 8) length.unshift(n & 0xff);
    length.unshift(0x80 | length.length);
  }
  return concat([[tag], length, body]);
}

const seq = (...items: Bytes[]) => tlv(0x30, ...items);
const set = (...items: Bytes[]) => tlv(0x31, ...items);
const int = (value: number) => tlv(0x02, [value]);
const text = (value: string) => new TextEncoder().encode(value);
const utf8 = (value: string) => tlv(0x0c, text(value));
const printable = (value: string) => tlv(0x13, text(value));
const ia5 = (value: string) => tlv(0x16, text(value));
const bmp = (value: string) =>
  tlv(
    0x1e,
    Array.from(value).flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]),
  );

function oid(dotted: string): Uint8Array {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes: number[] = [];
  for (const arc of [first * 40 + second, ...rest]) {
    const groups = [arc & 0x7f];
    for (let n = arc >> 7; n > 0; n >>= 7) groups.unshift((n & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return tlv(0x06, bytes);
}

function time(date: Date): Uint8Array {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return date.getUTCFullYear() < 2050 ? tlv(0x17, text(`${iso.slice(2)}Z`)) : tlv(0x18, text(`${iso}Z`));
}

type Rdn = [string, Uint8Array][];

function name(...rdns: Rdn[]): Uint8Array {
  return seq(...rdns.map((rdn) => set(...rdn.map(([type, value]) => seq(oid(type), value)))));
}

const CN = "2.5.4.3";
const O = "2.5.4.10";
const OU = "2.5.4.11";
const C = "2.5.4.6";
const EMAIL = "1.2.840.113549.1.9.1";
const DC = "0.9.2342.19200300.100.1.25";

function subjectAltName(...names: Uint8Array[]): Uint8Array {
  return seq(oid("2.5.29.17"), tlv(0x04, seq(...names)));
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ECDSA_SHA256 = seq(oid("1.2.840.10045.4.3.2"));

function certificatePem(options: { subject: Uint8Array; notAfter: Date; extensions?: Uint8Array[] }): string {
  const tbs = seq(
    ...(options.extensions ? [tlv(0xa0, int(2))] : []),
    int(1),
    ECDSA_SHA256,
    options.subject,
    seq(time(new Date("2026-01-01T00:00:00Z")), time(options.notAfter)),
    options.subject,
    publicKey.export({ type: "spki", format: "der" }),
    ...(options.extensions ? [tlv(0xa3, seq(...options.extensions))] : []),
  );
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, [0], sign("sha256", tbs, privateKey)));
  const base64 = Buffer.from(der).toString("base64");
  return `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function nodeView(pem: string) {
  const cert = new X509Certificate(pem);
  return { validTo: new Date(cert.validTo), subject: cert.subject, subjectAltName: cert.subjectAltName };
}

const CASES: { title: string; pem: string }[] = [
  {
    title: "SANの各種別(DNS・IP・email・URI・DirName・登録ID・引用が要る値)",
    pem: certificatePem({
      subject: name([[C, printable("JP")]], [[O, utf8("Example Corp")]], [[CN, utf8("app.example.com")]]),
      notAfter: new Date("2030-04-01T12:34:56Z"),
      extensions: [
        seq(oid("2.5.29.19"), tlv(0x01, [0xff]), tlv(0x04, seq())),
        subjectAltName(
          tlv(0x82, text("app.example.com")),
          tlv(0x82, text("*.app.example.com")),
          tlv(0x82, text("weird,name.example.com")),
          tlv(0x87, [10, 0, 0, 5]),
          tlv(0x87, [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
          tlv(0x81, text("ops@example.com")),
          tlv(0x86, text("https://example.com/x")),
          tlv(0xa4, name([[O, utf8("Dir Org")]], [[CN, utf8("dir, name")]])),
          tlv(0x88, oid("1.2.3.4").subarray(2)),
        ),
      ],
    }),
  },
  {
    title: "subjectの非ASCII・複数値RDN・エスケープ対象文字、2050年以降の期限",
    pem: certificatePem({
      subject: name(
        [[C, printable("JP")]],
        [[O, utf8("株式会社テスト, 本社")]],
        [
          [OU, utf8("Ops")],
          [CN, utf8("multi value")],
        ],
        [[CN, utf8(' lead"quote;semi+plus<lt>gt\\back#hash ')]],
        [[CN, bmp("BMP名")]],
        [[CN, utf8("ctrl\u0001char")]],
        [["1.2.3.4", printable("unknown attr")]],
      ),
      notAfter: new Date("2061-02-03T04:05:06Z"),
    }),
  },
  {
    title: "SAN無し、emailAddressとDC",
    pem: certificatePem({
      subject: name([[CN, utf8("no-san.example.com")]], [[EMAIL, ia5("a@example.com")]], [[DC, ia5("example")]]),
      notAfter: new Date("2027-01-01T00:00:00Z"),
      extensions: [seq(oid("2.5.29.19"), tlv(0x04, seq()))],
    }),
  },
  {
    title: "version欄の無いv1証明書",
    pem: certificatePem({ subject: name([[CN, utf8("v1.example.com")]]), notAfter: new Date("2028-06-30T23:59:59Z") }),
  },
];

describe("parseX509Pem", () => {
  it.each(CASES)("$title: NodeのX509Certificateと同じ表記", ({ pem }) => {
    expect(parseX509Pem(pem)).toEqual(nodeView(pem));
  });

  it("壊れたDERは例外", () => {
    const pem = CASES[0]?.pem ?? "";
    const body = pem.replace(/-----[A-Z ]+-----|\s/g, "");
    const truncated = `-----BEGIN CERTIFICATE-----\n${body.slice(0, 200)}\n-----END CERTIFICATE-----`;
    expect(() => parseX509Pem(truncated)).toThrow();
    expect(() => parseX509Pem("-----BEGIN CERTIFICATE-----\n%%%\n-----END CERTIFICATE-----")).toThrow();
  });
});

describe("lbCertificateRows", () => {
  const leaf = CASES[0]?.pem ?? "";
  const intermediate = CASES[3]?.pem ?? "";

  it("チェーン連結PEMは先頭(リーフ)を読み、使うlistenerを添える", () => {
    const lb = {
      id: "ocid1.loadbalancer.x",
      certificates: {
        app: { "certificate-name": "app", "public-certificate": `${leaf}${intermediate}` },
        broken: { "certificate-name": "broken", "public-certificate": "not a pem" },
      },
      listeners: {
        https: { "ssl-configuration": { "certificate-name": "app" } },
        plain: {},
      },
    } as unknown as OciLoadBalancer;

    expect(lbCertificateRows(lb)).toEqual([
      {
        name: "app",
        validTo: "2030-04-01T12:34:56.000Z",
        subject: "C=JP, O=Example Corp, CN=app.example.com",
        sans: nodeView(leaf).subjectAltName,
        listenerNames: ["https"],
      },
      { name: "broken", parseError: true, listenerNames: [] },
    ]);
  });
});
