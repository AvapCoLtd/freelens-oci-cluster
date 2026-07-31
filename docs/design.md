---
last_verified: 2026-07-31
---

# freelens-oci-cluster 設計判断の記録

コードから読み取れない判断とドメイン知識を記録する。

使い方・前提条件・oci コマンドの設定と互換コマンド契約は [README](../README.md) を参照。Extension API の一般的な罠は [FreeLens 拡張 API の情報源](extension-api.md) を参照。

## 関連リソースの定義

「クラスタに関連する OCI リソース」は次の4経路の和集合とする。
K8s 起点を正とし、タグ起点は K8s に対応が残っていないリソース（残骸）の検出補助とする。

| # | 起点 | 経路 | 対象 |
|---|------|------|------|
| 1 | K8s | Node `spec.providerID` = Instance OCID | ノード実体 |
| 2 | K8s | Service (type=LoadBalancer) の ingress IP と LB の IP 照合 | NLB / classic LB |
| 3 | K8s | PV `spec.csi.volumeHandle` の OCID（CSI driver で分岐） | Block Volume / FSS |
| 4 | OCI | `Oracle-Tags.CreatedBy = <cluster OCID>` タグ検索 | OKE/CCM が作成したリソース全般 |

ネットワークページの「クラスタ関連 LB」判定はこれに加えて第3の基準を持つ（実装は [network-path.ts](../src/renderer/match/network-path.ts) の `clusterLbIds`）。

- バックエンド IP がノードまたは判定済みクラスタ関連 LB の IP を指す LB を連鎖で拾う（固定点まで展開）。手動作成の WAF 用 classic LB → ingress NLB → ノードという2段 LB 構成が実在するため（タグも Service IP も持たない LB がクラスタの前段に立つ）

実テナンシで検証済みの前提を残す。

- OKE/CCM が作成した NLB・Volume にはクラスタ OCID の CreatedBy タグが付く
- Instance の CreatedBy はノードプール OCID（クラスタ OCID ではない）。アンカー解決（providerID → instance → nodepool → cluster）はこの2段構造が前提。ノードタブのプール名解決も同じタグを使う（virtual node / self-managed node は形式が異なり「-」表示に落とす）
- FSS（FileSystem / MountTarget）は人手作成でタグに乗らない。経路3でのみ拾える
- classic LB も実在するため経路2は NLB / classic LB の両対応が必要

## 主要な設計判断

| 項目 | 決定 | 理由 |
|------|------|------|
| OCI データ取得 | 利用者が指定する oci 互換コマンドの都度実行（実装は [cli/](../src/renderer/cli/)。コマンド定義表 + `execFile` 実行機） | 利用者に秘密の露出も専用部品の自作も要求しない。config を持たない運用（シークレットマネージャ）でも「動く oci コマンド」だけで足り、高速化は拡張外（互換コマンド側）に開放できる |
| （経緯）SDK 直呼び出し | 0.1〜0.2 系は OCI TypeScript SDK を renderer 内で直呼びしていた（CLI の Python 起動 ≈1秒/call を避けるため。SDK は ≈0.3秒/call） | 鍵をアプリへ渡す経路が必要になり config レス運用を締め出すため、速度を捨てて CLI 委譲へ戻した |
| レスポンス型 | 実機採取フィクスチャ由来の自前 kebab-case 型定義（SDK 非依存）。CLI の JSON 出力を変換せずそのまま扱い、拡張が読むフィールドだけを [oci/types.ts](../src/renderer/oci/types.ts) に宣言する | 変換層と SDK バージョン乖離を排除するため。型の正は実出力（[cli/\_\_fixtures\_\_/stdout/](../src/renderer/cli/__fixtures__/stdout/)）であり、SDK モデルに寄せると「SDK では camelCase・CLI では kebab-case」の写像規則を自前で維持することになる |
| クラスタ紐付け | Node providerID 起点の自動解決 | ユーザ設定ゼロ。providerID 単独依存の単一障害点であり、形式が想定外なら「対象外」ガイダンスに落とす |
| compartment スコーピング | アンカー compartment とタグ検索結果の compartment の和集合ごとに list 実行 | クラスタとリソースの compartment が異なる構成を吸収する。タグ検索完了を待つ2段階取得になるが、並列性より取りこぼし防止を優先した |
| 取得単位 | ページ単位の遅延取得（クラスタ × セクションのメモリキャッシュ + 手動更新）。ネットワークページの subnet/SL/RT/NSG/WAF ポリシー等は per-OCID の Map セクション | ノードだけ見たいときに他ページ分の取得を待たせない。per-OCID Map は個別リロード（そのブロックだけ再取得）の単位になる |
| ネットワークページの取得順 | 依存順3ウェーブ（①node-pool/WAF/LB ②subnet get ③SL/RT/NSG rules/ゲートウェイ/ポリシー類）を各ウェーブ内全並列 | subnet 応答から SL/RT の OCID が判明する依存関係。個別 get（OCID 直指定）は compartment 前提を持たず、list 方式の取りこぼしがない |
| backend health | 行の展開時オンデマンド取得のみ | 揮発データ。取得を見た分だけに抑制する |
| 自動更新 | 全ページ共通トグル（永続化）+ 間隔設定（既定60秒・下限30秒）。再取得は旧データ表示のまま裏で差し替える（force 方式）。周期リトライで自然回復しないエラー（認証系・コマンド起動失敗・互換コマンド非互換・内部エラー）の検出で自動停止しトグルを OFF へ倒す | セクションを idle 化すると更新間隔ごとにページ全体がスピナーへ戻る。自動停止は30〜60秒ごとの oci 実行とエラー連打を防ぐ |
| LB の IP 照合 | ingress IP と LB の全 IP 集合（public/private）の完全一致。多対一は行複製で表示 | LB は複数 IP・public/private 混在がありうるため比較対象を固定する。同一 LB を複数 Service が使う構成は OKE で正当 |
| DNS 突合 | `node:dns` の `lookup`（OS リゾルバ）で解決し、クラスタ関連 LB の IP と照合 | `resolve4`（DNS サーバ直接クエリ）は Windows の VPN/リゾルバ構成で ECONNREFUSED になる（実機で遭遇）。lookup はアプリが接続時に使う経路そのもので突合の意味にも合う |
| LB 証明書期限 | LB 埋め込み PEM（`X509Certificate` でパース）と Certificates サービス（`certificate-ids` → 管理 API get）の2方式に対応 | listener の SSL 構成にどちらの方式も実在する（実テナンシは certificate-ids 方式） |
| WAF | classic LB のみ突合（`load-balancer-id`）。行展開で WAF ポリシーの全ルール（アクセス制御条件・レート制限・保護 capability）と既定アクションを表示 | NLB は WAF 非対応。ブロック理由の実体はポリシー側にあり、名前だけでは調査が完結しない |
| ゲートウェイ生死 | RT ルート宛先（NAT/IGW/SGW/LPG/DRG）を OCID 種別で get し分け、無効化・遮断・未接続を表示 | 経路表が正しくてもゲートウェイが無効なら通らない。宛先種別の表示だけでは盲点になる |
| 実行機の上限 | 60秒 / call、同時8プロセス、stdout 64MiB / call（2026-07-31 実測で確定） | oci の突発遅延（初回起動・大規模 list）は許容しつつ、ハングと巨大出力をセクション単位のエラーへ落とす。同時実行上限はプロセス起動スパイクの抑制 |
| エラー分類 | 非 OKE（事前判定）/ コマンド起動失敗 / 認証系 / 権限・不在 / 互換コマンド非互換 / その他 + 生の exit code・stderr 併記。分類不能は「その他」（ポーリング継続側） | OCI に不慣れな利用者へ対処方法を提示しつつデバッグ可能性を保つ。設定ミス（起動失敗・互換コマンド非互換）をプラグインのバグ表示に混ぜない |

