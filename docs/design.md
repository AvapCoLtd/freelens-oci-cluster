---
last_verified: 2026-08-20
---

# freelens-oci-cluster設計判断の記録

> 実装理由、OCIリソースの対応関係、既知の制約を確認するときに参照する。

コードから読み取れない判断とドメイン知識を記録する。

使い方と前提条件は[README](../README.md)、ociコマンドの詳細は[OCIコマンド連携](oci-command.md)を参照。
Extension APIの一般的な罠は[FreeLens拡張APIの情報源](extension-api.md)を参照。

## 関連リソースの定義

「クラスタに関連するOCIリソース」は次の4経路の和集合とする。
K8s起点を正とし、タグ起点はK8sに対応が残っていないリソース（残骸）の検出補助とする。

| # | 起点 | 経路 | 対象 |
|---|------|------|------|
| 1 | K8s | Node `spec.providerID` = Instance OCID | ノード実体 |
| 2 | K8s | Service (type=LoadBalancer) のingress IPとLBのIP照合 | NLB / classic LB |
| 3 | K8s | PV `spec.csi.volumeHandle`（CSI driverで分岐。Block VolumeはOCIDそのもの。FSSは `<OCID>:<mount target IP>:<export path>` 形式で、IPとpathをmount targetとexportに照合してFileSystemを決める。照合できないときだけ先頭OCIDから推定する。先頭OCIDはFileSystem OCID / Export OCIDのどちらもあり、後者は `fs export get` の `file-system-id` でFileSystem OCIDへ解決する） | Block Volume / FSS |
| 4 | OCI | `Oracle-Tags.CreatedBy = <cluster OCID>` タグ検索 | OKE/CCMが作成したリソース全般 |

ネットワークページの「クラスタ関連LB」判定はこれに加えて第3の基準を持つ（実装は[network-path.ts](../src/renderer/match/network-path.ts)の `clusterLbIds`）。

- バックエンドIPがノードまたは判定済みクラスタ関連LBのIPを指すLBを連鎖で拾う（固定点まで展開）。
  手動作成のWAF用classic LB → ingress NLB → ノードという2段LB構成が実在するため（タグもService IPも持たないLBがクラスタの前段に立つ）

実テナンシで検証済みの前提を残す。

- OKE/CCMが作成したNLB・VolumeにはクラスタOCIDのCreatedByタグが付く
- InstanceのCreatedByはノードプールOCID（クラスタOCIDではない）。
  アンカー解決（providerID → instance → nodepool → cluster）はこの2段構造が前提。
  ノードタブのプール名解決も同じタグを使う（virtual node / self-managed nodeは形式が異なり「-」表示に落とす）
- `ce node-pool get` の `nodes[].id` は配下ノードのCompute Instance OCID（実機採取で確認、削除済みノードも残って返る）。
  `ce node-pool list` の要素はこの配列を持たないため、Instance → ノードプールの正確な対応はプールごとのgetでしか得られない
- 人手作成のFSS（FileSystem / MountTarget）はタグに乗らない。
  経路3でのみ拾える
- OKEのCSIが作成したリソースには2種類のクラスタ系タグが付く。
  system tag `orcl-containerengine.Cluster` は管理しているクラスタ、`Oracle-Tags.CreatedBy` は作成したクラスタを指す。
  system tagが現クラスタ、CreatedByが別クラスタを指すFSSを2026-10-02に確認した
- FSS PVのvolumeHandleの先頭OCIDは、IPとpathが指すFSSと一致するとは限らない。
  同じmount targetのexport setに `/Tavinos` と `/wp` が並び、pathが `/Tavinos` のPVの先頭OCIDが `/wp` 側のFileSystemを指す例を2026-10-02に確認した
- classic LBも実在するため経路2はNLB / classic LBの両対応が必要

## 主要な設計判断

