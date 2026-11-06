import { Renderer } from "@freelensapp/extensions";
import {
  EXEC_OCI_CHANNEL,
  type HostLookupResult,
  LOOKUP_HOST_IPS_CHANNEL,
  type OciExecResult,
} from "../common/oci-ipc";

class OciClusterIpc extends Renderer.Ipc {}

/** onActivateで呼ぶ。無効化時はホストがインスタンスを破棄する。 */
export function registerOciIpc(extension: Renderer.LensExtension): void {
  OciClusterIpc.createInstance(extension);
}

// asyncにしておく: 登録前・無効化後のgetInstance()の例外を、呼び出し元がrejectとして受けられる。
export async function invokeExecOci(file: string, argv: readonly string[]): Promise<OciExecResult> {
  return OciClusterIpc.getInstance().invoke(EXEC_OCI_CHANNEL, file, argv);
}

export async function invokeLookupHostIps(host: string): Promise<HostLookupResult> {
  return OciClusterIpc.getInstance().invoke(LOOKUP_HOST_IPS_CHANNEL, host);
}