## 認証とシークレット管理

認証は oci コマンドの内部で完結し、プラグインは関与しない。

- 認証方式（config の API キー / セッショントークン / インスタンスプリンシパル / ラッパによる注入）の選択は利用者の環境側にある。プラグインからは区別できず、する必要もない
- Preferences に保存するのは実行するコマンド文字列だけ（空欄 = PATH の `oci`）。鍵・トークン・認証 JSON を読む経路をプラグインは持たない

シークレットの扱いの不変条件。

- ディスク・mobx store・Preferences に鍵・トークン・認証 JSON を書かない（保存するのはコマンド文字列のみ）
- oci の stdout / stderr は秘密を含まない契約であり、エラー表示には exit code・stderr を生のまま出す（秘匿より調査性を優先する）
- 認証系エラー（`NotAuthenticated` / 401、config・プロファイル不備）とコマンド起動失敗・互換コマンド非互換・内部エラーは表示のうえポーリングを自動停止する。周期リトライで自然回復しないため。再認証は端末側の操作であり、プラグインは再認証も再試行もしない
- 旧「認証情報コマンド」の設定値（`authCommand`）と CLI 時代の `ociCommand` は読み捨てる。ファイルからは消さないが、oci コマンドとして実行してはならない（旧値は認証情報 JSON を返すコマンド）

## 既知の制約

- `Oracle-Tags.CreatedBy` は Oracle 側の自動タグ機構であり、仕様変更で経路4が空振りする可能性がある。K8s 起点の3経路が正であるため一覧自体は欠落しない。
- OCI に汎用の依存関係 API は存在しない。ネットワークトポロジ API（`oci network vcn-topology get` 等）は現行 IAM ポリシーでは 404 を確認済みで使用しない。
- WAF がクラスタ LB と別 compartment にある構成では compartment 集合の探索から漏れる可能性がある。
- DNS 突合はこの端末のリゾルバによる観測のため、スプリット DNS 環境では外部からの解決結果と異なることがある。
- コンソールのディープリンク（実装は [console-url.ts](../src/renderer/match/console-url.ts)）は cluster / instance / NLB / classic LB / volume / FSS / subnet / SL / RT / WAF / FSS スナップショットポリシーを実機で遷移確認済み。NSG・WAF ポリシー単体・Volume バックアップポリシーの3種は同構造からの類推で未確認。

## 将来的実装（スコープ外として合意済み）

- 疎通可否の自動判定（SL/NSG ルールの解釈エンジン。現状は人が判断するための材料を並べる）
- 依存関係のグラフ描画（現状は経路軸のセクション+対応テーブルで表現）
- テナンシ全体ビュー・メトリクス・コスト表示（別プラグインの領分）
- OCI リソースの操作（本プラグインは閲覧専用を維持する）
