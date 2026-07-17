---
last_verified: 2026-07-17
---

# freelens-oci-cluster 設計判断の記録

コードから読み取れない判断とドメイン知識を記録する。
使い方・前提条件・認証情報コマンドの JSON 契約は [README](../README.md) を参照。
Extension API の一般的な罠は [FreeLens 拡張 API の情報源](extension-api.md) を参照。

## 関連リソースの定義

「クラスタに関連する OCI リソース」は次の4経路の和集合とする。
K8s 起点を正とし、タグ起点は K8s に対応が残っていないリソース（残骸）の検出補助とする。

| # | 起点 | 経路 | 対象 |
|---|------|------|------|
| 1 | K8s | Node `spec.providerID` = Instance OCID | ノード実体 |
| 2 | K8s | Service (type=LoadBalancer) の ingress IP と LB の IP 照合 | NLB / classic LB |
| 3 | K8s | PV `spec.csi.volumeHandle` の OCID（CSI driver で分岐） | Block Volume / FSS |
| 4 | OCI | `Oracle-Tags.CreatedBy = <cluster OCID>` タグ検索 | OKE/CCM が作成したリソース全般 |

ネットワークページの「クラスタ関連 LB」判定はこれに加えて第3の基準を持つ
（実装は [network-path.ts](../src/renderer/match/network-path.ts) の `clusterLbIds`）。

- バックエンド IP がノードまたは判定済みクラスタ関連 LB の IP を指す LB を連鎖で拾う（固定点まで展開）。
  手動作成の WAF 用 classic LB → ingress NLB → ノードという2段 LB 構成が実在するため
  （タグも Service IP も持たない LB がクラスタの前段に立つ）

実テナンシで検証済みの前提を残す。

- OKE/CCM が作成した NLB・Volume にはクラスタ OCID の CreatedBy タグが付く
- Instance の CreatedBy はノードプール OCID（クラスタ OCID ではない）。
  アンカー解決（providerID → instance → nodepool → cluster）はこの2段構造が前提。
  ノードタブのプール名解決も同じタグを使う（virtual node / self-managed node は形式が異なり「-」表示に落とす）
- FSS（FileSystem / MountTarget）は人手作成でタグに乗らない。経路3でのみ拾える
- classic LB も実在するため経路2は NLB / classic LB の両対応が必要

## 主要な設計判断

| 項目 | 決定 | 理由 |
|------|------|------|
| OCI データ取得 | OCI TypeScript SDK 直呼び出し（renderer プロセス内で HTTPS+リクエスト署名） | 初版は oci CLI 子プロセスだったが、CLI の Python 起動 ≈1秒/call が調査体験を損なうため SDK へ全面移行した（SDK は ≈0.3秒/call・全並列可） |
| HTTP クライアント | `node:https` ベースの自前実装（[node-http-client.ts](../src/renderer/sdk/node-http-client.ts)） | SDK 既定の FetchHttpClient はブラウザ fetch を使い、renderer(Chromium) では OCI API への直接呼び出しが CORS で失敗する（実機で遭遇）。Node のネットワークスタックは CORS の対象外 |
| クラスタ紐付け | Node providerID 起点の自動解決 | ユーザ設定ゼロ。providerID 単独依存の単一障害点であり、形式が想定外なら「対象外」ガイダンスに落とす |
| compartment スコーピング | アンカー compartment とタグ検索結果の compartment の和集合ごとに list 実行 | クラスタとリソースの compartment が異なる構成を吸収する。タグ検索完了を待つ2段階取得になるが、並列性より取りこぼし防止を優先した |
| 取得単位 | ページ単位の遅延取得（クラスタ × セクションのメモリキャッシュ + 手動更新）。ネットワークページの subnet/SL/RT/NSG/WAF ポリシー等は per-OCID の Map セクション | ノードだけ見たいときに他ページ分の取得を待たせない。per-OCID Map は個別リロード（そのブロックだけ再取得）の単位になる |
| ネットワークページの取得順 | 依存順3ウェーブ（①node-pool/WAF/LB ②subnet get ③SL/RT/NSG rules/ゲートウェイ/ポリシー類）を各ウェーブ内全並列 | subnet 応答から SL/RT の OCID が判明する依存関係。個別 get（OCID 直指定）は compartment 前提を持たず、list 方式の取りこぼしがない |
| backend health | 行の展開時オンデマンド取得のみ | 揮発データ。取得を見た分だけに抑制する |
| 自動更新 | 全ページ共通トグル（永続化）+ 間隔設定（既定60秒・下限30秒）。再取得は旧データ表示のまま裏で差し替える（force 方式）。認証系エラー検出で自動停止しトグルを OFF へ倒す | セクションを idle 化すると更新間隔ごとにページ全体がスピナーへ戻る。自動停止は30〜60秒ごとの認証コマンド連打・エラー連打を防ぐ |
| LB の IP 照合 | ingress IP と LB の全 IP 集合（public/private）の完全一致。多対一は行複製で表示 | LB は複数 IP・public/private 混在がありうるため比較対象を固定する。同一 LB を複数 Service が使う構成は OKE で正当 |
| DNS 突合 | `node:dns` の `lookup`（OS リゾルバ）で解決し、クラスタ関連 LB の IP と照合 | `resolve4`（DNS サーバ直接クエリ）は Windows の VPN/リゾルバ構成で ECONNREFUSED になる（実機で遭遇）。lookup はアプリが接続時に使う経路そのもので突合の意味にも合う |
| LB 証明書期限 | LB 埋め込み PEM（`X509Certificate` でパース）と Certificates サービス（`certificate-ids` → 管理 API get）の2方式に対応 | listener の SSL 構成にどちらの方式も実在する（実テナンシは certificate-ids 方式） |
| WAF | classic LB のみ突合（`loadBalancerId`）。行展開で WAF ポリシーの全ルール（アクセス制御条件・レート制限・保護 capability）と既定アクションを表示 | NLB は WAF 非対応。ブロック理由の実体はポリシー側にあり、名前だけでは調査が完結しない |
| ゲートウェイ生死 | RT ルート宛先（NAT/IGW/SGW/LPG/DRG）を OCID 種別で get し分け、無効化・遮断・未接続を表示 | 経路表が正しくてもゲートウェイが無効なら通らない。宛先種別の表示だけでは盲点になる |
| タイムアウト | 60秒 / call | CLI 時代の突発遅延許容と同水準を SDK でも維持する |
| エラー分類 | 非 OKE（事前判定）/ 認証情報なし / 認証情報コマンド不良 / 認証切れ / その他の分類 + 生エラー併記 | OCI に不慣れな利用者へ対処方法を提示しつつデバッグ可能性を保つ |

