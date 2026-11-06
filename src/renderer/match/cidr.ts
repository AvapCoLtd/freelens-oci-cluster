interface ParsedIp {
  family: 4 | 6;
  value: bigint;
}

interface ParsedCidr extends ParsedIp {
  network: bigint;
  mask: bigint;
  prefix: number;
}

function parseIpv4(text: string): bigint | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6Groups(part: string): bigint[] | undefined {
  if (part === "") return [];
  const tokens = part.split(":");
  const groups: bigint[] = [];
  for (const [index, token] of tokens.entries()) {
    // 末尾のIPv4記法(::ffff:10.0.0.1)は16bit×2として畳む
    if (token.includes(".")) {
      if (index !== tokens.length - 1) return undefined;
      const embedded = parseIpv4(token);
      if (embedded === undefined) return undefined;
      groups.push(embedded >> 16n, embedded & 0xffffn);
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(token)) return undefined;
    groups.push(BigInt(`0x${token}`));
  }
  return groups;
}

function parseIpv6(text: string): bigint | undefined {
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = parseIpv6Groups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseIpv6Groups(halves[1] ?? "") : [];
  if (!head || !tail) return undefined;
  const total = head.length + tail.length;
  if (halves.length === 2 ? total > 7 : total !== 8) return undefined;
  const groups = [...head, ...new Array<bigint>(8 - total).fill(0n), ...tail];
  return groups.reduce((acc, group) => (acc << 16n) | group, 0n);
}

function parseIp(text: string | undefined | null): ParsedIp | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (trimmed.includes(":")) {
    const value = parseIpv6(trimmed);
    return value === undefined ? undefined : { family: 6, value };
  }
  const value = parseIpv4(trimmed);
  return value === undefined ? undefined : { family: 4, value };
}

function parseCidr(text: string | undefined | null): ParsedCidr | undefined {
  if (!text) return undefined;
  const slash = text.indexOf("/");
  if (slash < 0) return undefined;
  const address = parseIp(text.slice(0, slash));
  const prefixText = text.slice(slash + 1).trim();
  if (!address || !/^\d{1,3}$/.test(prefixText)) return undefined;
  const prefix = Number(prefixText);
  const width = address.family === 4 ? 32 : 128;
  if (prefix > width) return undefined;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(width - prefix);
  return { ...address, network: address.value & mask, mask, prefix };
}

/** IPがCIDRに含まれるか。アドレスファミリ不一致・不正表記はfalse(例外にしない)。 */
export function ipInCidr(ip: string | undefined | null, cidr: string | undefined | null): boolean {
  const address = parseIp(ip);
  const block = parseCidr(cidr);
  if (!address || !block || address.family !== block.family) return false;
  return (address.value & block.mask) === block.network;
}

/** outerがinnerを丸ごと含むか(同一CIDRもtrue)。不正表記・ファミリ不一致はfalse。 */
export function cidrContains(outer: string | undefined | null, inner: string | undefined | null): boolean {
  const a = parseCidr(outer);
  const b = parseCidr(inner);
  if (!a || !b || a.family !== b.family) return false;
  if (a.prefix > b.prefix) return false;
  return (b.network & a.mask) === a.network;
}

/** 2つのCIDRが1アドレスでも重なるか。CIDRは常に包含関係か素かのどちらかになる。 */
export function cidrOverlaps(a: string | undefined | null, b: string | undefined | null): boolean {
  return cidrContains(a, b) || cidrContains(b, a);
}

export function cidrPrefixLength(cidr: string | undefined | null): number | undefined {
  return parseCidr(cidr)?.prefix;
}
