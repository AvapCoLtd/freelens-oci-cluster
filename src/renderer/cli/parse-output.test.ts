import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type OciCommandDef, ociCommands } from "./command-defs";
import { OciStdoutShapeError, parseOciStdout } from "./parse-output";

const FIXTURE_DIR = join(import.meta.dirname, "__fixtures__");
const STDOUT_DIR = join(FIXTURE_DIR, "stdout");

function readStdout(file: string): string {
  return readFileSync(join(STDOUT_DIR, file), "utf8");
}

/** outcome/は`{"command","exit-code","stdout","stderr"}`のラッパJSON。 */
function readOutcomeStdout(file: string): string {
  const outcome = JSON.parse(readFileSync(join(FIXTURE_DIR, "outcome", file), "utf8")) as { stdout: string };
  return outcome.stdout;
}

function parse<Params, Result>(
  def: OciCommandDef<Params, Result>,
  stdout: string,
): { data: Result; nextPage?: string } {
  const parsed = parseOciStdout(stdout, def.output);
  return { data: def.decode(parsed.value), nextPage: parsed.nextPage };
}

function parseFixture<Params, Result>(
  def: OciCommandDef<Params, Result>,
  file: string,
): { data: Result; nextPage?: string } {
  return parse(def, readStdout(file));
}

/** stdout/の全ファイルと、それを解釈するコマンド定義の対応。 */
const FIXTURE_DEFS: { file: string; def: OciCommandDef<never, unknown> }[] = [
  { file: "01a-compute-instance-get.json", def: ociCommands.instanceGet },
  { file: "01b-ce-node-pool-get.json", def: ociCommands.nodePoolGet },
  { file: "02-ce-cluster-get.json", def: ociCommands.clusterGet },
  { file: "03-compute-instance-list.json", def: ociCommands.instanceList },
  { file: "04-search-structured-search.json", def: ociCommands.taggedResourceSearch },
  { file: "04-search-structured-search-page1.json", def: ociCommands.taggedResourceSearch },
  { file: "04-search-structured-search-page2.json", def: ociCommands.taggedResourceSearch },
  { file: "04-search-structured-search-page3-last.json", def: ociCommands.taggedResourceSearch },
  { file: "05-nlb-network-load-balancer-list.json", def: ociCommands.nlbList },
  { file: "06-lb-load-balancer-list.json", def: ociCommands.lbList },
  { file: "06-lb-load-balancer-list-with-ssl.json", def: ociCommands.lbList },
  { file: "07-bv-volume-list.json", def: ociCommands.volumeList },
  { file: "08-fs-file-system-get.json", def: ociCommands.fileSystemGet },
  { file: "09-ce-node-pool-list.json", def: ociCommands.nodePoolList },
  { file: "10-waf-web-app-firewall-list.json", def: ociCommands.wafList },
  { file: "10-waf-web-app-firewall-list-empty.json", def: ociCommands.wafList },
  { file: "11-network-subnet-get.json", def: ociCommands.subnetGet },
  { file: "12-network-security-list-get.json", def: ociCommands.securityListGet },
  { file: "13-network-route-table-get.json", def: ociCommands.routeTableGet },
  { file: "14a-network-nsg-get.json", def: ociCommands.nsgGet },
  { file: "14b-network-nsg-rules-list.json", def: ociCommands.nsgRulesList },
  { file: "15-waf-web-app-firewall-policy-get.json", def: ociCommands.wafPolicyGet },
  { file: "16b-bv-volume-backup-policy-get.json", def: ociCommands.volumeBackupPolicyGet },
  { file: "17-fs-filesystem-snapshot-policy-get.json", def: ociCommands.fssSnapshotPolicyGet },
  { file: "18-certs-mgmt-certificate-get.json", def: ociCommands.managedCertificateGet },
  { file: "19a-network-nat-gateway-get.json", def: ociCommands.natGatewayGet },
  { file: "19b-network-internet-gateway-get.json", def: ociCommands.internetGatewayGet },
  { file: "19c-network-service-gateway-get.json", def: ociCommands.serviceGatewayGet },
  { file: "19d-network-local-peering-gateway-get.json", def: ociCommands.localPeeringGatewayGet },
  { file: "19e-network-drg-get.json", def: ociCommands.drgGet },
  { file: "20a-lb-backend-set-health-get.json", def: ociCommands.lbBackendSetHealthGet },
  { file: "20b-nlb-backend-set-health-get.json", def: ociCommands.nlbBackendSetHealthGet },
];

