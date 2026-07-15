# freelens-oci-cluster

開いているクラスタの基盤 OCI リソース(Node↔Instance / Service↔LB / PV↔ストレージ)を FreeLens 内で確認できるようにする、
クラスタサイドバー拡張プラグイン。設計判断・ドメイン知識は [設計判断の記録](docs/design.md) を参照。

## 前提条件

- `oci` CLI がインストール済みで、対象テナンシに対して認証済みであること(`oci session authenticate` 等)
- 閲覧専用。本プラグインは OCI リソースの変更系コマンドを一切呼ばない

## 設定

FreeLens の Preferences 内「OCI」に「OCI コマンド」の入力欄がある。

- 空欄の場合は既定のコマンド `oci` を使う(プレースホルダに表示される値)
- `--profile FOO` のような追加引数を含めた文字列(例: `oci --profile FOO`)も指定できる。スペース区切りでそのまま
  コマンド引数に分解される
- 変更は次回のデータ取得(［更新］ボタン、またはクラスタの再選択)から反映される

## 動作確認手順

1. `make freelens-oci-cluster/deploy FREELENS_EXT_DIR=<path>` でビルド+配置する
2. FreeLens でクラスタを選択して接続する
3. クラスタサイドバーの「OCI」メニューをクリックする
4. OKE クラスタではヘッダにクラスタ情報が表示され、「OCI」配下の子メニュー(ノード / Service↔LB / PV↔ストレージ)で
   対象リソースのページを切り替えられる。非 OKE クラスタでは対象外である旨のガイダンスが表示される

## 既知の制約

oci CLI の JSON フィールド変更や `Oracle-Tags.CreatedBy` タグ機構への依存など、設計上の既知の制約がある。
一覧は [設計判断の記録の「既知の制約」](docs/design.md#既知の制約) を参照。
