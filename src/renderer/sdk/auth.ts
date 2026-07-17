import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as common from "oci-common";
import { type AuthCred, parseCredJson } from "../match/auth-contract";
import type { OciResult } from "./result";

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 4 * 1024 * 1024;

/**
 * 解決済み認証。provider(鍵を内包)はこのモジュールの外では引数として渡すのみとし、
 * mobx store・UI・永続化に入れてはならない(設計 Decision #3)。
 */
export interface ResolvedAuth {
  provider: common.AuthenticationDetailsProvider;
  regionId: string;
}

// 鍵の寿命 = このモジュール変数の寿命 = クラスタフレームの生存期間(設計 Decision #5)。
let cached: { key: string; auth: ResolvedAuth } | null = null;

class SessionTokenAuthDetailsProvider implements common.AuthenticationDetailsProvider {
  constructor(
    private readonly token: string,
    private readonly privateKeyPem: string,
  ) {}

  async getKeyId(): Promise<string> {
    return `ST$${this.token}`;
  }

  getPrivateKey(): string {
    return this.privateKeyPem;
  }

  getPassphrase(): string | null {
    return null;
  }
}

function configFilePath(): string {
  return process.env.OCI_CONFIG_FILE ?? join(homedir(), ".oci", "config");
}

function credCommandError(
  message: string,
  extra?: { code?: string | number | null; stderr?: string },
): OciResult<never> {
  return { ok: false, kind: "auth_command", raw: { message, code: extra?.code, stderr: extra?.stderr } };
}

// 認証情報コマンドのstdoutは鍵そのもの: エラー経路(message/stderr表示)に決して乗せない。
function execCredCommand(authCommand: string): Promise<OciResult<string>> {
  const [command, ...args] = authCommand.trim().split(/\s+/);
  return new Promise((resolvePromise) => {
    execFile(command, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        resolvePromise(credCommandError("認証情報コマンドの実行に失敗しました", { code: error.code, stderr }));
        return;
      }
      resolvePromise({ ok: true, data: stdout });
    });
  });
}

function buildProviderFromCred(cred: AuthCred): OciResult<ResolvedAuth> {
  try {
    if (cred.type === "api_key") {
      const provider = new common.SimpleAuthenticationDetailsProvider(
        cred.tenancy,
        cred.user,
        cred.fingerprint,
        cred.privateKeyPem,
        null,
        common.Region.fromRegionId(cred.region),
      );
      return { ok: true, data: { provider, regionId: cred.region } };
    }
    return {
      ok: true,
      data: { provider: new SessionTokenAuthDetailsProvider(cred.token, cred.privateKeyPem), regionId: cred.region },
    };
  } catch (error) {
    return credCommandError(`認証情報から認証プロバイダを構築できません: ${String(error)}`);
  }
}

async function resolveFromCommand(authCommand: string): Promise<OciResult<ResolvedAuth>> {
  const output = await execCredCommand(authCommand);
  if (!output.ok) return output;
  const parsed = parseCredJson(output.data);
  if (!parsed.ok) {
    switch (parsed.reason) {
      case "invalid_json":
        return credCommandError("認証情報コマンドの出力がJSONとして解釈できません(出力自体は表示しません)");
      case "unknown_type":
        return credCommandError('認証情報JSONの"type"が不正です(api_key / security_token のみ対応)');
      case "missing_fields":
        return credCommandError(`認証情報JSONにフィールドが欠落しています: ${parsed.missing.join(", ")}`);
    }
  }
  return buildProviderFromCred(parsed.cred);
}

function resolveFromConfigFile(): OciResult<ResolvedAuth> {
  try {
    // security_token_fileを持つプロファイルはSessionAuthDetailProviderで読む(refreshSessionToken対応)。
    const path = configFilePath();
    const hasSessionToken = !!common.ConfigFileReader.parseFileFromPath(path, null).get("security_token_file");
    const provider = hasSessionToken
      ? new common.SessionAuthDetailProvider(path)
      : new common.ConfigFileAuthenticationDetailsProvider(path);
    const regionId = provider.getRegion()?.regionId;
    if (!regionId) {
      return { ok: false, kind: "other", raw: { message: "~/.oci/config にregionがありません" } };
    }
    return { ok: true, data: { provider, regionId } };
  } catch (error) {
    return { ok: false, kind: "other", raw: { message: `~/.oci/config の読み取りに失敗しました: ${String(error)}` } };
  }
}

function resolveAuthUncached(authCommand: string): Promise<OciResult<ResolvedAuth>> | OciResult<ResolvedAuth> {
  if (authCommand.trim().length > 0) return resolveFromCommand(authCommand);
  if (existsSync(configFilePath())) return resolveFromConfigFile();
  return {
    ok: false,
    kind: "auth_missing",
    raw: { message: "~/.oci/config が存在せず、認証情報コマンドも未設定です" },
  };
}

/** 認証解決(設計 Decision #2: 認証情報コマンド → ~/.oci/config の順)。成功結果はフレーム生存期間キャッシュ。 */
export async function getAuth(authCommand: string): Promise<OciResult<ResolvedAuth>> {
  if (cached?.key === authCommand) return { ok: true, data: cached.auth };
  const result = await resolveAuthUncached(authCommand);
  if (result.ok) cached = { key: authCommand, auth: result.data };
  return result;
}

/**
 * NotAuthenticated検出時の再解決(1回だけ呼ぶのは呼び出し元の責務)。
 * config+セッショントークンはrefreshSessionToken()を先に試す(SDKは自動リフレッシュしない: PoC ③)。
 */
export async function reresolveAuth(authCommand: string): Promise<OciResult<ResolvedAuth>> {
  const current = cached;
  cached = null;
  if (current && current.auth.provider instanceof common.SessionAuthDetailProvider) {
    try {
      await current.auth.provider.refreshSessionToken();
      cached = current;
      return { ok: true, data: current.auth };
    } catch {
      // リフレッシュ失敗は再解決にフォールバック(失効しきったトークンはconfig再読込でも直らないが、
      // 利用者が oci session authenticate し直した後の再取得はここで拾える)
    }
  }
  return getAuth(authCommand);
}
