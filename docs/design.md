---
last_verified: 2026-07-15
---

# freelens-oci-cluster 設計判断の記録

コードから読み取れない判断とドメイン知識を記録する。
使い方・前提条件は [README](../README.md) を参照。
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

実テナンシで検証済みの前提を残す。

- OKE/CCM が作成した NLB・Volume にはクラスタ OCID の CreatedBy タグが付く
- Instance の CreatedBy はノードプール OCID（クラスタ OCID ではない）。
  アンカー解決（providerID → instance → nodepool → cluster）はこの2段構造が前提
- FSS（FileSystem / MountTarget）は人手作成でタグに乗らない。経路3でのみ拾える
- classic LB も実在するため経路2は NLB / classic LB の両対応が必要

## 主要な設計判断

| 項目 | 決定 | 理由 |
|------|------|------|
| OCI データ取得 | oci CLI 子プロセス（renderer から execFile 直） | renderer の sandbox 制限なしは事前の PoC 検証で実証済み。TypeScript SDK は認証設定（`~/.oci` の鍵パス）が WSL/Windows で食い違うため不採用 |
| クラスタ紐付け | Node providerID 起点の自動解決 | ユーザ設定ゼロ。providerID 単独依存の単一障害点であり、形式が想定外なら「対象外」ガイダンスに落とす |
| compartment スコーピング | アンカー compartment とタグ検索結果の compartment の和集合ごとに list 実行 | クラスタとリソースの compartment が異なる構成を吸収する。タグ検索完了を待つ2段階取得になるが、並列性より取りこぼし防止を優先した |
| 取得単位 | ページ単位の遅延取得（クラスタ × セクションのメモリキャッシュ + 手動更新） | ノードだけ見たいときに LB / Volume 分の CLI（約1秒/call）を待たせない。実機検証後の要望で一括取得から変更した |
| LB の IP 照合 | ingress IP と LB の全 IP 集合（public/private）の完全一致。多対一は行複製で表示 | LB は複数 IP・public/private 混在がありうるため比較対象を固定する。同一 LB を複数 Service が使う構成は OKE で正当 |
| タイムアウト | 60秒 / call | docker ラッパー経由の突発遅延（image pull 等）を許容する実測ベースの値 |
| エラー分類 | 非 OKE（CLI 前判定）/ CLI 不在 / 認証切れ / その他の4分類 + 生エラー併記 | OCI に不慣れな利用者へ対処方法を提示しつつデバッグ可能性を保つ |

## 既知の制約

- `Oracle-Tags.CreatedBy` は Oracle 側の自動タグ機構であり、仕様変更で経路4が空振りする可能性がある。
  K8s 起点の3経路が正であるため一覧自体は欠落しない。
- OCI に汎用の依存関係 API は存在しない。
  ネットワークトポロジ API（`oci network vcn-topology get` 等）は現行 IAM ポリシーでは 404 を確認済みで使用しない。
- コンソールのディープリンクは全種別（cluster / instance / NLB / classic LB / volume / FSS）とも実機で遷移確認済み（実装は `src/renderer/match/console-url.ts`）

## 将来的実装（スコープ外として合意済み）

- 依存関係のグラフ描画（現状は対応テーブルで表現）
- テナンシ全体ビュー・メトリクス・コスト表示（別プラグインの領分）
- OCI リソースの操作（本プラグインは閲覧専用を維持する）
