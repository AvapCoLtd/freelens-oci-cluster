// 認証情報コマンドの stdout JSON 契約(設計: 機能仕様「認証情報コマンドの stdout 契約」)。
// 失敗理由に値そのもの(鍵・トークン等)を決して含めない: 呼び出し元がそのままエラー表示に使うため。

export interface ApiKeyCred {
  type: "api_key";
  tenancy: string;
  user: string;
  fingerprint: string;
  region: string;
  privateKeyPem: string;
}

export interface SecurityTokenCred {
  type: "security_token";
  token: string;
  privateKeyPem: string;
  region: string;
  tenancy: string;
}

export type AuthCred = ApiKeyCred | SecurityTokenCred;

export type CredParseResult =
  | { ok: true; cred: AuthCred }
  | { ok: false; reason: "invalid_json" }
  | { ok: false; reason: "unknown_type" }
  | { ok: false; reason: "missing_fields"; missing: string[] };

const REQUIRED_FIELDS: Record<AuthCred["type"], readonly string[]> = {
  api_key: ["tenancy", "user", "fingerprint", "region", "privateKeyPem"],
  security_token: ["token", "privateKeyPem", "region", "tenancy"],
};

export function parseCredJson(stdout: string): CredParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "invalid_json" };
  const record = parsed as Record<string, unknown>;
  const type = record.type;
  if (type !== "api_key" && type !== "security_token") return { ok: false, reason: "unknown_type" };
  const missing = REQUIRED_FIELDS[type].filter((field) => {
    const value = record[field];
    return typeof value !== "string" || value.length === 0;
  });
  if (missing.length > 0) return { ok: false, reason: "missing_fields", missing };
  return { ok: true, cred: record as unknown as AuthCred };
}
