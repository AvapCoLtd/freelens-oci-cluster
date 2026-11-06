[English](CONTRIBUTING.en.md)

# Contributing

## 環境構築

`make build` / `make deploy` 等はすべてDockerコンテナ内で完結する。
ホストに必要なのはDockerと `jq` のみ。

コントリビューターごとに異なるパス(ローカルのFreeLens拡張機能ディレクトリ等)は、リポジトリルートの `.env` ファイル(gitignore対象)に置く。

```sh
# `make deploy` のデプロイ先(FreeLens拡張機能ディレクトリ)。
# 未設定だと `make deploy` はエラーで停止する。
# 例(WSLからネイティブWindows版FreeLensを操作する場合):
#   /mnt/c/Users/<user>/AppData/Roaming/Freelens/extensions
FREELENS_EXT_DIR=
```

`make <target> VAR=value` で実行時に個別上書きも可能。

## ビルド・テスト・デプロイ

ビルドは完全にコンテナ化されており、pnpm・nodeはビルドイメージ内に自己完結している。

```sh
make build    # 依存関係インストール + ビルド
make deploy   # ビルド + FREELENS_EXT_DIR へデプロイ
make test     # vitest スイート実行
make lint     # Biome lint
make fmt      # Biome format (--write)
make pack     # .tgz へパック
make clean    # node_modules/out/*.tgz/.pnpm-store を削除
```

### 初回セットアップ

FreeLens 2.0は、拡張機能ディレクトリ直下の `freelens-oci-cluster/package.json` を起動時に見つけて登録する。
ただし新しく見つけた拡張機能は無効の状態で登録される。
初回の `make deploy` の後にFreeLensを再起動し、Extensions画面で `freelens-oci-cluster` を一度有効にすること。
以後の `make deploy` は再起動だけで反映される。

## リリース手順

1. `package.json` の `version` をリリースしたい値に上げ、コミット
2. `make tag` を実行。
   `package.json` のバージョンから `vX.Y.Z` タグを作成しpushする(既に同名タグがあれば拒否される)
3. GitLab CIがタグを検知し、以下を実行
   - Docker内で拡張機能をビルドし `.tgz` へパック(`make pack`)
   - `.tgz` とその `.sha256` をGitLab Generic Package Registryへアップロード
   - それらのファイルを添付したGitLab Releaseを作成
   - リポジトリをGitHubへミラー
   - `.tgz` と `.sha256` を添付したGitHub Releaseを作成

GitHubミラー処理は、プロジェクトにCI変数 `GH_APP_ID` / `GH_APP_PRIVATE_KEY` が設定されている場合のみ実行される。
設定済みなら `master` へのpushとタグ作成のたびに自動でGitHubへミラーされる。
未設定ならGitLabのみが正とされ、GitHub関連ジョブはスキップされる。
