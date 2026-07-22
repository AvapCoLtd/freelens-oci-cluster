[English](CONTRIBUTING.en.md)

# Contributing

## 環境構築

`make build` / `make deploy` 等はすべて Docker コンテナ内で完結する。
ホストに必要なのは Docker と `jq` のみ。

コントリビューターごとに異なるパス(ローカルの FreeLens 拡張機能ディレクトリ等)は、リポジトリルートの `.env` ファイル(gitignore対象)に置く。

```sh
# `make deploy` のデプロイ先(FreeLens拡張機能ディレクトリ)。
# 未設定だと `make deploy` はエラーで停止する。
# 例(WSLからネイティブWindows版FreeLensを操作する場合):
#   /mnt/c/Users/<user>/.freelens/extensions
FREELENS_EXT_DIR=
```

`make <target> VAR=value` で実行時に個別上書きも可能。

## ビルド・テスト・デプロイ

ビルドは完全にコンテナ化されており、pnpm・node・electronはビルドイメージ内に自己完結している。

```sh
make build    # 依存関係インストール + ビルド
make deploy   # ビルド + FREELENS_EXT_DIR へデプロイ
make test     # vitest スイート実行
make lint     # Biome lint
make fmt      # Biome format (--write)
make pack     # .tgz へパック
make clean    # node_modules/out/*.tgz/.pnpm-store を削除
```

## リリース手順

1. `package.json` の `version` をリリースしたい値に上げ、コミット
2. `make tag` を実行。`package.json` のバージョンから `vX.Y.Z` タグを作成しpushする(既に同名タグがあれば拒否される)
3. GitLab CIがタグを検知し、以下を実行
   - Docker内で拡張機能をビルドし `.tgz` へパック(`make pack`)
   - `.tgz` とその `.sha256` を GitLab Generic Package Registry へアップロード
   - それらのファイルを添付した GitLab Release を作成
   - リポジトリをGitHubへミラー
   - `.tgz` と `.sha256` を添付した GitHub Release を作成

GitHubミラー処理は、プロジェクトにCI変数 `GH_APP_ID` / `GH_APP_PRIVATE_KEY` が設定されている場合のみ実行される。
設定済みなら `master` へのpushとタグ作成のたびに自動でGitHubへミラーされる。未設定ならGitLabのみが正とされ、GitHub関連ジョブはスキップされる。
