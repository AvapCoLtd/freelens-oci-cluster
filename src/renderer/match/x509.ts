/** 表記はNodeのX509Certificate(subject/subjectAltName)に合わせる。 */
export interface X509Summary {
  validTo: Date;
  subject: string;
  subjectAltName?: string;
}

interface Tlv {
  tag: number;
  /** 値の先頭 */
  start: number;
  /** 値の末尾(次のTLVの先頭) */
  end: number;
}

const TAG_OCTET_STRING = 0x04;
const TAG_OID = 0x06;
const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;
const TAG_UTC_TIME = 0x17;
const TAG_GENERALIZED_TIME = 0x18;
const TAG_VERSION = 0xa0;
const TAG_EXTENSIONS = 0xa3;

const OID_SUBJECT_ALT_NAME = "2.5.29.17";

// OpenSSLの短縮名(XN_FLAG_FN_SN)。
const ATTRIBUTE_SHORT_NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.5": "serialNumber",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.9": "street",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.12": "title",
  "2.5.4.15": "businessCategory",
  "2.5.4.17": "postalCode",
  "2.5.4.42": "GN",
  "2.5.4.43": "initials",
  "2.5.4.46": "dnQualifier",
  "2.5.4.65": "pseudonym",
  "2.5.4.97": "organizationIdentifier",
  "0.9.2342.19200300.100.1.1": "UID",
  "0.9.2342.19200300.100.1.25": "DC",
  "1.2.840.113549.1.9.1": "emailAddress",
  "1.3.6.1.4.1.311.60.2.1.1": "jurisdictionL",
  "1.3.6.1.4.1.311.60.2.1.2": "jurisdictionST",
  "1.3.6.1.4.1.311.60.2.1.3": "jurisdictionC",
};

class DerError extends Error {}

function readTlv(der: Uint8Array, offset: number, limit = der.length): Tlv {
  if (offset + 2 > limit) throw new DerError("truncated DER");
  const tag = der[offset] as number;
  // 多バイトタグは証明書の読む範囲に現れない。
  if ((tag & 0x1f) === 0x1f) throw new DerError("unsupported DER tag");
  let lengthByte = der[offset + 1] as number;
  let start = offset + 2;
  let length = lengthByte;
  if (lengthByte & 0x80) {
    const count = lengthByte & 0x7f;
    if (count === 0 || count > 4) throw new DerError("unsupported DER length");
    if (start + count > limit) throw new DerError("truncated DER");
    length = 0;
    for (let i = 0; i < count; i++) {
      lengthByte = der[start + i] as number;
      length = length * 256 + lengthByte;
    }
    start += count;
  }
  const end = start + length;
  if (end > limit) throw new DerError("truncated DER");
  return { tag, start, end };
}

function expectTag(tlv: Tlv, tag: number): Tlv {
  if (tlv.tag !== tag) throw new DerError(`unexpected DER tag 0x${tlv.tag.toString(16)}`);
  return tlv;
}

function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const result: Tlv[] = [];
  for (let offset = parent.start; offset < parent.end; ) {
    const child = readTlv(der, offset, parent.end);
    result.push(child);
    offset = child.end;
  }
  return result;
}

function decodeOid(der: Uint8Array, tlv: Tlv): string {
  const arcs: number[] = [];
  let value = 0;
  for (let i = tlv.start; i < tlv.end; i++) {
    const byte = der[i] as number;
    value = value * 128 + (byte & 0x7f);
    if (byte & 0x80) continue;
    if (arcs.length === 0) {
      const first = value < 80 ? Math.floor(value / 40) : 2;
      arcs.push(first, value - first * 40);
    } else {
      arcs.push(value);
    }
    value = 0;
  }
  return arcs.join(".");
}

function bytesOf(der: Uint8Array, tlv: Tlv): Uint8Array {
  return der.subarray(tlv.start, tlv.end);
}

function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

function utf16be(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i + 1 < bytes.length; i += 2)
    text += String.fromCharCode(((bytes[i] as number) << 8) | (bytes[i + 1] as number));
  return text;
}

