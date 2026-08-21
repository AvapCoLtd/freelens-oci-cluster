# oci CLI 実出力フィクスチャ

実機採取した `oci` CLI の出力。CLI 実行層とエラー分類の単体テストが参照する。

拡張のレスポンス型（[oci/types.ts](../../oci/types.ts)）はこのフィクスチャを正として書かれており、
各インターフェースのコメントが対応ファイルを指す。フィールドを増やすときはここで実在キーを確認する。

- 採取日: 2026-07-30(#1〜#20)、2026-08-04(#21〜#28 の list 系)、2026-08-20(#29〜#31)
- 採取環境: `oci` CLI 3.90.0(Oracle-PythonSDK/2.183.0)、region `ap-tokyo-1`、OKE 1.31 クラスタ
  (#29 のみ同テナンシの別 VCN。OKE クラスタ配下でないため VCN 単体の応答形だけを採っている。
  #30 は同テナンシの FSS export。#31 と `err-volume-not-found.json` のみ `oci` CLI 3.90.3
  (Oracle-PythonSDK/2.184.2)で採取)
- 全コマンドに `--output json` を付与。list 系は `--all`、`search resource structured-search` のみ手動ページング
- 実行はすべて読み取り操作(get / list / search)

## ディレクトリ

| パス | 内容 |
|---|---|
| `stdout/` | 成功時の stdout をそのまま(サニタイズのみ)置いたもの。ファイル内容 = `oci` の JSON |
| `outcome/` | stdout だけでは表せないケース。`{"command", "exit-code", "stdout", "stderr"}` のラッパ JSON |

`outcome/` のキーは CLI 出力と同じ kebab-case に揃えている。`command` は `oci` に渡した引数列
(先頭の実行ファイル名と `--output json` は含む場合と含まない場合がある。採取時のコマンドラインをそのまま記録)。

## 観察結果(解釈層が依存する事実)

### キー表記

- **すべて kebab-case**(`lifecycle-state` / `display-name` / `compartment-id`)。
  OCI SDK の同名モデルは camelCase だが、CLI の出力は別系統
- **`defined-tags` / `freeform-tags` / `system-tags` の中身のキーは kebab-case ではない**。
  タグ名前空間・タグキーは Oracle が付けた表記そのままで出る
  (例: `"defined-tags": {"Oracle-Tags": {"CreatedBy": …, "CreatedOn": …}}`、
  `"system-tags": {"orcl-containerengine": {"Cluster": …, "NodePool": …, "NodeType": …}}`)。
  アンカー解決は `defined-tags["Oracle-Tags"].CreatedBy` を読む
- LB の `listeners` / `backend-sets` / `certificates` は「名前をキーにしたオブジェクト」で、
  そのキー(リスナー名・バックエンドセット名)も無変換

### トップレベル構造

| 種別 | トップレベル | 例 |
|---|---|---|
| get 系 | `{"data": {…}, "etag": "…"}` | `stdout/02-ce-cluster-get.json` |
| get 系(一部) | `{"data": {…}}`(`etag` なし) | `stdout/20a-lb-backend-set-health-get.json`(LB の backend health のみ。NLB 版には `etag` がある) |
| list 系(配列直返し) | `{"data": [ … ]}` | `stdout/03-compute-instance-list.json`、`stdout/06-lb-load-balancer-list.json`、`stdout/07-bv-volume-list.json`、`stdout/09-ce-node-pool-list.json`、`stdout/14b-network-nsg-rules-list.json`、`stdout/16b-…`、`stdout/21-…`〜`stdout/28-…` |
| list 系(コレクション包み) | `{"data": {"items": [ … ]}}` | `stdout/05-nlb-network-load-balancer-list.json`、`stdout/10-waf-web-app-firewall-list.json`、`stdout/04-search-structured-search.json` |

- **`opc-next-page` はトップレベルに出る**(`data` の中ではない)。
  `{"data": …, "opc-next-page": "…"}`。最終ページではキー自体が存在しない
  → `stdout/04-search-structured-search-page1.json`(次ページあり)、`…-page2.json`(次ページあり)、
  `…-page3-last.json`(キーなし)
- `--all` を付けた list では `opc-next-page` は出ない(CLI が内部で全ページ取得して結合する)
- **`--all` を付けずにページが残っている list は exit 0 のまま stderr に WARNING を出す**
  → `outcome/warn-list-without-all-paginated.json`。
  「stderr が空でない = 失敗」と判定してはいけない
- **`search resource structured-search` には `--all` がない**(`--limit` / `--page` のみ)。手動ページング必須
- 空 list は `{"data": {"items": []}}` のように空配列で返る → `stdout/10-waf-web-app-firewall-list-empty.json`
- **結果が無いとき stdout が完全に空(0 バイト)になるコマンドがある**
  → `outcome/16a-bv-backup-policy-assignment-unassigned.json`(exit 0 / stdout 空 / stderr 空)。
  JSON パーサに素で渡すと落ちるため、空 stdout を「該当なし」として扱う分岐が必要

### list と get の応答モデルの差

型別 list へ置き換える判断の根拠(2026-08-04 に実テナンシで get と突合)。

| 種別 | list の応答 | 判定 |
|---|---|---|
| subnet / route-table / security-list / nsg / nat-gateway / internet-gateway / service-gateway / local-peering-gateway / drg | get と**キー集合も値も完全一致**(Summary 型が存在しない) | list へ置換 |
| `bv volume-backup-policy` | get と完全一致(`schedules` も持つ) | list へ置換 |
| `fs filesystem-snapshot-policy` | Summary。`schedules` が無く `policy-prefix` の値も get と異なる。表示に使う `display-name` は持つ | list へ置換 |
| `fs file-system` | Summary。**`filesystem-snapshot-policy-id` が無い**(ポリシー割当済みの FS でも出ない) | get 維持 |
| `bv volume` | get と**キー集合も値も完全一致**(get は `etag` を伴う) | list 維持。get は存在確認専用(#31) |

`network drg list` に `--vcn-id` は無い(compartment 単位)。
`fs` 系 list は `--compartment-id` と `--availability-domain` の両方が必須。

### エラー出力

| 事象 | exit code | stdout | stderr |
|---|---|---|---|
| API エラー(認証・権限・不在・リクエスト不正) | 1 | 空 | `ServiceError:` + 改行 + 4 スペースインデントの JSON |
| 認証情報の不備(config 不在) | 1 | `ERROR: Could not find config file at …` + 対話プロンプト | `Abort:` |
| 認証情報の不備(profile 不在) | 1 | 空 | `ERROR: Profile '…' not found in config file …` |
| 認証情報の不備(key_file 不在) | 1 | 空 | Python の Traceback 全文(`FileNotFoundError`) |
| 必須オプション欠落 | 1 | 空 | `Usage: …` + `Error: Missing option(s) …` |
| 未知のサブコマンド / 未知のオプション | **2** | **`Usage: …` + `Error: …`(stdout 側)** | 空 |

- `ServiceError:` の JSON は `code` / `message` / `status` / `operation_name` / `target_service` /
  `opc-request-id` / `request_endpoint` / `timestamp` / `client_version` を持つ。
  この JSON のキーは **snake_case**(CLI の data 側 kebab-case とは別系統)
- **stderr は `ServiceError:` で始まるとは限らない**。API キーのパーミッション警告等が前置される
  → `outcome/err-not-authenticated.json` は `Warning: To increase security of your API key …` の後に `ServiceError:` が続く
- 認証系の識別に使える `code` / `status`:
  - `NotAuthenticated` / 401 … 認証失効・認証情報不正(ポーリング停止対象)
  - `NotAuthorizedOrNotFound` / 404 … 権限不足とリソース不在が**同一コードに合流する**。
    OCI は権限不足を 403 ではなく 404 で返すため、両者を stderr から区別できない
  - `CannotParseRequest` / 400 … リクエスト不正(検索クエリの誤り等)
- 対話プロンプト(`Do you want to create a new config file? [Y/n]:`)が出る経路があるため、
  子プロセスの stdin は必ず閉じる(`/dev/null`)。閉じていれば EOF で `Abort:` して即終了する

## コマンド → ファイル対応(全 44 コマンド)

`#` は [fetch.ts](../../fetch/fetch.ts) / [anchor.ts](../../fetch/anchor.ts) のコメント番号。
OCID は下記サニタイズ済みのダミー値で表記している。

| # | oci サブコマンド | ファイル | exit |
|---|---|---|---|
| 1a | `compute instance get --instance-id …` | `stdout/01a-compute-instance-get.json` | 0 |
| 1b | `ce node-pool get --node-pool-id …` | `stdout/01b-ce-node-pool-get.json` | 0 |
| 2 | `ce cluster get --cluster-id …` | `stdout/02-ce-cluster-get.json` | 0 |
| 3 | `compute instance list --compartment-id … --all` | `stdout/03-compute-instance-list.json` | 0 |
| 4 | `search resource structured-search --query-text "query all resources where (definedTags.namespace = 'Oracle-Tags' && definedTags.key = 'CreatedBy' && definedTags.value = '<cluster ocid>')"` | `stdout/04-search-structured-search.json` | 0 |
| 4 | 同上 + `--limit 3` | `stdout/04-search-structured-search-page1.json` | 0 |
| 4 | 同上 + `--limit 3 --page <token>` | `stdout/04-search-structured-search-page2.json` | 0 |
| 4 | 同上 + `--limit 3 --page <token>`(最終ページ) | `stdout/04-search-structured-search-page3-last.json` | 0 |
| 5 | `nlb network-load-balancer list --compartment-id … --all` | `stdout/05-nlb-network-load-balancer-list.json` | 0 |
| 6 | `lb load-balancer list --compartment-id … --all` | `stdout/06-lb-load-balancer-list.json` | 0 |
| 6 | 同上(listener に `ssl-configuration.certificate-ids` がある LB) | `stdout/06-lb-load-balancer-list-with-ssl.json` | 0 |
| 7 | `bv volume list --compartment-id … --all` | `stdout/07-bv-volume-list.json` | 0 |
| 8 | `fs file-system get --file-system-id …` | `stdout/08-fs-file-system-get.json` | 0 |
| 9 | `ce node-pool list --compartment-id … --cluster-id … --all` | `stdout/09-ce-node-pool-list.json` | 0 |
| 10 | `waf web-app-firewall list --compartment-id … --all` | `stdout/10-waf-web-app-firewall-list.json` | 0 |
| 10 | 同上(WAF 不在 compartment。空 list) | `stdout/10-waf-web-app-firewall-list-empty.json` | 0 |
| 11 | `network subnet get --subnet-id …` | `stdout/11-network-subnet-get.json` | 0 |
| 12 | `network security-list get --security-list-id …` | `stdout/12-network-security-list-get.json` | 0 |
| 13 | `network route-table get --rt-id …` | `stdout/13-network-route-table-get.json` | 0 |
| 14a | `network nsg get --nsg-id …` | `stdout/14a-network-nsg-get.json` | 0 |
| 14b | `network nsg rules list --nsg-id … --all` | `stdout/14b-network-nsg-rules-list.json` | 0 |
| 15 | `waf web-app-firewall-policy get --web-app-firewall-policy-id …` | `stdout/15-waf-web-app-firewall-policy-get.json` | 0 |
| 16a | `bv volume-backup-policy-assignment get-volume-backup-policy-asset-assignment --asset-id …` | `outcome/16a-bv-backup-policy-assignment-unassigned.json` | 0 |
| 16b | `bv volume-backup-policy get --policy-id …` | `stdout/16b-bv-volume-backup-policy-get.json` | 0 |
| 17 | `fs filesystem-snapshot-policy get --filesystem-snapshot-policy-id …` | `stdout/17-fs-filesystem-snapshot-policy-get.json` | 0 |
| 18 | `certs-mgmt certificate get --certificate-id …` | `stdout/18-certs-mgmt-certificate-get.json` | 0 |
| 19a | `network nat-gateway get --nat-gateway-id …` | `stdout/19a-network-nat-gateway-get.json` | 0 |
| 19b | `network internet-gateway get --ig-id …` | `stdout/19b-network-internet-gateway-get.json` | 0 |
| 19c | `network service-gateway get --service-gateway-id …` | `stdout/19c-network-service-gateway-get.json` | 0 |
| 19d | `network local-peering-gateway get --local-peering-gateway-id …` | `stdout/19d-network-local-peering-gateway-get.json` | 0 |
| 19e | `network drg get --drg-id …` | `stdout/19e-network-drg-get.json` | 0 |
| 20a | `lb backend-set-health get --load-balancer-id … --backend-set-name TCP-443` | `stdout/20a-lb-backend-set-health-get.json` | 0 |
| 20b | `nlb backend-set-health get --network-load-balancer-id … --backend-set-name TCP-443` | `stdout/20b-nlb-backend-set-health-get.json` | 0 |
| 21 | `network subnet list --compartment-id … --vcn-id … --all` | `stdout/21-network-subnet-list.json` | 0 |
| 22 | `network route-table list --compartment-id … --vcn-id … --all` | `stdout/22-network-route-table-list.json` | 0 |
| 23 | `network security-list list --compartment-id … --vcn-id … --all` | `stdout/23-network-security-list-list.json` | 0 |
| 24 | `network nsg list --compartment-id … --vcn-id … --all` | `stdout/24-network-nsg-list.json` | 0 |
| 25a | `network nat-gateway list --compartment-id … --vcn-id … --all` | `stdout/25a-network-nat-gateway-list.json` | 0 |
| 25b | `network internet-gateway list --compartment-id … --vcn-id … --all` | `stdout/25b-network-internet-gateway-list.json` | 0 |
| 25c | `network service-gateway list --compartment-id … --vcn-id … --all` | `stdout/25c-network-service-gateway-list.json` | 0 |
| 25d | `network local-peering-gateway list --compartment-id … --vcn-id … --all` | `stdout/25d-network-local-peering-gateway-list.json` | 0 |
| 25e | `network drg list --compartment-id … --all` | `stdout/25e-network-drg-list.json` | 0 |
| 26 | `iam availability-domain list --compartment-id … --all` | `stdout/26-iam-availability-domain-list.json` | 0 |
| 27 | `fs filesystem-snapshot-policy list --compartment-id … --availability-domain … --all` | `stdout/27-fs-filesystem-snapshot-policy-list.json` | 0 |
| 28 | `bv volume-backup-policy list --all`(compartment 無指定) | `stdout/28-bv-volume-backup-policy-list.json` | 0 |
| 29 | `network vcn get --vcn-id …` | `stdout/29-network-vcn-get.json` | 0 |
| 30 | `fs export get --export-id …` | `stdout/30-fs-export-get.json` | 0 |
| 31 | `bv volume get --volume-id …` | `stdout/31-bv-volume-get.json` | 0 |
| 32 | `dns zone list --compartment-id … --scope GLOBAL --all` | (未採取) | - |

## エラー・警告フィクスチャ

| ファイル | 再現方法 | exit |
|---|---|---|
| `outcome/warn-list-without-all-paginated.json` | `compute instance list --compartment-id … --limit 2`(`--all` なし) | 0 |
| `outcome/err-not-authorized-or-not-found.json` | 削除済みインスタンスの OCID で `compute instance get` | 1 |
| `outcome/err-not-authorized-or-not-found-malformed-ocid.json` | `compute instance get --instance-id not-an-ocid` | 1 |
| `outcome/err-volume-not-found.json` | パージ済み Block Volume の OCID で `bv volume get`(孤立 PV 判定の追撃が読む応答) | 1 |
| `outcome/err-cannot-parse-request.json` | `search resource structured-search --query-text "query cluster resources"`(不正な resource type) | 1 |
| `outcome/err-not-authenticated.json` | 実在しない user/tenancy と自己生成の使い捨て鍵を書いた config で `compute instance list` | 1 |
| `outcome/err-config-file-missing.json` | 存在しない `OCI_CLI_CONFIG_FILE` を指定 | 1 |
| `outcome/err-profile-not-found.json` | `--profile NOSUCHPROFILE` | 1 |
| `outcome/err-key-file-missing.json` | config の `key_file` が存在しないパス | 1 |
| `outcome/err-missing-required-option.json` | `compute instance get`(`--instance-id` なし) | 1 |
| `outcome/err-unknown-subcommand.json` | `compute bogus-subcommand` | 2 |
| `outcome/err-unknown-option.json` | `compute instance get --bogus-flag x` | 2 |

## 採取不能・未採取

| 対象 | 状況 |
|---|---|
| `bv volume-backup-policy-assignment get-…-asset-assignment` の**割当あり**応答 | テナンシ内の block volume / boot volume を全件走査したが、バックアップポリシーが割り当てられたボリュームが 1 本も存在せず採取できなかった。割当なし(stdout 空)のみ採取済み |
| classic LB の `certificates`(`public-certificate` の PEM) | テナンシ内の全 LB で `"certificates": {}`。PEM をパースする [lb-certificates.ts](../../match/lb-certificates.ts) の入力は実機採取できていない。`certificate-ids`(Certificates サービス方式)は `stdout/06-lb-load-balancer-list-with-ssl.json` で採取済み |
| 権限不足(403 `NotAuthorized`) | OCI は権限不足も 404 `NotAuthorizedOrNotFound` で返すため、403 を意図的に発生させられなかった。実装上は 404 側で扱う |
| `oci` コマンド自体の起動失敗(ENOENT 等) | CLI の出力ではなく `execFile` の失敗であり、フィクスチャの対象外 |
| タイムアウト / stdout サイズ超過 | 実行機側の挙動であり、フィクスチャの対象外 |
| #32 `dns zone list --scope GLOBAL --all` の応答 | 実機未採取。OciDnsZone の id / name / lifecycle-state は API 仕様からの推測 |

## サニタイズ

内容は実出力だが、**識別可能な値はすべて置換済み**。キー表記・構造・型・JSON 整形
(2 スペースインデント・キーのアルファベット順)は `oci` の出力そのままで、
再シリアライズが元の生出力とバイト一致することを確認している。

| 種類 | 置換規則 | 件数 |
|---|---|---|
| OCID | `ocid1.<type>.<realm>.<region>.` を保ったまま unique 部を `aaaaexample<NNNN>` に。同一 OCID は同一ダミーへ一貫置換。type/realm/region セグメントは無変換(FSS の `ap_tokyo_1` 表記も維持) | 71 |
| UUID | `00000000-0000-4000-8000-<連番>` へ一貫置換 | 9 |
| IPv4 | private: `10.x.y.z`→`10.0.y.z` / `192.168.y.z`→`10.9.y.z` / `172.16-31.y.z`→`10.8.y.z`(CIDR の包含関係は保存)。public: `203.0.113.<n>`。`0.0.0.0` `255.255.255.255` `127.0.0.1` `169.254.169.254` は無変換 | 67(うち public 41) |
| IPv6 | RFC 3849 のドキュメント用プレフィクス `2001:db8::/32` 配下へ。プレフィクス長は維持 | 1 |
| 表示名・ホスト名・メールアドレス | テナンシ名・顧客名・人名・ドメインを汎用名へ(`example` / `client-a` / `app-a` / `example.com` 等)。命名の形は維持 | 全件 |
| MAC アドレス | `00:00:17:00:00:01` | 全件 |
| availability domain | プレフィクスを `Abcd:` に(`Abcd:AP-TOKYO-1-AD-1`) | 全件 |
| `metadata` / `node-metadata`(instance・node pool の launch metadata) | **キー名は維持し、値を `<redacted>` に**。`user_data` / `bootstrap-kubelet-conf` / `oke_init_script` / `ssh_authorized_keys` 等にブートストラップ資材が入るため。cluster get の `metadata`(ClusterMetadata)は監査情報なので値も維持 | 全件 |
| `ssh-public-key` | ダミー公開鍵文字列 | 全件 |
| `etag` / `opc-request-id` / `opc-next-page` | 固定のダミー値 | 全件 |
| ファイルパス(エラー出力内) | `/home/user/…` に統一 | 全件 |