| 項目 | 決定 | 理由 |
|------|------|------|
| OCIデータ取得 | 利用者が指定するoci互換コマンドの都度実行（実装は[cli/](../src/renderer/cli/)のコマンド定義表と、mainの `execFile` 実行機） | 利用者に秘密の露出も専用部品の自作も要求しない。configを持たない運用（シークレットマネージャ）でも「動くociコマンド」だけで足り、高速化は拡張外（互換コマンド側）に開放できる |
| Node依存処理の置き場 | ociコマンドの起動（[main/oci-exec.ts](../src/main/oci-exec.ts)）とDNS解決（[main/dns.ts](../src/main/dns.ts)）をmainプロセスに置き、rendererからIPCで呼ぶ（[renderer/oci-ipc.ts](../src/renderer/oci-ipc.ts)）。同時実行数の上限（8本）はrendererのフレームごとに数える | FreeLens 2.0のrendererにはNode / Electronの保証が無い。上限をmainで数えると全クラスタフレームで8本を共有し、あるクラスタの取得が別クラスタの取得待ちになる |
| （経緯）SDK直呼び出し | 0.1〜0.2 系はOCI TypeScript SDKをrenderer内で直呼びしていた（CLIのPython起動 ≈1秒/callを避けるため。SDKは ≈0.3秒/call） | 鍵をアプリへ渡す経路が必要になりconfigレス運用を締め出すため、速度を捨ててCLI委譲へ戻した |
| レスポンス型 | 実機採取フィクスチャ由来の自前kebab-case型定義（SDK非依存）。CLIのJSON出力を変換せずそのまま扱い、拡張が読むフィールドだけを[oci/types.ts](../src/renderer/oci/types.ts)に宣言する | 変換層とSDKバージョン乖離を排除するため。型の正は実出力（[cli/\_\_fixtures\_\_/stdout/](../src/renderer/cli/__fixtures__/stdout/)）であり、SDKモデルに寄せると「SDKではcamelCase・CLIではkebab-case」の写像規則を自前で維持することになる |
| クラスタ紐付け | Node providerID起点の自動解決 | ユーザ設定ゼロ。providerID単独依存の単一障害点であり、形式が想定外なら「対象外」ガイダンスに落とす |
| compartmentスコーピング | アンカーcompartmentとタグ検索結果のcompartmentの和集合ごとにlist実行 | クラスタとリソースのcompartmentが異なる構成を吸収する。タグ検索完了を待つ2段階取得になるが、並列性より取りこぼし防止を優先した |
| 取得単位 | ページ単位の遅延取得（クラスタ × セクションのメモリキャッシュ + 手動更新）。ネットワークページのsubnet/SL/RT/NSG/WAFポリシー等はper-OCIDのMapセクション | ノードだけ見たいときに他ページ分の取得を待たせない。per-OCID Mapは個別リロード（そのブロックだけ再取得）の単位になる |
| ネットワークページの取得順 | cluster応答の `vcn-id` とタグ検索のcompartment集合が揃った時点で、型別list（subnet/RT/SL/NSG/NAT/IGW/SGW/LPG/DRG）を1段で並列に実行し、結果をMapへ一括でready化する。per-OCID getはlistに現れなかったOCIDのフォールバックのみ。NSGルールは一括ルートが無くNSGごとの `nsg rules list` を次段で並列に実行する | 律速は直列段数 × API往復であり、per-OCID getの数珠つなぎ（subnet → SL/RT → ゲートウェイ）がリソース数に比例して段を伸ばしていた。VCN配下のlistはgetと同一のフルモデルを返す（Summary型が無い）ため表示項目を落とさない。VCNがcompartment集合の外にある構成ではlistが空になるためフォールバックを残す |
| pv-storageの取得順 | FSSスナップショットポリシーとVolumeバックアップポリシーはcompartment（× AD）単位のlistをPV読み込みと並走させ、名前解決は索引引きで済ませる。FileSystem本体はper-OCID getのまま。FSS PVの参照先は、mount target（compartment × AD）とexport（compartment）のlistを並走させ、稼働中のmount targetのprivate IPを `network private-ip get` で引いたうえで、IPとexport pathの組で決める。AD一覧はスナップショットポリシー一覧と共有する。照合できないPV（mount targetかexportが見つからない、handleがIP:path形式でない、対応表の取得に失敗した）だけを先頭OCIDへ落とし、そのうちExport OCIDのPVはper-OCIDの `fs export get` を挟んでFileSystem OCIDを得る（この解決の失敗はそのPVのFileSystem解決失敗として `fileSystems` セクションに乗る）。PVストレージタブとTopologyのPVノード詳細は、先頭OCIDへ落としたPVに推定の印を付け、照合先と先頭OCIDが食い違うPVには先頭OCIDが別のFSSを指す旨を注記する | `fs file-system list` のFileSystemSummaryは `filesystem-snapshot-policy-id` を持たず、バックアップ列の表示に足りない。バックアップポリシー割当（`--asset-id` 必須）にも一括ルートが無い。先頭OCIDが別FSSを指すPVが実在し（[関連リソースの定義](#関連リソースの定義)の検証済み前提）、NFSマウントの対象はIPとexport pathで決まるため、照合はこの組を優先する。mount targetの応答はIPアドレスを持たずprivate IPのOCIDだけを返すので、IPの照合にprivate IPのgetが要る。exportを持たないmount targetのIPも引くのは、exportだけを消した構成でexportの不在を確定させるため（[孤立PVの判定](#孤立pvの判定)）。対応表の取得失敗をセクションの失敗にしないのは、先頭OCIDによる推定でPVとFSSの対応自体は従来どおり描けるため |
| 別クラスタを指すタグ | 参照先のBlock Volume・FSS・Instance・LB・NLBが持つクラスタ系タグを、アンカー解決で得た現クラスタのOCIDと比べる（判定は[cluster-tag.ts](../src/renderer/match/cluster-tag.ts)）。違うクラスタを指すものは出所ごとに書き分けて注記する。system tag `orcl-containerengine.Cluster` が違えば「別クラスタの管理下」（`Managed by another cluster (system tag)`）とする。`Oracle-Tags.CreatedBy` が `ocid1.cluster.` で始まり、かつ違えば「別クラスタが作成」（`Created by another cluster (CreatedBy tag)`）とする。タグが無いとき、CreatedByがクラスタOCIDでない（人名・ノードプールOCID）ときは何も出さない。InstanceはCreatedByがノードプールを指すため、system tagだけを見る。FSSはIP:pathで照合した実体のタグを読む。別クラスタはOCIDだけを出す。表示箇所は、PVストレージのEntity Name列、Service ↔ LBのLB Name列、ノードのInstance列、ネットワークのLB / NLBのName列にある注記と、Topologyのノード（[Topology図の設計判断](#topology図の設計判断)）。注記の文言は検索の対象にする | 2つのタグは意味が違う。system tagはいま管理しているクラスタを、CreatedByは作成時のクラスタを示し、管理が移ってもCreatedByは変わらない（[関連リソースの定義](#関連リソースの定義)の検証済み前提）。1つにまとめると、別クラスタに管理されているのか、作成元が別なだけなのかを読み分けられない。CreatedByには人名やノードプールOCIDも入るため、クラスタOCIDの形のときだけ比べて誤検知を避ける。判定材料は既存のlist / get応答に含まれるため、APIを増やさない。別クラスタの名前を出すには別クラスタへの `ce cluster get` が要り、削除済みや権限外のクラスタでは引けないため、OCIDの提示に留める |
| 表示の露出単位 | UI階層で2段階。①一覧（テーブル行・ステータス）はセクション単位で確定次第それぞれ出す。ただし1つのテーブルは行集合と各行のセル材料が揃うまで出さない（判定は[section-ready.ts](../src/renderer/match/section-ready.ts)）②アコーディオンの中身（SL/RTルール・NSGルール・WAFポリシー・証明書・DNS解決）はper-OCIDの結果が来るまでその場にスピナーを出す。どちらも「成功または失敗」で確定とみなす | 取得段の単位でまとめて出すと、先に返ったテーブルまで待たされて体感が遅くなる。一方でテーブル内で行やセルが後から増えると画面がガタつくのでテーブル単位では原子的に出す。失敗を待ち条件から外すのは、1セクションの権限不足で他が永久に出ないのを防ぐため |
| （例外）DNSセクション | `section-ready.ts` のゲートを通さず、行集合をK8s（Ingress / Service）から直接組む。各行の解決結果だけがper-OCIDのスピナー扱い | 行の材料がOCIではなくK8s側にあり、`dnsChecks` の登録を待つと「該当ホスト名なし」を誤って先に出してしまう |
| DNSゾーン突合 | GLOBALスコープのゾーンをcompartment集合の横断listで取り、ホスト名の最長サフィックス一致（[dns-zone-match.ts](../src/renderer/match/dns-zone-match.ts)）でゾーンを決めてコンソール遷移を出す。PRIVATEゾーンは対象外。ゾーン取得の失敗はこのセクション単独の失敗として扱い、DNS行自体は従来どおり出す | 委譲された子ゾーンがある構成では親ゾーンを開いてもレコードが無い。突合先が無い環境で行ごと消えると解決結果の確認までできなくなる |
| 取得中の表示 | スピナー（[spinner.tsx](../src/renderer/components/spinner.tsx)）に統一しテキストラベルは使わない。本体の `spinner.scss` と同じ幾何のCSS（[spinner.css](../src/renderer/components/spinner.css)）を当てる。唯一の例外がTopologyの初回ローディングで、確定セクション数n/mと待機中セクション名をテキストで出す | 本体UI（cluster overview等）と見た目を揃える。「Loading...」の文字は幅を持つため、実データに置き換わるときに列幅と行の高さが動く。Topologyは表セルではなく図全体の代替表示であり、列幅が動く問題が起きない。図は全セクション確定まで何も出せない分、無言のスピナーでは待ち時間の見当がつかない |
| backend health | ページごとに取得単位を変える。ネットワークページは行の展開時オンデマンド取得のみ（検索語が入力されている間だけ、表示中の全LB行分を先行取得）。Topologyページは表示時と自動更新のたびに、クラスタ関連LB/NLBの全backend setを同時4本までで一括取得する。キャッシュ（`backendHealths`）は両ページで共有し、ネットワークページの周期更新はオンデマンド要求済みのキー（`requestedBackendHealths`）に限って同時4本までで取り直す | 揮発データのため、ネットワークページでは取得を見た分だけに抑制する。キャッシュ共有だけではTopologyが書いた全backend setまで周期更新の対象になるため、要求元をキーで記録して抑制の単位を保つ。検索中だけ緩めるのは、検索結果が展開履歴に依存しないようにするため（未展開行のbackend healthもヒットさせる）。Topologyは行の展開に当たる操作を持たず、健全性を出す手段がエッジの色しかないため一括取得しか選べない。同時実行を絞るのはbackend set 1件につきociプロセスが1つ起動するため |
| ノードプール本体 | Topologyページだけが、表示時と自動更新のたびにクラスタの全ノードプールを同時4本まででgetする（`nodePoolDetails`）。個別プールの失敗はログに残すだけで、そのプールぶんの集約がプール不明へ落ちるに留める。backend healthと同じく初回描画の待ち条件には入れず、揃った時点で世代を進める | Instance → ノードプールの対応が要るのはTopologyの集約だけで、一覧しか要らないページ（Nodes / Network）にプール数ぶんのgetを足す理由が無い。プール全滅でも図は従来どおりSubnet単位の集約で成立するため、セクション扱いにして進捗と欠落バナーへ載せると、図に出ている情報を「無い」と読ませる |
| 自動更新 | 全ページ共通トグル（永続化）+ 間隔設定（既定60秒・下限30秒）。再取得は旧データ表示のまま裏で差し替える（force方式）。周期リトライで自然回復しないエラー（認証系・コマンド起動失敗・互換コマンド非互換・内部エラー）の検出で自動停止しトグルをOFFへ倒す | セクションをidle化すると更新間隔ごとにページ全体がスピナーへ戻る。自動停止は30〜60秒ごとのoci実行とエラー連打を防ぐ |
| LBのIP照合 | ingress IPとLBの全IP集合（public/private）の完全一致。多対一は行複製で表示 | LBは複数IP・public/private混在がありうるため比較対象を固定する。同一LBを複数Serviceが使う構成はOKEで正当 |
| DNS突合 | mainプロセスで `node:dns` の `lookup`（OSリゾルバ）により解決し、クラスタ関連LBのIPと照合 | `resolve4`（DNSサーバ直接クエリ）はWindowsのVPN/リゾルバ構成でECONNREFUSEDになる（実機で遭遇）。lookupはアプリが接続時に使う経路そのもので突合の意味にも合う |
| LB証明書期限 | LB埋め込みPEMとCertificatesサービス（`certificate-ids` → 管理API get）の2方式に対応する。PEMはrendererの自前DERパーサ（[x509.ts](../src/renderer/match/x509.ts)）で期限・subject・SANだけを読み、表記をNodeの `X509Certificate` に合わせる | listenerのSSL構成にどちらの方式も実在する（実テナンシはcertificate-ids方式）。rendererには `node:crypto` が無く、Web Cryptoは証明書を解析しない。パースをmainへ移すと、同期で組んでいる行の導出（[network-path.ts](../src/renderer/match/network-path.ts)）が非同期になる。表記の一致は、テスト内で組み立てた証明書をNodeの出力と比べて確かめる |
| WAF | classic LBのみ突合（`load-balancer-id`）。行展開でWAFポリシーの全ルール（アクセス制御条件・レート制限・保護capability）と既定アクションを表示 | NLBはWAF非対応。ブロック理由の実体はポリシー側にあり、名前だけでは調査が完結しない |
| ゲートウェイ生死 | RTルート宛先（NAT/IGW/SGW/LPG/DRG）をOCID種別でgetし分け、無効化・遮断・未接続を表示 | 経路表が正しくてもゲートウェイが無効なら通らない。宛先種別の表示だけでは盲点になる |
| 実行機の上限 | 60秒 / call、同時8プロセス、stdout 64MiB / call（2026-07-31 実測で確定） | ociの突発遅延（初回起動・大規模list）は許容しつつ、ハングと巨大出力をセクション単位のエラーへ落とす。同時実行上限はプロセス起動スパイクの抑制 |
| エラー分類 | 非OKE（事前判定）/ コマンド起動失敗 / 認証系 / 権限・不在 / 互換コマンド非互換 / その他 + 生のexit code・stderr併記。分類不能は「その他」（ポーリング継続側） | OCIに不慣れな利用者へ対処方法を提示しつつデバッグ可能性を保つ。設定ミス（起動失敗・互換コマンド非互換）をプラグインのバグ表示に混ぜない |
| 検索・絞り込み | 表示専用のクライアントサイド絞り込み（`filter-rows.ts`。空白区切りトークンのAND・部分一致）。取得済みデータの再取得は起きない（唯一の例外がbackend healthの先行取得で、検索語がある間だけ表示中の全LB行分を新規取得する）。テーブル系ページは非マッチ行を除外、Topologyは非マッチのノード・エッジを減光（除外はしない）。展開領域（ルール・backend health等）の値にしかマッチしない行は自動展開する（判定は `matchedOnlyInDetail`） | 図は要素数の変化で配置が動くため除外ではなく減光にした（[レイアウト](#topology図の設計判断)の決定論と両立させる）。展開領域の値で検索を通したのに中身が閉じたままだと、何にマッチしたのか利用者が確認できない |

## 孤立PVの判定

PVストレージタブとTopologyは、PVの参照先をOCIで取得できなかったとき、その理由を3状態に分けて表示する（判定は[pv-storage.ts](../src/renderer/match/pv-storage.ts)の `isOrphanedPvStorage`）。
OCIは削除済みや架空のOCIDにも、権限不足にも、同じ404 `NotAuthorizedOrNotFound` を返す。
getの応答だけでは区別できないため、getが404だったOCIDだけをResource Search（`search resource structured-search`）で照会し直す。

| 状態 | 判定基準 | PVストレージタブの文言（Volume / FileSystem、export） |
|---|---|---|
| 不在（確定） | getが404で、Searchのヒットの `lifecycle-state` が `TERMINATING` / `TERMINATED` / `DELETING` / `DELETED` のどれか。FSSでは、IP:pathのIPに当たる稼働中のmount targetがあり、export一覧の取得にも成功したのに、そのpathのexportが無い場合も不在と確定する | `Not found in OCI (orphaned PV)`、`Export not found (file system may still exist)` |
| 存在するが権限不足（確定） | getが404で、Searchでヒットし、`lifecycle-state` が上の終了状態でない | `Exists in OCI but not readable (insufficient permission)`、`Export exists but not readable (insufficient permission)` |
| 不在または権限不足（不明） | getが404で、Searchでヒットしない。Search自体が失敗した場合もここに倒す | `Not found in OCI or not readable (unconfirmed)`、`Export not found or not readable (file system may still exist)` |

Topologyは、PVノードの詳細パネルの `Status` 行で同じ3状態を書き分ける。

取得の手順は次のとおり。

- Searchは正常系では走らない。
  getが404だった参照先（Volume・export・FileSystem）のOCIDを種別をまたいで集め、`identifier = '…'` をOR結合した1回の照会で引く（コマンドは[command-defs.ts](../src/renderer/cli/command-defs.ts)の `resourceSearchByIds`）
- 1回の照会に載せるOCIDは50件までとし、超えたら分割する。
  50件（クエリ約3.5KB）を1回で照会できることは2026-10-02に実機で確認した
- Searchの失敗はセクションの失敗にしない。
  その照会に載せたOCIDを「不明」に倒すだけで、欠落バナーにも載せない
- exportの不在をIP:pathで確定できたPVはSearchに載せない。
  mount targetとexportのlistだけで決まるためである

終了状態でヒットしたOCIDを不在に寄せるのは、権限不足と誤読させないためである。
ただし、Searchが終了状態のリソースを返す場面は実機で観測していない（2026-10-02に `lifecycleState = 'TERMINATED'` で照会し、結果は0件だった）。

判定は、検証できていない前提に1つ依存する。

- Searchのヒットは、対象リソースへのget（read）権限ではなくinspect権限で決まる、という前提に立つ。
  OCIのIAMの一般仕様からの推論で、権限不足のリソースを用意できず実機では確かめていない
- inspect権限も無いリソースはSearchでもヒットしないため、「不明」になる
- この前提が崩れてSearchのヒットにもread権限が要る場合、権限不足のリソースはSearchでもヒットせず「不明」に落ちる。
  存在しないリソースを「権限不足（確定）」と表示する方向には崩れない

## Topology図の設計判断

Topologyページはクラスタ関連リソースの位置と繋がりを一枚の図で見せる。
描く対象の範囲は[関連リソースの定義](#関連リソースの定義)と同じ4経路 + LB連鎖に従う。

| 項目 | 決定 | 理由 |
|------|------|------|
| 図の種類 | 階層コンテナ図（VCN ⊃ Subnet ⊃ 実体の入れ子ボックス + 参照エッジ） | 扱うのは実リソースのインスタンスであり、包含構造が支配的。種別レベルのER図では「どのノードがどのSubnetにいるか」という運用の問いに答えられない |
| 表示Subnetの絞り込み | クラスタ関連の子を持つSubnetとendpointサブネットだけ描き、残りは「N subnets not shown」1個に畳む（詳細パネルに畳んだSubnetのname/CIDR/OCID一覧を出す）。ゲートウェイも表示SubnetのRTから参照される分だけ描く | 共有VCN（実機では約30サブネット中クラスタ関連は数個）で全表示すると、クラスタ関連のSubnetとリソースが無関係な箱とrouteエッジの束に埋没する。件数サマリを残すのは存在まで隠さないため。CIDR照合とLB配置の候補集合には取得した全Subnetを使い、絞り込みで配置根拠は変えない |
| Instanceの配置根拠 | primary VNICの `subnet-id` を優先し、VNICを取れないときだけNodeのInternalIPとSubnet CIDRの照合へ落とす（どちらも決まらなければUnplaced領域へ置く）。VNICはcompartment一括の `compute vnic-attachment list` から、クラスタのNodeに対応するInstanceの分だけ `network vnic get` する。自動更新ではattachment一覧だけを取り直し、VNIC本体は未取得分だけgetする（手動更新は全件取り直す）。列挙の根拠であるK8s Node集合の変化には監視（2秒デバウンス）で追従して取り直す。VNICを取れなかったときはInstanceノードの欠落ではなく、配置・IPが読めない劣化としてバナーへ出す | CIDR照合は推定でしかなく、同じCIDRを含むSubnetが複数ある構成やsecondary VNIC側のIPがInternalIPになっている構成では0 件一致・複数一致に落ちる。VNICは所属Subnetそのものを持つ一次情報であり、private / public IPも同じ応答から取れる。attachmentをInstanceごとに引かずcompartment一括にするのは、他のlist系と同じく呼び出し回数をノード数に比例させないため。VNIC本体の `subnet-id` / `is-primary` は付け替えの無い値であり、周期ごとにノード数分のgetを繰り返す価値が無い（public IPの付け替えは手動更新で拾う）。Node集合はポーリング間隔と無関係に変わる（スケール・ノード入れ替え）ため、追従しないと新しいノードが次の周期まで図に出ない。Instanceノード自体はinstances listで出るため、ノードの欠落と書くと図にあるものを「無い」と読ませる |
| Instance ↔ Volumeの紐付け | compartment一括の `compute volume-attachment list` から、K8s NodeのproviderIDが指すInstanceにATTACHEDなものだけをattachmentエッジにする。参照先VolumeがPV経由で既に図にあれば合流させ、無ければVolumeノードを新規に作る（VolumeはSubnetに属さないためトップレベルに置く）。ブートボリュームは対象外 | PV経由でしかVolumeが図に出ない状態では「このノードにどのボリュームが付いているか」に答えられず、PVを持たない手付けボリュームは存在ごと見えない。Instance側に「Volumes: N attached」と件数を書く案は、どのVolumeかを示せずエッジと二重になるため不採用。ブートボリュームはattachmentのlistがAD指定必須で、さらに名前・容量を出すには `bv boot-volume list` もADごとに要る。ノード数と同数のノードが増えて図が膨らむ割に、運用上の関心はPVを支えるブロックボリューム側にある |
| backend healthのエッジ反映 | LB/NLB → Instanceエッジの線色をbackend set healthで上書きする（ok / warning / critical / unknownの4色。warningはノードの警告枠、unknownはノードの状態不明枠と同じ色）。突合はbackend名（`ip:port`）のIP部とInstanceのIPで行い、1本のエッジへ複数のbackend（集約ノード・複数backend set・複数IP）が合流する場合は最も深刻な状態を採る。ヘルスを取れなかったbackend setのエッジは色分けせず種別色のまま残し、欠落バナーにも載せない。critical / warningのうち設計どおりの不合格は次行の規則で第5の状態へ落とす | 図で健全性を出せる場所はエッジの色しかない（ノードはlifecycle-stateで既に埋まっている）。合流時に深刻な方を採るのは、1件でも落ちている事実を集約で消さないため。backend名はInstanceのOCIDを持たないためIPでしか突き合わせられない。取得失敗を欠落として扱わないのは、色が付かないだけでエッジ自体は成立しており、バナーに出すと図の欠損と読み違えるため |
| `externalTrafficPolicy: Local` による格下げ | backendエッジのcritical / warningのうち、「そのInstanceに対応するK8sノードにPodが居ないから落ちている」と説明しきれるものを第5の状態 `no-local-pod`（灰青 `#6e8496` + 破線、ラベル `No Local Pod (by design)`）へ落とす（判定は[local-traffic-policy.ts](../src/renderer/match/local-traffic-policy.ts)、適用は[topology-graph.ts](../src/renderer/match/topology-graph.ts)のbackendエッジ生成時）。格下げの条件は、(1) そのエッジのLBに対応するServiceが1件以上あり、(2) そのすべてが `externalTrafficPolicy: Local` で、(3) そのすべてが当該ノードにready endpointを持たず、(4) そのすべてがクラスタ内のどこか別のノードにはready endpointを持つこと。1つでも欠ければ格下げしない。深刻度はokとunknownの間に置き、集約ノードへ畳んだエッジでは真のcritical / warningが勝つ。ready endpointの所在はEndpointSliceの `kubernetes.io/service-name` ラベルと `endpoints[].nodeName` / `conditions.ready` から引き、Service ↔ LBの対応はservice-lbエッジと同じ突合を使う。EndpointSliceストアは他のK8s入力と同じくトポロジーページ表示中だけsubscribeするが、初回ロード完了を待つ分母（`TopologyK8sLoaded`）には数えない | OKEのNLBはServiceが `externalTrafficPolicy: Local` のとき、Podが居ないノードのhealthCheckNodePortチェックが設計どおり失敗してcriticalになる（実機の `jsk/ssh-*` 系で確認）。これはルーティング制御の結果であって異常ではなく、真の異常と同じ赤で塗ると図全体の警報価値が落ちる。条件を「対応Serviceのすべて」に課すのは、1つのLBにClusterポリシーのServiceも対応しているなら、そちらの経路としては本物の異常だから。ready endpointがどのノードにも無いServiceを除くのは、その状態はLocal由来の設計動作ではなくサービス全断であり、灰色へ落とすと全断が図から消えるため。深刻度をokの上に置くのは、格下げが「正常」の主張ではなく「この赤は読まなくてよい」の主張だから。色をunknown（`#9aa0a6`）と別トーンにしたうえで破線も併用するのは、灰系2色の判別が暗色テーマ上の細線では成立しないため。EndpointSliceを待たないのは、取れなくても図は格下げが起きないだけで成立し、RBACでendpointslicesを読めない環境をスピナーで止める理由が無いため |
| 集約縮退 | Subnet内のInstanceが10超なら集約ノードへ畳む（クリックでSubnet単位に展開）。畳む単位はノードプールで、`instance-group:<subnetId>:<poolId>` に分ける。ラベルは `プール名 (n nodes)`、2行目にシェイプとKubernetesバージョン、詳細パネルにプールのOCID / 台数と畳んだInstanceを出す。どのプールにも属さないInstanceは `instance-group:<subnetId>` の1つへまとめる。分けた結果1件になる束は畳まずInstanceのまま残す | 大規模クラスタでSubnetボックスが巨大化し俯瞰性を失う。閾値10は1ボックスに並べて読める上限として置いた可読性由来の値で、データ側の境界ではない。閾値をSubnet合計で見るのは、プールごとに数えると「10台のプールが3つ」で30箱が残り、閾値が箱の数を抑える役目を果たさなくなるため。畳む単位をプールにするのは、集約後に残る問いが「どのプールが何台か」であり、混ぜると台数しか読めなくなるため。1件を畳んでも箱は減らず、Instanceの詳細とコンソールリンクだけが失われる |
| Instance → ノードプールの対応 | `ce node-pool get` の `nodes[]` から引いた索引を正とし、引けないInstanceだけCreatedByタグへ落とす。集約の分割と通信許可エッジのNSG解決、Instanceノードの `Node Pool` 詳細が同じ索引を使う | CreatedByはプールが作った事実を示すだけで、`nodes[]` は現在の所属そのもの。索引が未取得・失敗の間もタグで従来どおりの分割が成立するため、フォールバックを残す |
| SL / RT / NSG | ノード化せず、Subnet / LBの詳細パネル内のID列挙に留める。ルールの中身はネットワークページの役割 | 多対多参照でエッジが爆発し俯瞰性を壊す。SL/NSG自体は図の中に位置を持たず、ノードにしても包含構造のどこにも収まらない |
| 通信許可エッジ | SL / NSGのingressルールから「どこからどこへ通してよいか」のエッジを導出する（実装は[topology-security.ts](../src/renderer/match/topology-security.ts)）。導出は常に走り、凡例・欠落バナー・表示切り替えの扱いは他のエッジ種別と同じ（既定は表示）。Subnet段（`sl-allow`）はSLのingressのsource CIDRと重なる別Subnetから許可先Subnetへ、リソース段（`nsg-allow`）はsourceが指すNSGを持つリソース、またはsource CIDRに入るIPを持つリソースから許可先リソースへ張る。リソースのNSGはLB/NLBの `network-security-group-ids` と、Instanceはノードプールの `node-config-details.nsg-ids` から引く。同一ペアの複数ルールは1本へ畳み、ラベルは種別名でなくポート要約にする（`tcp/443, tcp/6443`、5件以上は `tcp/443 +5`）。0.0.0.0/0（::/0）とVCN全体を含むsource、および適用先自身が属するNSGからの許可は捨てる。VCNのCIDRを読めない間（VCNセクションの未取得・失敗）は通信許可エッジ自体を出さず、`sl-allow` / `nsg-allow` の欠落バナーへ `vcn` セクションを載せる。集約後のエッジ数を凡例の行に出し、集約前のリンク数と併せて `Common.logger` へ残す | ルールの一覧はネットワークページで読めても、「どのSubnetからどのSubnetへ通るのか」は表を突き合わせないと分からない。既定ONで他種別と同じ扱いにするのは、凡例のクリックでいつでも外せる以上、この種別だけ初期状態・件数表示・欠落バナーの規則が違うと、同じ凡例の中で挙動の読み方が2通りになるため。集約しないと1ペアにルール数ぶんの線が重なり本数を数えられない。広すぎるsourceを捨てるのは、図中の全要素へ一斉に線が伸びて完全グラフになるうえ、その線が「どこから」の情報を持たないため（0.0.0.0/0 の公開性はroute → Internet Gatewayのエッジで既に読める）。VCN CIDRを読めない間に導出を続けると、まさにその「VCN全体を含むsource」を捨てられず完全グラフ化するため、誤った広域エッジを出すより出さない側に倒す。自NSGからの許可も同じくNSGメンバ間の総当たりにしかならない。InstanceのNSGをノードプールから引くのは、VNIC応答へNSGを足すと取得段の変更になるため |
| DRGの配置 | compartment属だがVCNボックスの中に描く | 図での意味はVCNへの接続点であって所属compartmentではない。親を解決できないゲートウェイもVCNへ取り込み、図の外に浮かせない |
| レイアウト | 自前の決定論レイアウト（同一データなら同一配置）。左レーンはトラフィックの上→下一方向流、VCN内もSubnetを「LB/NLB持ち → Instance持ち → その他」の段に分けて縦に積み同じ流れを保つ、右レーンはPV → ストレージ → ポリシーの独立成分を1成分1行で積む。`@xyflow/react` は描画・操作だけに使う | 一方向流はSugiyama法の定石、非連結成分をレーンで分けるのはELKのdisconnected component packingに対応する。ストレージが多いクラスタでも右レーンが縦に伸びるだけで、左レーンのトラフィックの流れの可読性を保てる（実機2クラスタで確認した問題への対処）。配置が更新のたびに揺れると「図が変わった = 構成が変わった」の読みが崩れるため決定論にする |
| エッジ経路 | 自前の直交ルーティング（格子 + 通路を前提としたchannel routing） | ノード矩形との交差ゼロと同一線分の完全重複ゼロをユニットテストで保証する。ボックスを貫通する線は所属の誤読を生み、重なった線は本数を数えられなくする |
| 更新の原子性 | 図の再導出は更新世代 + 確定スナップショットで一括コミットする。導出層はstoreを直接監視しない。原子性の契約はOCIスナップショットに対するもので、K8s側入力（Node / Service / PV）はライブ反映を許容する | force更新はセクション個別の差し替えで進む（stale-while-revalidate）ため、storeを直接見ると新旧混在の図が生成される。K8s側はFreeLens本体がwatchで持つ最新値であり、待たせる意味も待つ単位も無い |
| 描画技術 | `@xyflow/react` v12（MIT、peerDepsは `react >=17`） | パン / ズームとエッジ描画が組み込みで、ノードをReactコンポーネントとして書ける。hostのReact（FreeLens 2.0では19）を共有する制約下でも、ビルド出力にReact本体が入らずバンドルが重複しない |
| React FlowのCSS | `dist/style.css` を通常のimportで読み、ビルドが `out/renderer/index.css` へ出す | ホストがrendererエントリと同じディレクトリの `index.css` を `<link>` で読み込む。React Flowのセレクタは `.react-flow` 配下に閉じており、常に読み込まれていても本体UIへ当たらない |
| 孤立PV | 参照先のVolume / FSSの実体を確認できなかったPVはノードの警告表示（詳細パネルの `Status` 行に理由）とし、欠落バナーには載せない。判別は、照会が失敗したときだけ追加で走らせる存在確認で行う。理由の文言は[孤立PVの判定](#孤立pvの判定)の3状態で書き分け、FSSはexportの不在とFileSystemの不在も書き分ける。3状態とも警告枠にする | 残骸検出はこのプラグインの思想であり、残骸を生のエラーとして見せるのは表示設計の欠落（実機の孤立PVで確認）。「404 = 割当なし」に倒す案は本物の権限エラーを握りつぶすため不採用。存在確認を失敗時だけに限るのは正常系のAPIを増やさないため。FSSはexportだけ消えてFileSystemが残る運用も成立するため、exportとFileSystemをまとめると誤読を生む。権限不足と確定したPVも警告枠にするのは、参照先の中身をこのプラグインで読めない点は不在と同じく確認が要るため |
| 別クラスタを指すタグ | 食い違いのあるVolume・FSS・Instance・LB / NLBのノードは警告枠にする。詳細パネルには `State` の直後に出所ごとの行を足す（値はクラスタOCIDで、コピーできる）。この行は食い違いがあるときだけ出し、詳細の項目数の目安（共通3項目 + 種別固有5項目）に数えない | 図で異常を伝えられるのはノード枠とエッジの色であり、詳細パネルの行だけでは図を俯瞰したときに見落とす。lifecycle-stateが正常でも、別クラスタの管理下にあるリソースは運用上の確認対象になる |
| コンソールリンクの範囲 | OCIリソースは全種別に出す（ゲートウェイ・VCN含む）。PVノードは参照先ストレージのページへ飛ばす。集約ノード・K8s Service・件数サマリには出さない | 「OCIリソースなのに飛べない」違和感が実機確認で出たため、リンクを持つ種別を絞らない。集約・K8s・サマリはOCIコンソールに対応するページ自体が無い |
| エッジ種別の表示切り替え | 図の凡例をそのままトグルにし、行のクリックでその種別のエッジを図から外す（実装は[topology-edge-filter.ts](../src/renderer/match/topology-edge-filter.ts)）。凡例にはフィルタ前のグラフに実在する種別を本数つきで並べ、隠している行も減光して残す。backendの行の下にはhealth別の色見本・ラベル・本数を字下げして続け、これも種別の行と同じくトグルにする（healthの行を隠すと、そのhealthで塗ったbackendエッジだけが図から外れる。healthを持たないbackendエッジは種別の行にだけ従う）。絞り込みはグラフ構築の直後・レイアウトとMermaid導出の前の一点で行い、画面・Mermaid・SVG・PNGは同じ絞り込み後のグラフを見る。隠した種別は欠落バナーの該当行も落とす。backendを隠すとhealthで塗ったエッジも同じ種別として消え、healthの行も一緒に消える。状態は永続化せず、ページ再訪で既定（全種別ON）へ戻る | 「この線は何か」を読む凡例と「この線を消したい」の操作は同じ対象を指しており、別の場所に置くと対応を探す手間が増える。絞り込みを1点に寄せるのは、出力ごとに絞ると4系統へ分岐が増え、画面とエクスポートが食い違うため（エクスポートは画面でいま見えているエッジをそのまま出す）。隠した行を凡例から消さないのは、消すと、図の上で隠した種別を戻す手段が無くなるため。本数を添えるのは、隠す前に本数が読めないと消す価値を判断できないため（Mermaid / SVGの凡例には出さない。出力に本数は要らず、全種別ONのときの出力を変更前と一致させるため）。healthの行を画面にも置くのは、線がhealthの色で塗られているのに意味が画面のどこにも無く「この赤い線は何か」に答えられないため（Mermaid / SVGの凡例には最初から出ている）。healthをトグルにするのは、OKを隠してCriticalだけを残す診断の見方が、backend全体のON/OFFでは作れないため。レイアウトは絞り込み後のエッジで組み直すため、種別を隠すと配置も詰まる |
| Mermaidコピー | ヘッダのボタンで、表示中の図をMermaid flowchartのテキストとしてクリップボードへ書き出す（実装は[topology-mermaid.ts](../src/renderer/match/topology-mermaid.ts)）。ノードidは描画順の連番、包含はsubgraphの入れ子、ノード状態はclassDefで表す。親を持たないノードは `Kubernetes` / `OCI` の領域subgraphへ振り分ける（中身が空の領域は出さない）。ラベル2行目（`<br/>`）には要約を添える（InstanceはshapeとAD/FD、SubnetはCIDR、Volumeは容量）。エッジのラベルは種別名だが、通信許可エッジだけはポート要約を出し `linkStyle` を破線にする。末尾に、その出力で実際に使った色の意味だけをコメントの凡例として置く（エッジ種別の色、backend healthで塗ったエッジはその健全性の色、ノード状態） | 図をissueや設計文書へそのまま貼れるようにする。テキストなら差分が読め、貼り先で再レイアウトできる。OCIDをidに使うとMermaidの識別子として扱えず、貼り先でも冗長になる。領域分離は、画面では位置で読めていたK8s側とOCI側の境界がテキストでは失われるため。凡例はMermaidのlinkStyleが色に説明を持てず、貼り先で線色だけが残るため（未使用の種別まで並べると凡例の方が図より長くなる） |
| SVGコピー | ヘッダのボタンで、表示中の図を単体で開けるSVGとしてクリップボードへ書き出す（実装は[topology-svg.ts](../src/renderer/match/topology-svg.ts)）。座標・サイズは画面と同じレイアウト出力をそのまま使い、外部CSS・スクリプト・フォントを参照しない。配色は持ち出し先のテーマに依らない明色固定。末尾に、その出力で実際に使った色の意味だけを凡例として描く（エッジ種別・backend health） | Mermaidは貼り先で再レイアウトされるため、画面で見たとおりの配置は渡せない。単体SVGなら見た目が確定し、Mermaidを解釈しない貼り先にも出せる。暗色トークンのまま出すと明色背景の貼り先で読めなくなる |
| PNGコピー | ヘッダのボタンで、SVGコピーと同じ出力をCanvas経由でPNG画像としてクリップボードへ書き出す（実装は[topology-png-copy-button.tsx](../src/renderer/components/topology-png-copy-button.tsx)）。倍率は宣言サイズの2倍固定 | SVGを貼れない先（チャット・スライド・issueの本文）へ図をそのまま渡すため。等倍だと貼り先の拡大で字が潰れる |
| MOCKのK8s入力 | ページのK8s参照（Node / Service / PV）をadapterに寄せ、`MOCK=1` ではOCIと同じVite aliasで差し替える | 配置根拠（NodeのInternalIP ↔ SubnetのCIDR）とK8s起点のエッジはK8s側の入力に依存する。OCIだけ差し替えても実クラスタ依存が残り、スクリーンショット撮影が成立しない |

## 認証とシークレット管理

認証はociコマンドの内部で完結し、プラグインは関与しない。

- 認証方式（configのAPIキー / セッショントークン / インスタンスプリンシパル / ラッパによる注入）の選択は利用者の環境側にある。
  プラグインからは区別できず、する必要もない
- Preferencesに保存するのは実行するコマンド文字列だけ（空欄 = PATHの `oci`）。
  鍵・トークン・認証JSONを読む経路をプラグインは持たない

シークレットの扱いでは次の不変条件を守る。

- ディスク・mobx store・Preferencesに鍵・トークン・認証JSONを書かない（保存するのはコマンド文字列のみ）
- ociのstdout / stderrは秘密を含まない契約であり、エラー表示にはexit code・stderrを生のまま出す（秘匿より調査性を優先する）
- 認証系エラー（`NotAuthenticated` / 401、config・プロファイル不備）とコマンド起動失敗・互換コマンド非互換・内部エラーは表示のうえポーリングを自動停止する。
  周期リトライで自然回復しないため。
  再認証は端末側の操作であり、プラグインは再認証も再試行もしない
- 旧「認証情報コマンド」の設定値（`authCommand`）とCLI時代の `ociCommand` は読み捨てる。
  ファイルからは消さないが、ociコマンドとして実行してはならない（旧値は認証情報JSONを返すコマンド）

## 既知の制約

- `Oracle-Tags.CreatedBy` はOracle側の自動タグ機構であり、仕様変更で経路4が空振りする可能性がある。
  K8s起点の3経路が正であるため一覧自体は欠落しない。
- OCIに汎用の依存関係APIは存在しない。
  ネットワークトポロジAPI（`oci network vcn-topology get` 等）は現行IAMポリシーでは404を確認済みで使用しない。
- WAFがクラスタLBと別compartmentにある構成ではcompartment集合の探索から漏れる可能性がある。
- DNSゾーンの探索はクラスタのcompartment集合（アンカー + タグ検索ヒットcompartment）に限るため、ゾーンがその外（テナンシroot等）にある構成では突合できない。
- DNS突合はこの端末のリゾルバによる観測のため、スプリットDNS環境では外部からの解決結果と異なることがある。
- OCIは権限不足と不在に同じ応答（`NotAuthorizedOrNotFound`）を返す。
  Resource Searchで区別できなかった参照先（inspect権限も無い、またはSearch自体が失敗した）は「不在または権限不足（不明）」として表示する（[孤立PVの判定](#孤立pvの判定)）。
- コンソールのディープリンク（実装は[console-url.ts](../src/renderer/match/console-url.ts)）は、種別ごとに遷移の確認状況が異なる。
  - 実機で遷移確認済み: cluster / instance / NLB / classic LB / volume / FSS / subnet / SL / RT / WAF / FSSスナップショットポリシー / DNSゾーン
  - 同構造からの類推で未確認: NSG・WAFポリシー単体・Volumeバックアップポリシー・VCN本体・ゲートウェイ5種（IGW / NAT / SGW / LPG / DRG）

## 将来的実装（スコープ外として合意済み）

- 疎通可否の自動判定（SL/NSGのegress・RT・statelessを通した経路シミュレーション。Topologyの通信許可エッジはingressルールを図へ写すだけで、通る／通らないの結論までは出さない）
- Topology図のファイル保存（クリップボードへのMermaid / SVG / PNGコピーは実装済み）
- Topology図のノード位置の手動編集・保存（レイアウトは常に自動）
- テナンシ全体ビュー・メトリクス・コスト表示（別プラグインの領分）
- OCIリソースの操作（本プラグインは閲覧専用を維持する）
