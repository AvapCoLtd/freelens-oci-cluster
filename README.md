# freelens-oci-cluster

![License](https://img.shields.io/github/license/AvapCoLtd/freelens-oci-cluster)
![Release](https://img.shields.io/github/v/release/AvapCoLtd/freelens-oci-cluster)

開いているクラスタの基盤 OCI リソースを、FreeLens 上で確認できるようにする。

![ネットワークページ: LB/NLB 行を展開し、backend health が CRITICAL と表示された状態](docs/images/network-lb-critical.png)

[English](README.en.md)

FreeLens は Kubernetes リソースを表示する。
クラスタが Oracle Cloud Infrastructure (OCI) 上で動くことがある(例: OKE)。
その場合、対応する OCI リソースを確認する手段が標準にはない。

- Node → Instance
- Service(type=LoadBalancer) → NLB / classic LB
- PersistentVolume → Block Volume / FSS

`freelens-oci-cluster` は「OCI」クラスタサイドバーメニューを追加する。
開いているクラスタについて、Node の `providerID` を起点にこれらの OCI リソースを自動解決して表示する。
対応関係の解決方法や既知の制約を含む設計判断・ドメイン知識は [docs/design.md](docs/design.md) を参照。

## 前提条件

`oci` CLI(または同じ引数を受ける互換コマンド)が動く環境が必要。
プラグインはデータ取得のたびにこのコマンドを子プロセスとして実行し、標準出力の JSON を読む。

- `oci` が PATH にあり、認証が通っていること。
  認証方式は問わない(`~/.oci/config` の API キー認証、`oci session authenticate` のセッショントークン認証など)
- 設定ファイルを置かない環境(シークレットマネージャ運用等)でも、
  認証情報を注入して `oci` を起動するラッパコマンドを用意すれば、それを指定して使える(下記「設定」を参照)
- プラグインは鍵・トークンを一切受け取らない。認証は `oci` の内部で完結する

## 対応バージョン

FreeLens 1.8.0 以上(package.json の `engines` を参照)。
FreeLens 1.10.3(Extension API 1.10.3、Windows x64)で動作確認済み。

## インストール

1. GitHub Releases から最新の `.tgz` をダウンロードする: <https://github.com/AvapCoLtd/freelens-oci-cluster/releases>
2. FreeLens の Extensions 画面にドラッグ&ドロップする
3. 更新時も同じ手順を新しい `.tgz` で繰り返す

## 使い方

1. 拡張機能をデプロイし、FreeLens でクラスタに接続する
2. クラスタサイドバーの「OCI」メニューをクリックする
3. OKE クラスタではヘッダにクラスタ情報が表示される。
   「OCI」配下の子メニュー(ノード / Service↔LB / PV↔ストレージ / ネットワーク)でリソースページを切り替えられる。
   非 OKE クラスタでは対象外である旨のガイダンスが表示される。

ページごとの主な機能。

- **ノード**: K8s Node と OCI Instance の対応、ノードプールのサマリ
- **ネットワーク**: 「Service に繋がらない」調査を、外→内の経路順
  (DNS 突合 → WAF → LB/NLB → LB サブネットの SL/ルート → ノードサブネットの SL/ルート → クラスタ endpoint)で確認できる。
  行の展開でセキュリティルール・WAF ポリシー・証明書期限・ルート(経由ゲートウェイの生死)・
  backend health(unhealthy な backend の検出)を表示する
- **PV↔ストレージ**: Block Volume / FSS の対応とバックアップ(スナップショット)ポリシー

各ページのヘッダにあるトグルで自動更新を有効化できる(間隔は Preferences で変更可、既定60秒)。

閲覧専用。
本プラグインは OCI リソースの変更系操作を一切行わない。

### 設定

FreeLens の Preferences 内「OCI: oci command」に、実行するコマンドの入力欄がある。

- 空欄の場合は PATH の `oci` を実行する(通常はこちらで足りる)
- 値を設定すると、それを oci 互換コマンドとして実行する。
  `oci --profile foo` のように引数を前置してもよい
- 値は空白区切りで実行ファイルと前置引数に分解する。
  クォートは解釈しないため、空白を含む単一引数は指定できない
- 変更は次回のデータ取得(［更新］ボタン、またはクラスタの再選択)から反映される

FreeLens を Windows 側で動かし、`oci` は WSL 側にある構成の設定例。

```text
wsl oci
```

WSL 側に `~/.oci/config` を置かず、シークレットマネージャから認証情報を注入して `oci` を起動する
ラッパを用意している場合は、そのラッパを指定する(例: `wsl haj oci`)。

### 互換コマンド契約

`oci` の代わりに指定できるコマンドの条件。

- 渡された引数をそのまま `oci` へ転送し、標準出力・標準エラー・終了ステータスを素通しする
- プラグインが実行するサブコマンドを受け付ける。
  対象の全件は [src/renderer/cli/command-defs.ts](src/renderer/cli/command-defs.ts) が単一ソース
  (`get` / `list` / `search` の読み取り操作のみ。ここには転記しない)
- 出力契約
  - プラグインが全呼び出しに `--output json` を付ける。標準出力は `oci` と同じ JSON(`{"data": …}`)
  - list 系には `--all` を付ける。`--all` を持たない `search resource structured-search` のみ
    `--page` で手動ページングし、トップレベルの `opc-next-page` を辿る。
    手動ページングは最大 100 ページで打ち切り、超過はそのセクションのエラーになる
  - 成功は終了ステータス 0。標準エラーへの出力があっても 0 なら成功として扱う
  - 失敗は非ゼロの終了ステータス。標準エラーの `ServiceError:` の JSON からエラー種別
    (認証系 / 権限・不在 / その他)を判定する
- 1 呼び出しあたり 60 秒でタイムアウトする。同時に起動するプロセスは最大 8、
  1 呼び出しの標準出力は最大 64MiB(超過はそのセクションのみエラーになる)

標準出力・標準エラーに秘密が含まれない前提の契約であるため、
エラー表示には終了ステータスと標準エラーをそのまま出す。

### 旧「認証情報コマンド」からの移行

0.2 系までの Preferences「認証情報コマンド」(標準出力に認証情報 JSON を返すコマンド)は廃止した。
破壊的変更であり、設定値の自動移行は行わない。

- 旧設定の値は設定ファイル上に残るが、プラグインは読まない(oci コマンドとしても実行しない)
- 「OCI: oci command」欄を改めて設定する
  - `~/.oci/config` がある環境: 空欄のままでよい
  - `wsl haj oci-cred-json` のような認証情報コマンドを使っていた環境: `wsl oci` 等、
    WSL 側で `oci` が動くコマンドを指定する(認証情報の注入はコマンド側で完結させる)

開発: [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## リンク

- https://github.com/AvapCoLtd/freelens-oci-cluster (公開用)
- https://gitlab.avaper.day/avap/freelens-plugins/freelens-oci-cluster (開発用)

## License

MIT