/** フィクスチャの`data`(collectionは要素配列)をそのまま取り出したもの。 */
function rawData(file: string, output: OciCommandDef<never, unknown>["output"]): unknown {
  const root = JSON.parse(readStdout(file)) as { data: unknown };
  if (output === "single") return root.data;
  if (Array.isArray(root.data)) return root.data;
  return (root.data as { items: unknown[] }).items;
}

describe("parseOciStdout(フィクスチャ)", () => {
  it("stdout/の全ファイルにコマンド定義が対応している", () => {
    expect(new Set(FIXTURE_DEFS.map((entry) => entry.file))).toEqual(new Set(readdirSync(STDOUT_DIR)));
  });

  it.each(FIXTURE_DEFS)("$file はキーも値も無変換で通る", ({ file, def }) => {
    expect(parseOciStdout(readStdout(file), def.output).value).toEqual(rawData(file, def.output));
  });

  it("#1a compute instance get", () => {
    const { data } = parseFixture(ociCommands.instanceGet, "01a-compute-instance-get.json");
    expect(data.id).toBe("ocid1.instance.oc1.ap-tokyo-1.aaaaexample0001");
    expect(data["lifecycle-state"]).toBe("RUNNING");
    expect(data["availability-domain"]).toBe("Abcd:AP-TOKYO-1-AD-1");
    expect(data["display-name"]).toBe("oke-cexample01-nexample01-sexample01-0");
    // アンカー解決が読む位置。タグ名前空間・タグキーはOracleが付けた表記のまま。
    expect(data["defined-tags"]?.["Oracle-Tags"]?.CreatedBy).toBe("ocid1.nodepool.oc1.ap-tokyo-1.aaaaexample0001");
  });

  it("#1b ce node-pool get", () => {
    const { data } = parseFixture(ociCommands.nodePoolGet, "01b-ce-node-pool-get.json");
    expect(data["cluster-id"]).toBe("ocid1.cluster.oc1.ap-tokyo-1.aaaaexample0001");
    expect(data["compartment-id"]).toBe("ocid1.compartment.oc1..aaaaexample0001");
  });

  it("#2 ce cluster get", () => {
    const { data } = parseFixture(ociCommands.clusterGet, "02-ce-cluster-get.json");
    expect(data.name).toBe("example-k8s-cluster");
    expect(data["kubernetes-version"]).toBe("v1.31.1");
    expect(data["endpoint-config"]?.["subnet-id"]).toBe("ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0002");
    expect(data["endpoint-config"]?.["nsg-ids"]).toEqual([]);
  });

  it("#3 compute instance list(配列直返し)", () => {
    const { data, nextPage } = parseFixture(ociCommands.instanceList, "03-compute-instance-list.json");
    expect(data).toHaveLength(3);
    expect(data.map((instance) => instance["display-name"])).toEqual([
      "oke-cexample01-nexample01-sexample01-0",
      "oke-cexample01-nexample01-sexample01-3",
      "oke-cexample01-nexample01-sexample01-5",
    ]);
    expect(nextPage).toBeUndefined();
  });

  it("#4 search resource structured-search(コレクション包み)", () => {
    const { data, nextPage } = parseFixture(ociCommands.taggedResourceSearch, "04-search-structured-search.json");
    expect(data).toHaveLength(8);
    expect(data[0]?.identifier).toBe("ocid1.publicip.oc1.ap-tokyo-1.aaaaexample0001");
    expect(data[0]?.["compartment-id"]).toBe("ocid1.compartment.oc1..aaaaexample0001");
    expect(nextPage).toBeUndefined();
  });

  it("#4 opc-next-pageはトップレベルから読み、最終ページではundefined", () => {
    expect(parseFixture(ociCommands.taggedResourceSearch, "04-search-structured-search-page1.json").nextPage).toBe(
      "EXAMPLEPAGETOKEN0001",
    );
    expect(parseFixture(ociCommands.taggedResourceSearch, "04-search-structured-search-page2.json").nextPage).toBe(
      "EXAMPLEPAGETOKEN0002",
    );
    const last = parseFixture(ociCommands.taggedResourceSearch, "04-search-structured-search-page3-last.json");
    expect(last.nextPage).toBeUndefined();
    expect(last.data).toHaveLength(2);
  });

  it("#5 nlb list(listeners/backend-setsは名前がキー)", () => {
    const { data } = parseFixture(ociCommands.nlbList, "05-nlb-network-load-balancer-list.json");
    expect(data).toHaveLength(3);
    const nlb = data[0];
    expect(nlb?.["display-name"]).toBe("app-a/app-a-svc/00000000-0000-4000-8000-000000000001");
    expect(nlb?.["ip-addresses"]?.[0]?.["ip-address"]).toBe("203.0.113.1");
    expect(nlb?.["is-private"]).toBe(false);
    expect(nlb?.["subnet-id"]).toBe("ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0003");
    expect(Object.keys(nlb?.listeners ?? {})).toEqual(["TCP-443"]);
    expect(nlb?.listeners?.["TCP-443"]?.port).toBe(443);
    expect(Object.keys(nlb?.["backend-sets"] ?? {})).toEqual(["TCP-443"]);
    expect(nlb?.["backend-sets"]?.["TCP-443"]?.backends?.[0]?.["ip-address"]).toBe("10.0.10.83");
  });

  it("#6 lb list", () => {
    const { data } = parseFixture(ociCommands.lbList, "06-lb-load-balancer-list.json");
    expect(data).toHaveLength(2);
    const lb = data[0];
    expect(lb?.["display-name"]).toBe("00000000-0000-4000-8000-000000000006");
    expect(lb?.["ip-addresses"]?.[0]?.["ip-address"]).toBe("203.0.113.4");
    expect(lb?.["subnet-ids"]).toEqual(["ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0004"]);
    expect(Object.keys(lb?.listeners ?? {})).toEqual(["TCP-443", "TCP-80"]);
    expect(lb?.["backend-sets"]?.["TCP-443"]?.backends?.[0]?.["ip-address"]).toBe("10.0.11.23");
    expect(lb?.certificates).toEqual({});
  });

  it("#6 lb list(listenerのcertificate-ids方式)", () => {
    const { data } = parseFixture(ociCommands.lbList, "06-lb-load-balancer-list-with-ssl.json");
    const lb = data[0];
    expect(lb?.listeners?.["https-dev_client-b"]?.["ssl-configuration"]?.["certificate-ids"]).toEqual([
      "ocid1.certificate.oc1.ap-tokyo-1.aaaaexample0001",
    ]);
  });

  it("#7 bv volume list", () => {
    const { data } = parseFixture(ociCommands.volumeList, "07-bv-volume-list.json");
    expect(data).toHaveLength(4);
    expect(data[0]?.["display-name"]).toBe("csi-00000000-0000-4000-8000-000000000005");
    expect(data[0]?.["size-in-gbs"]).toBe(50);
  });

  it("#8 fs file-system get", () => {
    const { data } = parseFixture(ociCommands.fileSystemGet, "08-fs-file-system-get.json");
    expect(data["display-name"]).toBe("example-website-fss");
    expect(data["filesystem-snapshot-policy-id"]).toBe("ocid1.filesystemsnapshotpolicy.oc1.ap_tokyo_1.aaaaexample0001");
  });

  it("#9 ce node-pool list", () => {
    const { data } = parseFixture(ociCommands.nodePoolList, "09-ce-node-pool-list.json");
    expect(data).toHaveLength(1);
    expect(data[0]?.name).toBe("example-k8s-pool");
    expect(data[0]?.["node-shape"]).toBe("VM.Standard.E3.Flex");
    expect(data[0]?.["node-config-details"]?.size).toBe(3);
    expect(data[0]?.["node-config-details"]?.["nsg-ids"]).toEqual([]);
    expect(data[0]?.["node-config-details"]?.["placement-configs"]?.[0]?.["subnet-id"]).toBe(
      "ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0001",
    );
    expect(data[0]?.["subnet-ids"]).toEqual(["ocid1.subnet.oc1.ap-tokyo-1.aaaaexample0001"]);
  });

  it("#10 waf web-app-firewall list", () => {
    const { data } = parseFixture(ociCommands.wafList, "10-waf-web-app-firewall-list.json");
    expect(data).toHaveLength(2);
    expect(data[0]?.["display-name"]).toBe("client-a-staging-waf");
    expect(data[0]?.["web-app-firewall-policy-id"]).toBe("ocid1.webappfirewallpolicy.oc1.ap-tokyo-1.aaaaexample0001");
    expect(data[0]?.["load-balancer-id"]).toBe("ocid1.loadbalancer.oc1.ap-tokyo-1.aaaaexample0003");
  });

  it("#10 空listは空配列", () => {
    const { data } = parseFixture(ociCommands.wafList, "10-waf-web-app-firewall-list-empty.json");
    expect(data).toEqual([]);
  });

  it("#11 network subnet get", () => {
    const { data } = parseFixture(ociCommands.subnetGet, "11-network-subnet-get.json");
    expect(data["display-name"]).toBe("example-k8s-node-subnet");
    expect(data["cidr-block"]).toBe("10.0.10.80/28");
    expect(data["prohibit-public-ip-on-vnic"]).toBe(true);
    expect(data["security-list-ids"]).toEqual(["ocid1.securitylist.oc1.ap-tokyo-1.aaaaexample0001"]);
    expect(data["route-table-id"]).toBe("ocid1.routetable.oc1.ap-tokyo-1.aaaaexample0001");
    expect(data["vcn-id"]).toBe("ocid1.vcn.oc1.ap-tokyo-1.aaaaexample0001");
  });

  it("#12 network security-list get", () => {
    const { data } = parseFixture(ociCommands.securityListGet, "12-network-security-list-get.json");
    expect(data["display-name"]).toBe("securitylist20240712190211");
    expect(data["ingress-security-rules"]?.[0]?.source).toBe("10.0.10.96/28");
    expect(data["ingress-security-rules"]?.[0]?.["is-stateless"]).toBe(false);
    expect(data["egress-security-rules"]?.[0]?.destination).toBe("0.0.0.0/0");
  });

  it("#13 network route-table get", () => {
    const { data } = parseFixture(ociCommands.routeTableGet, "13-network-route-table-get.json");
    expect(data["route-rules"]).toHaveLength(3);
    expect(data["route-rules"]?.[0]?.["network-entity-id"]).toBe("ocid1.natgateway.oc1.ap-tokyo-1.aaaaexample0001");
    expect(data["route-rules"]?.[0]?.destination).toBe("0.0.0.0/0");
  });

  it("#14a network nsg get", () => {
    const { data } = parseFixture(ociCommands.nsgGet, "14a-network-nsg-get.json");
    expect(data["display-name"]).toBe("public-ssh-nsg");
    expect(data["vcn-id"]).toBe("ocid1.vcn.oc1.ap-tokyo-1.aaaaexample0001");
  });

  it("#14b network nsg rules list", () => {
    const { data } = parseFixture(ociCommands.nsgRulesList, "14b-network-nsg-rules-list.json");
    expect(data).toHaveLength(1);
    expect(data[0]?.direction).toBe("INGRESS");
    expect(data[0]?.["is-stateless"]).toBe(false);
    expect(data[0]?.["tcp-options"]?.["destination-port-range"]?.max).toBe(22);
  });

  it("#15 waf web-app-firewall-policy get", () => {
    const { data } = parseFixture(ociCommands.wafPolicyGet, "15-waf-web-app-firewall-policy-get.json");
    expect(data["request-access-control"]?.["default-action-name"]).toBe("ALLOW");
    expect(data["request-access-control"]?.rules?.[0]?.["action-name"]).toBe("ALLOW");
    expect(data.actions?.map((action) => action.name)).toEqual(["CHECK", "ALLOW", "BLOCK", "TEMPORARY_BLOCK"]);
    expect(data["request-protection"]?.rules?.[0]?.["protection-capabilities"]?.[0]?.key).toBe("941380");
    expect(data["request-rate-limiting"]?.rules?.[0]?.configurations?.[0]?.["requests-limit"]).toBe(1200);
  });

  it("#16b bv volume-backup-policy get", () => {
    const { data } = parseFixture(ociCommands.volumeBackupPolicyGet, "16b-bv-volume-backup-policy-get.json");
    expect(data["display-name"]).toBe("silver");
  });

  it("#17 fs filesystem-snapshot-policy get", () => {
    const { data } = parseFixture(ociCommands.fssSnapshotPolicyGet, "17-fs-filesystem-snapshot-policy-get.json");
    expect(data["display-name"]).toBe("example-website-fss-snapshot-policy");
  });

  it("#18 certs-mgmt certificate get", () => {
    const { data } = parseFixture(ociCommands.managedCertificateGet, "18-certs-mgmt-certificate-get.json");
    expect(data.name).toBe("example.com");
    expect(data["current-version"]?.validity?.["time-of-validity-not-after"]).toBe("2024-06-15T23:59:59+00:00");
  });

  it("#19 gateway get(5種)", () => {
    const nat = parseFixture(ociCommands.natGatewayGet, "19a-network-nat-gateway-get.json").data;
    expect(nat["display-name"]).toBe("example_prod-nat_gateway");
    expect(nat["block-traffic"]).toBe(false);

    const igw = parseFixture(ociCommands.internetGatewayGet, "19b-network-internet-gateway-get.json").data;
    expect(igw["is-enabled"]).toBe(true);
    expect(igw["lifecycle-state"]).toBe("AVAILABLE");

    const sgw = parseFixture(ociCommands.serviceGatewayGet, "19c-network-service-gateway-get.json").data;
    expect(sgw["block-traffic"]).toBe(false);

    const lpg = parseFixture(ociCommands.localPeeringGatewayGet, "19d-network-local-peering-gateway-get.json").data;
    expect(lpg["peering-status"]).toBe("PEERED");

    const drg = parseFixture(ociCommands.drgGet, "19e-network-drg-get.json").data;
    expect(drg["display-name"]).toBe("example_office_vpn-drg");
  });

  it("#20a lb backend-set-health get(etagなし)", () => {
    const { data } = parseFixture(ociCommands.lbBackendSetHealthGet, "20a-lb-backend-set-health-get.json");
    expect(data.status).toBe("CRITICAL");
    expect(data["total-backend-count"]).toBe(2);
    expect(data["critical-state-backend-names"]).toEqual(["10.0.11.23:32704", "10.0.11.27:32704"]);
    expect(data["warning-state-backend-names"]).toEqual([]);
  });

  it("#20b nlb backend-set-health get", () => {
    const { data } = parseFixture(ociCommands.nlbBackendSetHealthGet, "20b-nlb-backend-set-health-get.json");
    expect(data.status).toBe("OK");
    expect(data["total-backend-count"]).toBe(3);
    expect(data["unknown-state-backend-names"]).toEqual([]);
  });

  it("#16a 割当なしはstdoutが空でも空結果になる", () => {
    const stdout = readOutcomeStdout("16a-bv-backup-policy-assignment-unassigned.json");
    expect(stdout).toBe("");
    expect(parse(ociCommands.volumeBackupPolicyAssignmentGet, stdout).data).toEqual([]);
  });

  it("--all無しでページが残るlistもトップレベルのopc-next-pageを読める", () => {
    const { data, nextPage } = parse(
      ociCommands.instanceList,
      readOutcomeStdout("warn-list-without-all-paginated.json"),
    );
    expect(data).toHaveLength(2);
    expect(nextPage).toBe("EXAMPLEPAGETOKEN0001");
  });
});

describe("parseOciStdout(異常な出力)", () => {
  const single = ociCommands.subnetGet;
  const collection = ociCommands.instanceList;

  it("JSONでない出力はOciStdoutShapeError(stdoutの抜粋は含まない)", () => {
    expect(() => parseOciStdout("Usage: oci network subnet get", single.output)).toThrow(OciStdoutShapeError);
    expect(() => parseOciStdout("Usage: oci network subnet get", single.output)).not.toThrow(
      /Usage: oci network subnet get/,
    );
  });

  it("dataキーを欠く出力はOciStdoutShapeError", () => {
    expect(() => parseOciStdout('{"items": []}', collection.output)).toThrow(/"data" key/);
  });

  it("dataがオブジェクトでないget系はOciStdoutShapeError", () => {
    expect(() => parseOciStdout('{"data": []}', single.output)).toThrow(/not an object/);
  });

  it("dataが配列でもコレクションでもないlist系はOciStdoutShapeError", () => {
    expect(() => parseOciStdout('{"data": {"count": 0}}', collection.output)).toThrow(
      /neither a list nor a collection/,
    );
  });

  it("get系のstdoutが空の場合はエラー", () => {
    expect(() => parseOciStdout("", single.output)).toThrow(/no output/);
  });
});
