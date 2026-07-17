import { CertificatesManagementClient } from "oci-certificatesmanagement";
import * as common from "oci-common";
import { ContainerEngineClient } from "oci-containerengine";
import { BlockstorageClient, ComputeClient, VirtualNetworkClient } from "oci-core";
import { FileStorageClient } from "oci-filestorage";
import { LoadBalancerClient } from "oci-loadbalancer";
import { NetworkLoadBalancerClient } from "oci-networkloadbalancer";
import { ResourceSearchClient } from "oci-resourcesearch";
import { WafClient } from "oci-waf";
import { NodeHttpClient } from "./node-http-client";

export interface OciClients {
  compute: ComputeClient;
  virtualNetwork: VirtualNetworkClient;
  containerEngine: ContainerEngineClient;
  loadBalancer: LoadBalancerClient;
  networkLoadBalancer: NetworkLoadBalancerClient;
  blockstorage: BlockstorageClient;
  fileStorage: FileStorageClient;
  waf: WafClient;
  resourceSearch: ResourceSearchClient;
  certificatesManagement: CertificatesManagementClient;
}

// SDK既定のリトライは使わない(設計 Decision #15: エラーは即分類してUIに返す)。
const clientConfiguration = {
  retryConfiguration: { terminationStrategy: new common.MaxAttemptsTerminationStrategy(1) },
};

export function createClients(provider: common.AuthenticationDetailsProvider, regionId: string): OciClients {
  // httpClient併用はAuthParams型(RequireOnlyOne)が禁じるが、実行時は両方を受け付ける
  // (client.jsは params.httpClient と params.authenticationDetailsProvider を独立に読む)。
  // CORS回避のためNodeHttpClientが必須(理由はnode-http-client.tsを参照)。
  const params = {
    authenticationDetailsProvider: provider,
    httpClient: new NodeHttpClient(new common.DefaultRequestSigner(provider)),
  } as unknown as common.AuthParams;
  const region = common.Region.fromRegionId(regionId);
  const make = <T extends { region: common.Region }>(client: T): T => {
    client.region = region;
    return client;
  };
  return {
    compute: make(new ComputeClient(params, clientConfiguration)),
    virtualNetwork: make(new VirtualNetworkClient(params, clientConfiguration)),
    containerEngine: make(new ContainerEngineClient(params, clientConfiguration)),
    loadBalancer: make(new LoadBalancerClient(params, clientConfiguration)),
    networkLoadBalancer: make(new NetworkLoadBalancerClient(params, clientConfiguration)),
    blockstorage: make(new BlockstorageClient(params, clientConfiguration)),
    fileStorage: make(new FileStorageClient(params, clientConfiguration)),
    waf: make(new WafClient(params, clientConfiguration)),
    resourceSearch: make(new ResourceSearchClient(params, clientConfiguration)),
    certificatesManagement: make(new CertificatesManagementClient(params, clientConfiguration)),
  };
}
