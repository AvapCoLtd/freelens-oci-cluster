// vite-plugin-external は使わない: named export 検出が Rolldown の非決定的プリバンドルと衝突し、ビルドが断続的に失敗する(`[MISSING_EXPORT]`)。
// export 名はハードコードしない: インストール済みパッケージから検出する(バージョン更新で古くなるため)。

const fs = require("node:fs");
const path = require("node:path");

// __dirname は electron-vite がこの config helper をバンドルするため信頼できない: cwd を使う(ビルドは常にルートから実行される)。
const ROOT = process.cwd();

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// 有効なキーだが export const の識別子には使えない名前(削除すると生成コードが構文エラーになる)。
const RESERVED = new Set([
  "default",
  "__esModule",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function packageNameOf(id) {
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// react-dom/react-router-dom 等の host専用 peer dependency はルートに hoist されないため、pnpm virtual store を探索してフォールバックする。
function resolveEntry(id) {
  try {
    return require.resolve(id, { paths: [ROOT] });
  } catch {}
  const pnpmDir = path.join(ROOT, "node_modules", ".pnpm");
  let entries = [];
  try {
    entries = fs.readdirSync(pnpmDir);
  } catch {
    return null;
  }
  const prefix = `${packageNameOf(id).replace(/\//g, "+")}@`;
  for (const dir of entries.filter((e) => e.startsWith(prefix)).sort()) {
    const base = path.join(pnpmDir, dir, "node_modules", packageNameOf(id));
    try {
      return require.resolve(id, { paths: [path.dirname(base)] });
    } catch {}
  }
  return null;
}

// @freelensapp/extensions 等は require 時にブラウザ専用コードを実行して Node 上で落ちるため、実行せずソースを正規表現で解析する。
function namesFromSource(src) {
  const found = new Set();
  for (const block of src.matchAll(/__webpack_require__\.d\(\s*\w+\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    for (const m of block[1].matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)) found.add(m[1]);
  }
  for (const m of src.matchAll(/exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g)) found.add(m[1]);
  for (const m of src.matchAll(/Object\.defineProperty\(\s*exports\s*,\s*["']([A-Za-z_$][A-Za-z0-9_$]*)["']/g))
    found.add(m[1]);
  return [...found];
}

function resolveExportNames(id) {
  const entry = resolveEntry(id);
  try {
    const real = require(entry || id);
    const keys = Object.keys(real).filter((n) => IDENTIFIER_RE.test(n) && !RESERVED.has(n));
    if (keys.length > 0) return keys;
  } catch {}
  if (entry) {
    try {
      return namesFromSource(fs.readFileSync(entry, "utf8")).filter((n) => IDENTIFIER_RE.test(n) && !RESERVED.has(n));
    } catch {}
  }
  return [];
}

/**
 * @param {Record<string, string>} globals map of module id -> global expression
 *   (e.g. { react: "global.React" }).
 */
function globalExternals(globals) {
  const PREFIX = "\0global-external:";
  const codeCache = new Map();
  return {
    name: "global-externals",
    enforce: "pre",
    resolveId(id) {
      if (Object.prototype.hasOwnProperty.call(globals, id)) {
        return { id: PREFIX + id, moduleSideEffects: false };
      }
      return null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const moduleId = id.slice(PREFIX.length);
      let code = codeCache.get(moduleId);
      if (code == null) {
        const globalName = globals[moduleId];
        const names = resolveExportNames(moduleId);
        code = [
          `const __m = ${globalName};`,
          `export default __m;`,
          ...names.map((name) => `export const ${name} = __m.${name};`),
        ].join("\n");
        codeCache.set(moduleId, code);
      }
      return { code, moduleSideEffects: false };
    },
  };
}

module.exports = { globalExternals };
