import { Main } from "@freelensapp/extensions";
import { EXEC_OCI_CHANNEL, LOOKUP_HOST_IPS_CHANNEL } from "../common/oci-ipc";
import { ociPreferencesStore } from "../common/store/oci-preferences-store";
import { lookupHostIps } from "./dns";
import { execOciProcess } from "./oci-exec";

class OciClusterIpc extends Main.Ipc {}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export default class OciClusterMain extends Main.LensExtension {
  protected onActivate(): void {
    // 消すな: renderer側のloadだけではPreferences変更がcluster frameへ同期されない(詳細: docs/extension-api.md)。
    ociPreferencesStore.loadExtension(this);

    const ipc = OciClusterIpc.createInstance(this);
    ipc.handle(EXEC_OCI_CHANNEL, (_event, file: unknown, argv: unknown) => {
      if (typeof file !== "string" || !isStringArray(argv)) throw new TypeError("exec-oci expects (string, string[])");
      return execOciProcess(file, argv);
    });
    ipc.handle(LOOKUP_HOST_IPS_CHANNEL, (_event, host: unknown) => {
      if (typeof host !== "string") throw new TypeError("lookup-host-ips expects (string)");
      return lookupHostIps(host);
    });
  }
}
