import { builtinModules } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { globalExternals } from "./build/global-externals.js";

// host(Freelens)が提供するNode/Electronランタイムモジュールはexternalにする(bundleすると壊れる)。
// rolldownOptions指定はelectron-vite既定のrollupOptions.externalを無効化するため、ここで明示的に再列挙する。
const runtimeExternals = ["electron", /^electron\//, ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const decoratorOxcOptions = {
  legacy: true,
  emitDecoratorMetadata: true,
};

const decoratorBabelPlugins = [
  [
    "@babel/plugin-proposal-decorators",
    {
      version: "2023-05",
    },
  ],
];

const hostGlobalExternals = {
  "@freelensapp/extensions": "global.LensExtensions",
  mobx: "global.Mobx",
};

function rolldownOutput(preserveModulesRoot) {
  return {
    // "auto"(既定)にすると default export 混在時に警告が出る
    exports: "named",
    preserveModules: (process.env.VITE_PRESERVE_MODULES ?? "true") === "true",
    preserveModulesRoot,
  };
}

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, "src/main/index.ts"),
        // Freelens 1.xx 拡張は CommonJS モジュール
        formats: ["cjs"],
      },
      rolldownOptions: {
        external: runtimeExternals,
        output: rolldownOutput("src/main"),
      },
      sourcemap: true,
    },
    oxc: {
      decorator: decoratorOxcOptions,
    },
    plugins: [
      react({
        babel: {
          plugins: decoratorBabelPlugins,
        },
      }),
      globalExternals(hostGlobalExternals),
    ],
  },
  // Freelens の renderer process は Node.js モジュールを使えるため preload script として設定
  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, "src/renderer/index.tsx"),
        // Freelens 1.xx 拡張は CommonJS モジュール
        formats: ["cjs"],
      },
      outDir: "out/renderer",
      rolldownOptions: {
        external: runtimeExternals,
        output: rolldownOutput("src/renderer"),
      },
      sourcemap: true,
    },
    css: {
      modules: {
        localsConvention: "camelCaseOnly",
      },
    },
    oxc: {
      decorator: decoratorOxcOptions,
    },
    plugins: [
      react({
        babel: {
          plugins: decoratorBabelPlugins,
        },
      }),
      globalExternals({
        ...hostGlobalExternals,
        "mobx-react": "global.MobxReact",
        react: "global.React",
        "react-dom": "global.ReactDOM",
        "react-router-dom": "global.ReactRouterDom",
        "react/jsx-runtime": "global.ReactJsxRuntime",
      }),
    ],
  },
});
