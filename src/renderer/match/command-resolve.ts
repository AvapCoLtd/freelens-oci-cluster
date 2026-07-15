const DEFAULT_COMMAND = ["oci"];

/**
 * oci CLI コマンドの解決(既定値 + 上書き文字列)。
 * 既定はプラットフォームによらず oci: インストール先は利用者の環境次第のため、
 * 環境差異は Preferences の上書きで吸収する。
 * 上書き文字列はスペース区切りでargv分解する(`--profile FOO`等の追加引数を許容するため)。
 */
export function resolveOciCommand(override: string): string[] {
  const trimmed = override.trim();
  if (trimmed.length > 0) return trimmed.split(/\s+/);
  return [...DEFAULT_COMMAND];
}
