# freelens-oci-cluster

開いているクラスタの基盤 OCI リソースを、FreeLens 上で確認できるようにする。

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

- `oci` CLI がインストール済みで、対象テナンシに対して認証済みであること(`oci session authenticate` 等)
- 使用する `oci` コマンドは Preferences で上書きできる(詳細は下記「設定」を参照)

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
   「OCI」配下の子メニュー(ノード / Service↔LB / PV↔ストレージ)でリソースページを切り替えられる。
   非 OKE クラスタでは対象外である旨のガイダンスが表示される。

閲覧専用。
本プラグインは OCI リソースの変更系コマンドを一切呼ばない。

### 設定

FreeLens の Preferences 内「OCI」に「OCI コマンド」の入力欄がある。

- 空欄の場合は既定のコマンド `oci` を使う(プレースホルダに表示される値)
- `--profile FOO` のような追加引数を含めた文字列(例: `oci --profile FOO`)も指定できる。
  スペース区切りでそのままコマンド引数に分解される。
- 変更は次回のデータ取得(［更新］ボタン、またはクラスタの再選択)から反映される

開発: [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## リンク

- https://github.com/AvapCoLtd/freelens-oci-cluster (公開用)
- https://gitlab.avaper.day/avap/freelens-plugins/freelens-oci-cluster (開発用)

## License

MIT
