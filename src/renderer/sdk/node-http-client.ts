import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type * as common from "oci-common";

// bodyなしが必須のステータス(Responseコンストラクタがbody付きを拒否する)
const NO_BODY_STATUS = new Set([204, 205, 304]);

// 同一ホスト(iaas.<region>.oraclecloud.com等)への連続呼び出しが多いためTCP接続を再利用する。
const httpAgent = new HttpAgent({ keepAlive: true });
const httpsAgent = new HttpsAgent({ keepAlive: true });

/**
 * node:https ベースの oci-common HttpClient 実装。
 * 既定の FetchHttpClient はブラウザ fetch を使うため、FreeLens renderer(Chromium)では
 * OCI API への直接呼び出しが CORS で "Failed to fetch" になる(実機で遭遇)。
 * Node のネットワークスタックは CORS の対象外のため、これで置き換える。
 */
export class NodeHttpClient implements common.HttpClient {
  constructor(private readonly signer: common.RequestSigner) {}

  async send(req: common.HttpRequest, forceExcludeBody?: boolean): Promise<Response> {
    await this.signer.signHttpRequest(req, forceExcludeBody);
    const url = new URL(req.uri);
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    // 本プラグインのbodyはcomposeRequestが組むJSON文字列のみ(stream送信は未対応で良い)
    const body = typeof req.body === "string" || Buffer.isBuffer(req.body) ? req.body : undefined;

    return new Promise<Response>((resolve, reject) => {
      const isHttp = url.protocol === "http:";
      const transport = isHttp ? httpRequest : httpsRequest;
      const agent = isHttp ? httpAgent : httpsAgent;
      const request = transport(url, { method: req.method, headers, agent }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(key, item);
            } else if (value !== undefined) {
              responseHeaders.set(key, value);
            }
          }
          const status = res.statusCode ?? 0;
          const payload = NO_BODY_STATUS.has(status) ? null : (Buffer.concat(chunks) as unknown as BodyInit);
          resolve(new Response(payload, { status, statusText: res.statusMessage ?? "", headers: responseHeaders }));
        });
        res.on("error", reject);
      });
      request.on("error", reject);
      if (body !== undefined) request.write(body);
      request.end();
    });
  }
}
