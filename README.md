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

OCI への接続はプラグイン内蔵の OCI TypeScript SDK が直接行う(`oci` CLI は不要)。
認証情報は次のいずれかで用意する。

- `~/.oci/config`(または環境変数 `OCI_CONFIG_FILE` のパス)。API キー認証とセッショントークン認証(`oci session authenticate` で作成)の両方に対応
- 設定ファイルを置かない環境では、Preferences の「認証情報コマンド」(詳細は下記「設定」を参照)

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

FreeLens の Preferences 内「OCI」に「認証情報コマンド」の入力欄がある。

- 空欄の場合は `~/.oci/config` から認証する(通常はこちらで足りる)
- 設定した場合、そのコマンドを実行し標準出力の JSON から認証情報を受け取る。
  鍵をファイルに置かない環境(シークレットマネージャ運用等)向け。
  スペース区切りでそのままコマンド引数に分解される
- 認証情報はメモリ上でのみ保持し、ディスクには保存しない。
  漏洩防止のため、このコマンドの標準出力はエラー表示にも出さない
- 変更は次回のデータ取得(［更新］ボタン、またはクラスタの再選択)から反映される

認証情報コマンドが標準出力に書く JSON の形式を次に示す(全フィールド必須)。

```json
{
  "type": "api_key",
  "tenancy": "ocid1.tenancy.oc1..xxx",
  "user": "ocid1.user.oc1..xxx",
  "fingerprint": "aa:bb:...",
  "region": "ap-tokyo-1",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n..."
}
```

セッショントークン認証の場合は `"type": "security_token"` とし、
`token` / `privateKeyPem` / `region` / `tenancy` を渡す。

開発: [CONTRIBUTING.md](CONTRIBUTING.md) を参照。

## リンク

- https://github.com/AvapCoLtd/freelens-oci-cluster (公開用)
- https://gitlab.avaper.day/avap/freelens-plugins/freelens-oci-cluster (開発用)

## License

MIT
