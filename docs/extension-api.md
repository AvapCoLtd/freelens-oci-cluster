---
last_verified: 2026-07-15
---

# FreeLens 拡張 API の情報源

FreeLens 拡張開発で参照すべき情報源へのポインタ集。
陳腐化を避けるため、ここには内容を転記せずリンク先を一次情報として参照すること。
リンク切れ・記述齟齬を見つけたら本ファイルを更新する（frontmatter の `last_verified` も併せて更新）。

## 一次情報（FreeLens 公式）

| 情報源 | URL | 何がわかるか |
|---|---|---|
| FreeLens 公式ドキュメント | <https://freelensapp.github.io/docs/> | 拡張の全体像。`LensRendererExtension` / `LensMainExtension` クラス、`globalPages` / `clusterPages` 等の登録ポイント |
| freelensapp/freelens（本体リポジトリ） | <https://github.com/freelensapp/freelens> | 実装の最終的な真実。API の挙動が不明なときはここを読む |
| freelens 本体 Wiki: Extensions | <https://github.com/freelensapp/freelens/wiki/Extensions> | 拡張の配布・インストール周りの運用情報 |
| freelensapp/freelens-example-extension | <https://github.com/freelensapp/freelens-example-extension> | 公式サンプル。clusterPages でのカスタムページ実装例。新規プラグインの雛形として最有力 |
| npm: `@freelensapp/extensions` | <https://www.npmjs.com/package/@freelensapp/extensions> | 拡張が依存する公開 API パッケージ（`@freelensapp/core` の再エクスポート）。型定義がそのまま API リファレンスになる |
| npm: `@freelensapp/legacy-extensions` | <https://www.npmjs.com/package/@freelensapp/legacy-extensions> | 旧 Lens (OpenLens) 拡張 API との互換レイヤ |

## 補助情報（旧 Lens / upstream）

FreeLens は OpenLens の fork。
拡張の概念モデルは旧 Lens のドキュメントがそのまま概ね通用する。
対象は main/renderer の 2 プロセス構成、IPC、各種 Registration。
ただし、記述が FreeLens の現状と食い違う場合は上の一次情報を優先する。

| 情報源 | URL | 何がわかるか |
|---|---|---|
| Lens Extension API docs | <https://api-docs.k8slens.dev/> | ガイドが体系的。Extension Anatomy / Main Extension / Renderer Extension / IPC（`broadcast` / `invoke` / `listen` / `handle`）の解説 |

## 実例

外部ドキュメントより先に、まず動いている実例として本リポジトリの `src` を読むこと。

- freelens-oci-cluster（本リポジトリ、[README](../README.md)）:
  `clusterPageMenus` 登録 + `node:child_process`（`execFile`）による外部 CLI 呼び出し、`Renderer.K8sApi` の KubeObjectStore（`nodesStore` / `serviceStore` / `persistentVolumeStore` 等）使用例。
  [docs/design.md](design.md) に OCI リソースの対応関係解決やエラー分類などドメイン固有の設計判断の記録あり
- [freelens-cluster-sidebar](https://github.com/AvapCoLtd/freelens-cluster-sidebar):
  `topBarItems` 登録 + `ReactDOM.createPortal` による常駐 UI、`Renderer.Catalog` の使用例。
  同プラグインの `docs/design.md` に Extension API の構造的制約（`clusterFrameComponents` がクラスタ iframe 内でしか生きない等）の調査記録あり
- [freelens-locale-ja](https://github.com/AvapCoLtd/freelens-locale-ja):
  公式登録 API を使わない実行時パッチ方式の例。
  `src/renderer/collector.ts` は renderer コードから `node:fs` を直接 import して使う実例
- ビルド枠組み（electron-vite の main/preload 分離、host 提供ランタイムの global externalize、CommonJS 必須）は `electron.vite.config.js` のコメントに理由付きで記載

## 型定義 = API リファレンス

`@freelensapp/extensions` の実体は `@freelensapp/core` の再エクスポート。
公開 API の正確な形は型定義を直接読むのが確実。
ビルド後の `node_modules/@freelensapp/core` 配下にある（`lens-renderer-extension.d.ts`、`renderer/routes/page-registration.d.ts` 等）。

## 要点（ポインタの読み方）

- 拡張は renderer（UI・React）と main（Electron main プロセス）の 2 エントリポイント構成。
  独立ページ追加は renderer 側の `globalPages` / `clusterPages`（`PageRegistration[]`）に登録する。
- このリポジトリの構成では renderer エントリは preload script としてビルドされるため、renderer コードから Node.js ビルトインモジュールへ直接アクセスできる（本リポジトリの `oci/run.ts` で `node:child_process` 実証済み）。
  main + IPC（`broadcast`/`invoke`/`listen`/`handle`）経由の構成も選べる。
- sandbox 制限の明示的な公式記述は未確認だが、renderer からの `child_process` 実行は実機検証で動作確認済み（Windows ネイティブ FreeLens）
- `clusterPageMenus` は上流 Lens の公式ガイド例より公式 FluxCD 拡張の実装を正とする（<https://github.com/freelensapp/freelens-fluxcd-extension>）。
  実機で確認した差異が2件ある。
  全エントリ（親・子とも）に一意な `id` が必須（`id` 省略時は登録キーが拡張 ID 単体に潰れ、複数エントリが後勝ちで上書きされる）。
  親エントリにも `target` を併記する（ガイドは「`id` 指定時 `target` は無視される」と書くが、実機ではサイドバーの active ハイライト挙動に影響した）。
  さらに親の `target` を子と同じ pageId にする場合、子エントリを配列で親より先に置く。
  上部タブストリップは「そのページを target に持つ最初のエントリ」の `parentId` から兄弟を導出するため、親が先だとそのページだけタブが消える。
- `Renderer.K8sApi` の KubeObjectStore を自前ページから使う場合、namespaced リソースの `loadAll()` は FreeLens 上部の名前空間フィルタ選択に従う（`contextNamespaces` 既定）。
  全件が要るなら `namespaceStore` から全名前空間を取り `loadAll({ namespaces })` で明示する。
  cluster-scoped リソース（Node / PV 等）はこの影響を受けない（実機で遭遇）。
- `clusterPages[].components.Page` に `observer()` 済みコンポーネントを渡さない。
  ホスト側 (`extension-route-registrator`) が再度 `observer()` を適用するため mobx-react-lite が throw し、自拡張の登録中断に加え他拡張のサイドバー項目まで消える（v1.8.0〜1.10.3 の core 実装で確認、実機で遭遇）。
  ページ内部の子コンポーネントの `observer()` は問題ない。