function utf32be(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + i, 4);
    text += String.fromCodePoint(view.getUint32(0));
  }
  return text;
}

function decodeDirectoryString(der: Uint8Array, tlv: Tlv): string | undefined {
  const bytes = bytesOf(der, tlv);
  switch (tlv.tag) {
    case 0x0c: // UTF8String
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    case 0x12: // NumericString
    case 0x13: // PrintableString
    case 0x14: // TeletexString
    case 0x16: // IA5String
    case 0x1a: // VisibleString
      return latin1(bytes);
    case 0x1c:
      return utf32be(bytes);
    case 0x1e:
      return utf16be(bytes);
    default:
      return undefined;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("");
}

const RFC2253_SPECIALS = new Set([",", "+", '"', "\\", "<", ">", ";"]);

// OpenSSLのASN1_STRFLGS_ESC_2253 | ASN1_STRFLGS_ESC_CTRL相当。
function escapeAttributeValue(value: string): string {
  const chars = Array.from(value);
  return chars
    .map((char, index) => {
      const code = char.codePointAt(0) as number;
      if (code < 0x20 || code === 0x7f) return `\\${code.toString(16).toUpperCase().padStart(2, "0")}`;
      if (RFC2253_SPECIALS.has(char)) return `\\${char}`;
      if (index === 0 && (char === "#" || char === " ")) return `\\${char}`;
      if (index === chars.length - 1 && char === " ") return `\\${char}`;
      return char;
    })
    .join("");
}

interface NameLayout {
  rdnSeparator: string;
  multiValueSeparator: string;
  reverse: boolean;
}

// XN_FLAG_SEP_MULTILINE(X509Certificate.subject)とXN_FLAG_RFC2253(SANのDirName)。
const MULTILINE: NameLayout = { rdnSeparator: "\n", multiValueSeparator: " + ", reverse: false };
const RFC2253: NameLayout = { rdnSeparator: ",", multiValueSeparator: "+", reverse: true };

function formatName(der: Uint8Array, name: Tlv, layout: NameLayout): string {
  const rdns = children(der, expectTag(name, TAG_SEQUENCE));
  return (layout.reverse ? rdns.reverse() : rdns)
    .map((rdn) =>
      children(der, expectTag(rdn, TAG_SET))
        .map((attribute) => {
          const [type, value] = children(der, expectTag(attribute, TAG_SEQUENCE));
          if (!type || !value) throw new DerError("malformed name attribute");
          const oid = decodeOid(der, expectTag(type, TAG_OID));
          const text = decodeDirectoryString(der, value);
          const rendered =
            text === undefined ? `#${hex(der.subarray(value.start - 2, value.end))}` : escapeAttributeValue(text);
          return `${ATTRIBUTE_SHORT_NAMES[oid] ?? oid}=${rendered}`;
        })
        .join(layout.multiValueSeparator),
    )
    .join(layout.rdnSeparator);
}

function parseTime(der: Uint8Array, tlv: Tlv): Date {
  const text = latin1(bytesOf(der, tlv));
  const match =
    tlv.tag === TAG_UTC_TIME
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
      : tlv.tag === TAG_GENERALIZED_TIME
        ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(text)
        : null;
  if (!match) throw new DerError(`unsupported certificate time: ${text}`);
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
  // 50の境界はRFC 5280の規定。
  const year = tlv.tag === TAG_UTC_TIME ? (y as number) + ((y as number) >= 50 ? 1900 : 2000) : (y as number);
  return new Date(Date.UTC(year, (mo as number) - 1, d, h, mi, s));
}

const ALT_NAME_UNSAFE = new Set(['"', "\\", ",", "'"]);

function isPrintableAscii(code: number): boolean {
  return code >= 0x20 && code <= 0x7e;
}

// 引用規則はNodeのPrintAltNameに合わせる。utf8はDirName用で、非ASCIIを\u00XXにせずそのまま出す。
function quoteAltName(value: string, utf8 = false): string {
  const chars = Array.from(value);
  const safe = chars.every((char) => {
    const code = char.codePointAt(0) as number;
    return !ALT_NAME_UNSAFE.has(char) && (isPrintableAscii(code) || (utf8 && code >= 0x80));
  });
  if (safe) return value;
  const escaped = chars
    .map((char) => {
      const code = char.codePointAt(0) as number;
      if (char === "\\" || char === '"') return `\\${char}`;
      if ((isPrintableAscii(code) && char !== ",") || (utf8 && code >= 0x80)) return char;
      return `\\u${code.toString(16).padStart(4, "0")}`;
    })
    .join("");
  return `"${escaped}"`;
}

function formatIpAddress(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");
  if (bytes.length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      groups.push((((bytes[i] as number) << 8) | (bytes[i + 1] as number)).toString(16).toUpperCase());
    }
    return groups.join(":");
  }
  return "<invalid>";
}

