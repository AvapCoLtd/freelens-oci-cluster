# freelens-oci-cluster

![License](https://img.shields.io/github/license/AvapCoLtd/freelens-oci-cluster)
![Release](https://img.shields.io/github/v/release/AvapCoLtd/freelens-oci-cluster)

開いているクラスタの基盤 OCI リソースを FreeLens 上で確認できるようにする。

![ネットワークページで LB/NLB の backend health が CRITICAL と表示された状態](docs/images/network-lb-critical.png)

[English](README.en.md)

Kubernetes と Oracle Cloud Infrastructure（OCI）の対応関係を可視化する。
この情報は FreeLens の標準機能では表示されない。

- Node → Instance
- Service（type=LoadBalancer）→ NLB / classic LB
- PersistentVolume → Block Volume / FSS

Node の `providerID` を起点に、開いているクラスタに関係する OCI リソースを自動解決する。
OCI リソースを変更する操作は行わない。

## 前提条件

FreeLens 1.8.0 以上と、認証済みの `oci` CLI が必要。
FreeLens 1.10.3（Extension API 1.10.3、Windows x64）で動作確認済み。

プラグインはデータ取得のたびに `oci` を子プロセスとして実行し、JSON 出力を読む。
鍵やトークンは受け取らず、認証は `oci` の内部で完結する。
ラッパコマンドや WSL 上の `oci` も設定できる。

## インストール

1. [GitHub Releases](https://github.com/AvapCoLtd/freelens-oci-cluster/releases) から最新の `.tgz` をダウンロードする。
2. FreeLens の Extensions 画面へドラッグ&ドロップする。
3. 更新時も新しい `.tgz` で同じ操作を行う。

## 使い方

FreeLens でクラスタへ接続し、クラスタサイドバーの「OCI」メニューを開く。
OKE クラスタでは次のページを利用できる。
非 OKE クラスタでは対象外である旨を表示する。

| ページ | 内容 |
|---|---|
| Nodes | K8s Node と OCI Instance の対応、ノードプールのサマリ |
| Service↔LB | LoadBalancer Service と NLB / classic LB の対応 |
| PV ↔ Storage | PersistentVolume と Block Volume / FSS の対応、バックアップポリシー |
| Network | DNS、WAF、LB/NLB、サブネット、ルート、backend health を外から内の経路順に確認 |
| Topology | クラスタ関連リソースの位置と接続を一枚の図で表示 |

各ページの検索バーは、展開領域を含む表示内容を絞り込む。
ヘッダのトグルで自動更新を有効にでき、更新間隔は Preferences で変更できる（既定60秒）。

## 設定

FreeLens の Preferences にある「OCI: oci command」へ実行コマンドを設定する。

- 空欄では PATH 上の `oci` を使う。
- `oci --profile foo` のような前置引数を指定できる。
- `wsl oci` のようなラッパコマンドを指定できる。
- 値は空白で分割され、クォートは解釈されない。

変更は次回のデータ取得から反映される。
互換コマンドの出力、タイムアウト、ページングなどの契約は[OCI コマンド連携](docs/oci-command.md)を参照。

## ドキュメント

| やりたいこと | 参照先 |
|---|---|
| 開発環境を準備する、テスト・リリースを行う | [Contributing](CONTRIBUTING.md) |
| OCI リソースの対応関係や設計理由を確認する | [設計判断の記録](docs/design.md) |
| `oci` のラッパ・互換コマンドを実装する | [OCI コマンド連携](docs/oci-command.md) |
| FreeLens Extension API の調査結果を確認する | [FreeLens 拡張 API の情報源](docs/extension-api.md) |

## リポジトリ

- [GitHub（公開・リリース）](https://github.com/AvapCoLtd/freelens-oci-cluster)
- [GitLab（開発）](https://gitlab.avaper.day/avap/freelens-plugins/freelens-oci-cluster)

## License

MIT
