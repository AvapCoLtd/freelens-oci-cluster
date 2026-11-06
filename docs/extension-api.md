---
last_verified: 2026-11-06
---

# FreeLens拡張APIの情報源

> FreeLens Extension API の仕様や実装上の罠を調査するときに参照する。

FreeLens拡張開発で参照すべき情報源へのポインタ集。

陳腐化を避けるため、ここには内容を転記せずリンク先を一次情報として参照すること。
リンク切れ・記述齟齬を見つけたら本ファイルを更新する（frontmatterの `last_verified` も併せて更新）。

## 一次情報（FreeLens公式）

| 情報源 | URL | 何がわかるか |
|---|---|---|
| FreeLens公式ドキュメント | <https://freelensapp.github.io/docs/> | 拡張の全体像。基底クラス（`Renderer.LensExtension` / `Main.LensExtension`）、`globalPages` / `clusterPages` 等の登録ポイント |
| freelensapp/freelens（本体リポジトリ） | <https://github.com/freelensapp/freelens> | 実装の最終的な真実。APIの挙動が不明なときはここを読む |
| freelens本体Wiki: Extensions | <https://github.com/freelensapp/freelens/wiki/Extensions> | 拡張の配布・インストール周りの運用情報 |
| freelensapp/freelens-example-extension | <https://github.com/freelensapp/freelens-example-extension> | 公式サンプル。clusterPagesでのカスタムページ実装例。新規プラグインの雛形として最有力 |
| FreeLens拡張API契約 | <https://github.com/freelensapp/freelens/blob/main/docs/extensions/api.md> | v2のホストが拡張に保証する挙動。型定義に現れない約束（rendererエントリ隣のCSSの自動読み込み〈C10〉、配置先〈Delivery〉等）はここで確かめる |
| FreeLens v2移行ガイド | <https://github.com/freelensapp/freelens/blob/v2.0.0/docs/extensions/migrating-from-v1.md> | v1拡張をv2へ移すときの必須変更。削除・改名されたAPIの対応表（v1→v2 rename table）もここにある |
| npm: `@freelensapp/extensions` | <https://www.npmjs.com/package/@freelensapp/extensions> | 拡張が依存する公開APIパッケージ。v2では `globalThis.FreelensExtensionApi` を読むだけのshimと、単一の型定義 `dist/extension-api.d.ts` からなる。型定義がそのままAPIリファレンスになる |
| npm: `@freelensapp/legacy-extensions` | <https://www.npmjs.com/package/@freelensapp/legacy-extensions> | 旧Lens (OpenLens) 拡張APIとの互換レイヤ |

## 補助情報（旧Lens / upstream）

FreeLensはOpenLensのfork。
拡張の概念モデルは旧Lensのドキュメントがそのまま概ね通用する。

対象はmain/rendererの2プロセス構成、IPC、各種Registration。
ただし、記述がFreeLensの現状と食い違う場合は上の一次情報を優先する。

| 情報源 | URL | 何がわかるか |
|---|---|---|
| Lens Extension API docs | <https://api-docs.k8slens.dev/> | ガイドが体系的。Extension Anatomy / Main Extension / Renderer Extension / IPC（`broadcast` / `invoke` / `listen` / `handle`）の解説 |

## 実例

外部ドキュメントより先に、まず動いている実例として本リポジトリの `src` を読むこと。

- freelens-oci-cluster（本リポジトリ、[README](../README.md)）: `clusterPageMenus` 登録、`Renderer.K8sApi` のKubeObjectStore（`nodesStore` / `serviceStore` / `persistentVolumeStore` 等）使用例。
  外部CLIの実行（`node:child_process` の `execFile`）とDNS解決をmainに置き、rendererからIPC（`invoke` / `handle`）で呼ぶ実例でもある（[main/index.ts](../src/main/index.ts)、[renderer/oci-ipc.ts](../src/renderer/oci-ipc.ts)）。
  [docs/design.md](design.md)にOCIリソースの対応関係解決やエラー分類などドメイン固有の設計判断の記録あり