function formatGeneralName(der: Uint8Array, name: Tlv): string {
  const bytes = bytesOf(der, name);
  switch (name.tag) {
    case 0xa0:
      return "othername:<unsupported>";
    case 0x81:
      return `email:${quoteAltName(latin1(bytes))}`;
    case 0x82:
      return `DNS:${quoteAltName(latin1(bytes))}`;
    case 0xa3:
      return "X400Name:<unsupported>";
    case 0xa4: {
      const [inner] = children(der, name);
      return `DirName:${inner ? quoteAltName(formatName(der, inner, RFC2253), true) : ""}`;
    }
    case 0xa5:
      return "EdiPartyName:<unsupported>";
    case 0x86:
      return `URI:${quoteAltName(latin1(bytes))}`;
    case 0x87:
      return `IP Address:${formatIpAddress(bytes)}`;
    case 0x88:
      return `Registered ID:${decodeOid(der, name)}`;
    default:
      return "<unsupported>";
  }
}

function formatSubjectAltName(der: Uint8Array, extnValue: Tlv): string {
  const inner = readTlv(der, extnValue.start, extnValue.end);
  return children(der, expectTag(inner, TAG_SEQUENCE))
    .map((name) => formatGeneralName(der, name))
    .join(", ");
}

function findSubjectAltName(der: Uint8Array, extensions: Tlv): string | undefined {
  const [list] = children(der, extensions);
  if (!list) return undefined;
  for (const extension of children(der, expectTag(list, TAG_SEQUENCE))) {
    const fields = children(der, expectTag(extension, TAG_SEQUENCE));
    const [id] = fields;
    if (!id || decodeOid(der, expectTag(id, TAG_OID)) !== OID_SUBJECT_ALT_NAME) continue;
    const value = fields.find((field) => field.tag === TAG_OCTET_STRING);
    if (!value) throw new DerError("malformed subjectAltName");
    return formatSubjectAltName(der, value);
  }
  return undefined;
}

function decodePem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----[\s\S]*$/, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

/** PEM 1ブロックを読む。DERとして読めなければ例外を投げる。署名は検証しない。 */
export function parseX509Pem(pem: string): X509Summary {
  const der = decodePem(pem);
  const certificate = expectTag(readTlv(der, 0), TAG_SEQUENCE);
  const [tbsTlv] = children(der, certificate);
  if (!tbsTlv) throw new DerError("empty certificate");
  const tbs = children(der, expectTag(tbsTlv, TAG_SEQUENCE));
  // version([0])は省略可能で、省略時はserialNumberから始まる。
  const fields = tbs[0]?.tag === TAG_VERSION ? tbs.slice(1) : tbs;
  const [, , , validity, subject] = fields;
  if (!validity || !subject) throw new DerError("truncated tbsCertificate");
  const [, notAfter] = children(der, expectTag(validity, TAG_SEQUENCE));
  if (!notAfter) throw new DerError("missing notAfter");
  const extensions = fields.find((field) => field.tag === TAG_EXTENSIONS);
  return {
    validTo: parseTime(der, notAfter),
    subject: formatName(der, subject, MULTILINE),
    subjectAltName: extensions ? findSubjectAltName(der, extensions) : undefined,
  };
}