## 認証とシークレット管理

認証解決は2経路（実装は [auth.ts](../src/renderer/sdk/auth.ts)）。

- Preferences「認証情報コマンド」が設定されていればそれを実行し、stdout の JSON（契約は README）から構築する。
  鍵をファイルに置かない環境（シークレットマネージャ運用）向け
- 未設定なら `~/.oci/config`（`OCI_CONFIG_FILE` 上書き可）。
  `security_token_file` を持つプロファイルは SessionAuthDetailProvider で読む

シークレットの扱いの不変条件。

- ディスク・mobx store・Preferences に鍵・トークン・認証 JSON を書かない（保存するのはコマンド文字列のみ）
- 認証情報コマンドの stdout は鍵そのもののため、エラー表示・ログに一切出さない
  （生エラー併記の UX からこの経路だけ除外。形式不正時は欠落フィールド名のみ表示する）
- 鍵の寿命はクラスタ単位のデータキャッシュと同一（モジュール変数 = クラスタフレームの生存期間）
- 401 検出時は認証を1回だけ再解決する。セッショントークンは `refreshSessionToken()` を先に試す
  （SDK は 401 時の自動リフレッシュを持たない）

## 既知の制約

- `Oracle-Tags.CreatedBy` は Oracle 側の自動タグ機構であり、仕様変更で経路4が空振りする可能性がある。
  K8s 起点の3経路が正であるため一覧自体は欠落しない。
- OCI に汎用の依存関係 API は存在しない。
  ネットワークトポロジ API（`oci network vcn-topology get` 等）は現行 IAM ポリシーでは 404 を確認済みで使用しない。
- WAF がクラスタ LB と別 compartment にある構成では compartment 集合の探索から漏れる可能性がある。
- DNS 突合はこの端末のリゾルバによる観測のため、スプリット DNS 環境では外部からの解決結果と異なることがある。
- コンソールのディープリンク（実装は [console-url.ts](../src/renderer/match/console-url.ts)）は
  cluster / instance / NLB / classic LB / volume / FSS / subnet / SL / RT / WAF / FSS スナップショットポリシーを実機で遷移確認済み。
  NSG・WAF ポリシー単体・Volume バックアップポリシーの3種は同構造からの類推で未確認。

## 将来的実装（スコープ外として合意済み）

- 疎通可否の自動判定（SL/NSG ルールの解釈エンジン。現状は人が判断するための材料を並べる）
- 依存関係のグラフ描画（現状は経路軸のセクション+対応テーブルで表現）
- テナンシ全体ビュー・メトリクス・コスト表示（別プラグインの領分）
- OCI リソースの操作（本プラグインは閲覧専用を維持する）