- [freelens-cluster-sidebar](https://github.com/AvapCoLtd/freelens-cluster-sidebar): `topBarItems` 登録 + `ReactDOM.createPortal` による常駐UI、`Renderer.Catalog` の使用例。
  同プラグインの `docs/design.md` にExtension APIの構造的制約（`clusterFrameComponents` がクラスタiframe内でしか生きない等）の調査記録あり
- [freelens-locale-ja](https://github.com/AvapCoLtd/freelens-locale-ja): 公式登録APIを使わない実行時パッチ方式の例。
  `src/renderer/collector.ts` はrendererコードから `node:fs` を直接importして使う。
  ただしFreeLens 1.x向けの実装で、rendererからのNode利用はv2では使えない
- ビルド枠組み（Viteをrenderer用・main用の2回実行し、どちらもESMで出力する。host提供ライブラリは `globalThis.FreelensExtensionApi` へ置き換える）は[vite.config.mjs](../vite.config.mjs)と[build/vite-plugin-host-modules.mjs](../build/vite-plugin-host-modules.mjs)に記載

## 型定義 = APIリファレンス

公開APIの正確な形は型定義を直接読むのが確実。
v2では `node_modules/@freelensapp/extensions/dist/extension-api.d.ts` の1ファイルに全名前空間がまとまっている。

## 要点（ポインタの読み方）

- 拡張はrenderer（UI・React）とmain（Electron mainプロセス）の2エントリポイント構成。
  独立ページ追加はrenderer側の `globalPages` / `clusterPages`（`PageRegistration[]`）に登録する。
- FreeLens 2.0のrendererにはNode / Electronの保証がない（`require()` も含む）。
  rendererエントリはESMとしてブラウザ向けにビルドする。
  Nodeが要る処理はmainに置き、IPC（`broadcast`/`invoke`/`listen`/`handle`）で呼ぶ。
  IPCで渡せるのは構造化複製できる値だけなので、`Error` は素のオブジェクトに直して返す。
  `Ipc` のインスタンスは拡張の無効化時にホストが破棄するため、`onActivate` のたびに `createInstance` してよい（2.0.0の `IpcMain` / `IpcRenderer` 実装で確認）。
- `clusterPageMenus` は上流Lensの公式ガイド例より公式FluxCD拡張の実装を正とする（<https://github.com/freelensapp/freelens-fluxcd-extension>）。
  実機で確認した差異が2件ある。
  全エントリ（親・子とも）に一意な `id` が必須（`id` 省略時は登録キーが拡張ID単体に潰れ、複数エントリが後勝ちで上書きされる）。
  親エントリにも `target` を併記する（ガイドは「`id` 指定時 `target` は無視される」と書くが、実機ではサイドバーのactiveハイライト挙動に影響した）。
  さらに親の `target` を子と同じpageIdにする場合、子エントリを配列で親より先に置く。
  上部タブストリップは「そのページをtargetに持つ最初のエントリ」の `parentId` から兄弟を導出するため、親が先だとそのページだけタブが消える。
- `Renderer.K8sApi` のKubeObjectStoreを自前ページから使う場合、namespacedリソースの `loadAll()` はFreeLens上部の名前空間フィルタ選択に従う（`contextNamespaces` 既定）。
  全件が要るなら `namespaceStore` から全名前空間を取り `loadAll({ namespaces })` で明示する。
  cluster-scopedリソース（Node / PV等）はこの影響を受けない（実機で遭遇）。
- `Common.Store.ExtensionStore` はmain/renderer両方の `onActivate` で `loadExtension` する。
  main/renderer両方から使うstoreは `src/common/store/` に置く（renderer専用storeは `src/renderer/store/`）。
  store-sync IPCは、renderer→`store-sync-main:<path>`→mainが受けて `store-sync-renderer:<path>` で全フレームへ再配信する中継構造である。
  このため、rendererだけだとroot frame（Preferences）の変更がcluster frameへ届かない。
  さらに、各フレームのpersist reactionは自分のメモリ状態でファイルを直接書く。
  そのため、cluster frame側のstore変化（polling toggle等）が旧値でファイルを上書きし、UIで保存したはずの設定が消える。
  この挙動は実機で遭遇し、v1.10.3 coreの `create-persistent-storage` 実装で確認した。
  2.0.0にも同じチャネル（`store-sync-main` / `store-sync-renderer`）がある。
- `clusterPages[].components.Page` に `observer()` 済みコンポーネントを渡さない。
  ホスト側（`extension-route-registrator`）が再度 `observer()` を適用するため、mobx-react-liteがthrowする。
  その結果、自拡張の登録が中断するうえ、他拡張のサイドバー項目まで消える（v1.8.0〜1.10.3のcore実装で確認、実機で遭遇）。
  2.0.0もページを `observer(registration.components.Page)` で包む。
  ページ内部の子コンポーネントの `observer()` は問題ない。
