---
last_verified: 2026-08-20
---

# freelens-oci-cluster 設計判断の記録

> 実装理由、OCI リソースの対応関係、既知の制約を確認するときに参照する。

コードから読み取れない判断とドメイン知識を記録する。

使い方と前提条件は [README](../README.md)、oci コマンドの詳細は [OCI コマンド連携](oci-command.md)を参照。
Extension API の一般的な罠は [FreeLens 拡張 API の情報源](extension-api.md)を参照。

## 関連リソースの定義

「クラスタに関連する OCI リソース」は次の4経路の和集合とする。
K8s 起点を正とし、タグ起点は K8s に対応が残っていないリソース（残骸）の検出補助とする。

| # | 起点 | 経路 | 対象 |
|---|------|------|------|
| 1 | K8s | Node `spec.providerID` = Instance OCID | ノード実体 |
| 2 | K8s | Service (type=LoadBalancer) の ingress IP と LB の IP 照合 | NLB / classic LB |
| 3 | K8s | PV `spec.csi.volumeHandle` の OCID（CSI driver で分岐。FSS は先頭要素が FileSystem OCID / Export OCID のどちらもあり、後者は `fs export get` の `file-system-id` で FileSystem OCID へ解決する） | Block Volume / FSS |
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
| ネットワークページの取得順 | cluster 応答の `vcn-id` とタグ検索の compartment 集合が揃った時点で、型別 list（subnet/RT/SL/NSG/NAT/IGW/SGW/LPG/DRG）を1段で並列発火し、結果を Map へ一括で ready 化する。per-OCID get は list に現れなかった OCID のフォールバックのみ。NSG ルールは一括ルートが無く NSG ごとの `nsg rules list` を次段で並列に撃つ | 律速は直列段数 × API 往復であり、per-OCID get の数珠つなぎ（subnet → SL/RT → ゲートウェイ）がリソース数に比例して段を伸ばしていた。VCN 配下の list は get と同一のフルモデルを返す（Summary 型が無い）ため表示項目を落とさない。VCN が compartment 集合の外にある構成では list が空になるためフォールバックを残す |
| pv-storage の取得順 | FSS スナップショットポリシーと Volume バックアップポリシーは compartment（× AD）単位の list を PV 読み込みと並走させ、名前解決は索引引きで済ませる。FileSystem 本体は per-OCID get のまま。volumeHandle が Export OCID の PV は先に per-OCID の `fs export get` を挟んで FileSystem OCID を得る（この解決の失敗はその PV の FileSystem 解決失敗として `fileSystems` セクションに乗る） | `fs file-system list` の FileSystemSummary は `filesystem-snapshot-policy-id` を持たず、バックアップ列の表示に足りない。バックアップポリシー割当（`--asset-id` 必須）にも一括ルートが無い |
| 表示の露出単位 | UI 階層で2段階。①一覧（テーブル行・ステータス）はセクション単位で確定次第それぞれ出す。ただし1つのテーブルは行集合と各行のセル材料が揃うまで出さない（判定は [section-ready.ts](../src/renderer/match/section-ready.ts)）②アコーディオンの中身（SL/RT ルール・NSG ルール・WAF ポリシー・証明書・DNS 解決）は per-OCID の結果が来るまでその場にスピナーを出す。どちらも「成功または失敗」で確定とみなす | 取得段の単位でまとめて出すと、先に返ったテーブルまで待たされて体感が遅くなる。一方でテーブル内で行やセルが後から増えると画面がガタつくのでテーブル単位では原子的に出す。失敗を待ち条件から外すのは、1セクションの権限不足で他が永久に出ないのを防ぐため |
| （例外）DNS セクション | `section-ready.ts` のゲートを通さず、行集合を K8s（Ingress / Service）から直接組む。各行の解決結果だけが per-OCID のスピナー扱い | 行の材料が OCI ではなく K8s 側にあり、`dnsChecks` の登録を待つと「該当ホスト名なし」を誤って先に出してしまう |
| 取得中の表示 | スピナー（[spinner.tsx](../src/renderer/components/spinner.tsx)）に統一しテキストラベルは使わない。`Renderer.Component` は Spinner を export しない（FreeLens 1.10.3 の renderer-api/components で確認）ため、本体の `spinner.scss` と同じ幾何の CSS を注入する（注入機構は [injected-style.ts](../src/renderer/components/injected-style.ts) 共通）。唯一の例外が Topology の初回ローディングで、確定セクション数 n/m と待機中セクション名をテキストで出す | 本体 UI（cluster overview 等）と見た目を揃える。「Loading...」の文字は幅を持つため、実データに置き換わるときに列幅と行の高さが動く。Topology は表セルではなく図全体の代替表示であり、列幅が動く問題が起きない。図は全セクション確定まで何も出せない分、無言のスピナーでは待ち時間の見当がつかない |
| backend health | 行の展開時オンデマンド取得のみ。Topology 図のノード・エッジにも反映しない。ただし検索語が入力されている間は、表示中の全 LB 行分を先行取得する | 揮発データ。取得を見た分だけに抑制する。図に載せると描画のたびに全 LB 分を取ることになり、この抑制が崩れる。検索中だけ抑制を緩めるのは、検索結果がそれまでの展開履歴に依存しないようにするため（未展開行の backend health もヒットさせる） |
| 自動更新 | 全ページ共通トグル（永続化）+ 間隔設定（既定60秒・下限30秒）。再取得は旧データ表示のまま裏で差し替える（force 方式）。周期リトライで自然回復しないエラー（認証系・コマンド起動失敗・互換コマンド非互換・内部エラー）の検出で自動停止しトグルを OFF へ倒す | セクションを idle 化すると更新間隔ごとにページ全体がスピナーへ戻る。自動停止は30〜60秒ごとの oci 実行とエラー連打を防ぐ |
| LB の IP 照合 | ingress IP と LB の全 IP 集合（public/private）の完全一致。多対一は行複製で表示 | LB は複数 IP・public/private 混在がありうるため比較対象を固定する。同一 LB を複数 Service が使う構成は OKE で正当 |
| DNS 突合 | `node:dns` の `lookup`（OS リゾルバ）で解決し、クラスタ関連 LB の IP と照合 | `resolve4`（DNS サーバ直接クエリ）は Windows の VPN/リゾルバ構成で ECONNREFUSED になる（実機で遭遇）。lookup はアプリが接続時に使う経路そのもので突合の意味にも合う |
| LB 証明書期限 | LB 埋め込み PEM（`X509Certificate` でパース）と Certificates サービス（`certificate-ids` → 管理 API get）の2方式に対応 | listener の SSL 構成にどちらの方式も実在する（実テナンシは certificate-ids 方式） |
| WAF | classic LB のみ突合（`load-balancer-id`）。行展開で WAF ポリシーの全ルール（アクセス制御条件・レート制限・保護 capability）と既定アクションを表示 | NLB は WAF 非対応。ブロック理由の実体はポリシー側にあり、名前だけでは調査が完結しない |
| ゲートウェイ生死 | RT ルート宛先（NAT/IGW/SGW/LPG/DRG）を OCID 種別で get し分け、無効化・遮断・未接続を表示 | 経路表が正しくてもゲートウェイが無効なら通らない。宛先種別の表示だけでは盲点になる |
| 実行機の上限 | 60秒 / call、同時8プロセス、stdout 64MiB / call（2026-07-31 実測で確定） | oci の突発遅延（初回起動・大規模 list）は許容しつつ、ハングと巨大出力をセクション単位のエラーへ落とす。同時実行上限はプロセス起動スパイクの抑制 |
| エラー分類 | 非 OKE（事前判定）/ コマンド起動失敗 / 認証系 / 権限・不在 / 互換コマンド非互換 / その他 + 生の exit code・stderr 併記。分類不能は「その他」（ポーリング継続側） | OCI に不慣れな利用者へ対処方法を提示しつつデバッグ可能性を保つ。設定ミス（起動失敗・互換コマンド非互換）をプラグインのバグ表示に混ぜない |
| 検索・絞り込み | 表示専用のクライアントサイド絞り込み（`filter-rows.ts`。空白区切りトークンの AND・部分一致）。取得済みデータの再取得は起きない（唯一の例外が backend health の先行取得で、検索語がある間だけ表示中の全 LB 行分を新規取得する）。テーブル系ページは非マッチ行を除外、Topology は非マッチのノード・エッジを減光（除外はしない）。展開領域（ルール・backend health 等）の値にしかマッチしない行は自動展開する（判定は `matchedOnlyInDetail`） | 図は要素数の変化で配置が動くため除外ではなく減光にした（[レイアウト](#topology-図の設計判断)の決定論と両立させる）。展開領域の値で検索を通したのに中身が閉じたままだと、何にマッチしたのか利用者が確認できない |

## Topology 図の設計判断

Topology ページはクラスタ関連リソースの位置と繋がりを一枚の図で見せる。
描く対象の範囲は [関連リソースの定義](#関連リソースの定義) と同じ4経路 + LB 連鎖に従う。

| 項目 | 決定 | 理由 |
|------|------|------|
| 図の種類 | 階層コンテナ図（VCN ⊃ Subnet ⊃ 実体の入れ子ボックス + 参照エッジ） | 扱うのは実リソースのインスタンスであり、包含構造が支配的。種別レベルの ER 図では「どのノードがどの Subnet にいるか」という運用の問いに答えられない |
| 表示 Subnet の絞り込み | クラスタ関連の子を持つ Subnet と endpoint サブネットだけ描き、残りは「N subnets not shown」1個に畳む（詳細パネルに畳んだ Subnet の name/CIDR/OCID 一覧を出す）。ゲートウェイも表示 Subnet の RT から参照される分だけ描く | 共有 VCN（実機では約30サブネット中クラスタ関連は数個）で全表示すると、主役が無関係な箱と route エッジの束に埋没する。件数サマリを残すのは存在まで隠さないため。CIDR 照合と LB 配置の候補集合には取得した全 Subnet を使い、絞り込みで配置根拠は変えない |
| 集約縮退 | Subnet 内の Instance が10超なら「n nodes」集約ノードへ畳む（クリックで展開） | 大規模クラスタで Subnet ボックスが巨大化し俯瞰性を失う。閾値10は1ボックスに並べて読める上限として置いた可読性由来の値で、データ側の境界ではない |
| SL / RT / NSG | ノード化せず、Subnet / LB の詳細パネル内の ID 列挙に留める | 多対多参照でエッジが爆発し俯瞰性を壊す。ルールの中身はネットワークページの役割であり、図は位置と繋がりに絞る |
| DRG の配置 | compartment 属だが VCN ボックスの中に描く | 図での意味は VCN への接続点であって所属 compartment ではない。親を解決できないゲートウェイも VCN へ取り込み、図の外に浮かせない |
| レイアウト | 自前の決定論レイアウト（同一データなら同一配置）。左レーンはトラフィックの上→下一方向流、VCN 内も Subnet を「LB/NLB 持ち → Instance 持ち → その他」の段に分けて縦に積み同じ流れを保つ、右レーンは PV → ストレージ → ポリシーの独立成分を1成分1行で積む。`@xyflow/react` は描画・操作だけに使う | 一方向流は Sugiyama 法の定石、非連結成分をレーンで分けるのは ELK の disconnected component packing に対応する。ストレージが多いクラスタでも右レーンが縦に伸びるだけで主役の可読性を保てる（実機2クラスタで確認した問題への対処）。配置が更新のたびに揺れると「図が変わった = 構成が変わった」の読みが崩れるため決定論にする |
| エッジ経路 | 自前の直交ルーティング（格子 + 通路を前提とした channel routing） | ノード矩形との交差ゼロと同一線分の完全重複ゼロをユニットテストで保証する。ボックスを貫通する線は所属の誤読を生み、重なった線は本数を数えられなくする |
| 更新の原子性 | 図の再導出は更新世代 + 確定スナップショットで一括コミットする。導出層は store を直接監視しない。原子性の契約は OCI スナップショットに対するもので、K8s 側入力（Node / Service / PV）はライブ反映を許容する | force 更新はセクション個別の差し替えで進む（stale-while-revalidate）ため、store を直接見ると新旧混在の図が生成される。K8s 側は FreeLens 本体が watch で持つ最新値であり、待たせる意味も待つ単位も無い |
| 描画技術 | `@xyflow/react` v12（MIT、peerDeps は `react >=17`） | パン / ズームとエッジ描画が組み込みで、ノードを React コンポーネントとして書ける。host の React 17 を共有する制約下でバンドルが重複しないことをスパイクで検証済み |
| React Flow の CSS | `dist/style.css` を `?inline` で import し `ensureInjectedStyle()` で注入する | JS 内の文字列から style を注入する既存流儀に一致し、Vite 設定を触らずに済む |
| 孤立 PV | 参照先の Volume / FSS の実体を確認できなかった PV はノードの警告表示（詳細パネルに理由）とし、欠落バナーには載せない。判別は照会が失敗したときだけ走らせる存在確認の追撃で行う。文言は不在と断定せず権限不足も読めるものにし、FSS は export の不在と FileSystem の不在を書き分ける | 残骸検出はこのプラグインの思想であり、残骸を生のエラーとして見せるのは表示設計の欠落（実機の孤立 PV で確認）。「404 = 割当なし」に倒す案は本物の権限エラーを握りつぶすため不採用。追撃を失敗時だけに限るのは正常系の API を増やさないため。OCI は不在と権限不足に同じ応答を返し、FSS は export だけ消えて FileSystem が残る運用も成立するため、断定した文言は誤読を生む |
| コンソールリンクの範囲 | OCI リソースは全種別に出す（ゲートウェイ・VCN 含む）。PV ノードは参照先ストレージのページへ飛ばす。集約ノード・K8s Service・件数サマリには出さない | 「OCI リソースなのに飛べない」違和感が実機確認で出たため、リンクを持つ種別を絞らない。集約・K8s・サマリは OCI コンソールに対応するページ自体が無い |
| MOCK の K8s 入力 | ページの K8s 参照（Node / Service / PV）を adapter に寄せ、`MOCK=1` では OCI と同じ Vite alias で差し替える | 配置根拠（Node の InternalIP ↔ Subnet の CIDR）と K8s 起点のエッジは K8s 側の入力に依存する。OCI だけ差し替えても実クラスタ依存が残り、受入確認とスクリーンショット撮影が成立しない |

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
- OCI は権限不足と不在に同じ応答（`NotAuthorizedOrNotFound`）を返す。Volume / FSS への読み取り権限が皆無な環境では孤立 PV と権限不足を区別できず、孤立 PV 側に倒れる（表示はどちらとも読める文言に留める）。
- コンソールのディープリンク（実装は [console-url.ts](../src/renderer/match/console-url.ts)）は cluster / instance / NLB / classic LB / volume / FSS / subnet / SL / RT / WAF / FSS スナップショットポリシーを実機で遷移確認済み。NSG・WAF ポリシー単体・Volume バックアップポリシー・VCN 本体・ゲートウェイ5種（IGW / NAT / SGW / LPG / DRG）は同構造からの類推で未確認。

## 将来的実装（スコープ外として合意済み）

- 疎通可否の自動判定（SL/NSG ルールの解釈エンジン。現状は人が判断するための材料を並べる）
- Topology 図のエクスポート（画像 / SVG 保存）
- Topology 図のノード位置の手動編集・保存（レイアウトは常に自動）
- テナンシ全体ビュー・メトリクス・コスト表示（別プラグインの領分）
- OCI リソースの操作（本プラグインは閲覧専用を維持する）
