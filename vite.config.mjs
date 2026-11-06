import { builtinModules, isBuiltin } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defaultServerConditions, defaultServerMainFields, defineConfig } from "vite";
import { hostModules } from "./build/vite-plugin-host-modules.mjs";

const entryPoints = {
  renderer: {
    entry: "src/renderer/index.tsx",
    // builtin を external にしない: ESM の bare import が freelens-extension:// から解決できず、
    // 拡張ごとロードに失敗する。
    external: [],
    platform: /** @type {const} */ ("browser"),
  },
  main: {
    entry: "src/main/index.ts",
    external: ["electron", /^electron\//, /^node:/, ...builtinModules],
    // browser のままにしない: bundle 内の require() が ESM で throw する shim になる。
    platform: /** @type {const} */ ("node"),
  },
};

// Vite は renderer の builtin import を空モジュールに置き換えて警告するだけなので、ビルドを失敗させる。
/** @type {import("vite").Plugin} */
const noNodeInRenderer = {
  name: "no-node-in-renderer",
  enforce: "pre",
  resolveId(source, importer) {
    if (isBuiltin(source) || source === "electron" || source.startsWith("electron/")) {
      this.error(`"${source}" is imported by ${importer}, but renderer code gets no Node or Electron`);
    }
    return null;
  },
};

export default defineConfig(({ mode }) => {
  const name = mode === "main" ? "main" : "renderer";
  const entryPoint = entryPoints[name];

  return {
    plugins: [hostModules(name), react(), ...(name === "renderer" ? [noNodeInRenderer] : [])],
    ...(name === "renderer"
      ? {
          // ライブラリモードは process.env.NODE_ENV を残すが、renderer には process が無い。
          define: { "process.env.NODE_ENV": JSON.stringify("production") },
          // mock/はgitignore対象で、make build-mock(README用スクリーンショット)だけが使う。
          resolve: {
            alias:
              process.env.MOCK === "1"
                ? [
                    {
                      find: /^\.+\/store\/oci-cluster-store$/,
                      replacement: resolve(import.meta.dirname, "mock/oci-cluster-store.mock.ts"),
                    },
                    {
                      find: /^\.+\/store\/k8s-adapter$/,
                      replacement: resolve(import.meta.dirname, "mock/k8s-adapter.mock.ts"),
                    },
                  ]
                : [],
          },
        }
      : {
          resolve: { conditions: [...defaultServerConditions], mainFields: [...defaultServerMainFields] },
          define: { __dirname: "import.meta.dirname", __filename: "import.meta.filename" },
        }),
    build: {
      target: "esnext",
      minify: false,
      sourcemap: true,
      outDir: `out/${name}`,
      emptyOutDir: true,
      lib: {
        entry: entryPoint.entry,
        formats: ["es"],
        fileName: () => "index.js",
        cssFileName: "index",
      },
      rolldownOptions: {
        external: entryPoint.external,
        platform: entryPoint.platform,
      },
    },
  };
});
