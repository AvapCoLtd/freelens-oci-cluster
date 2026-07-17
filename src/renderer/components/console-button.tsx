import { Common } from "@freelensapp/extensions";
import { buildConsoleUrl, type OciConsoleResourceType } from "../match/console-url";
import { Icon } from "./freelens-ui";

export interface ConsoleButtonProps {
  type: OciConsoleResourceType;
  ocid: string;
  region: string;
  /** 親付きリソース(subnet/SL/RT/NSG=VCN、waf=ポリシー)で必須。未解決の間は呼び出し元がボタン自体を出さない。 */
  parentId?: string;
}

// window.openはElectronのBrowserWindow内遷移になり得るため、既定ブラウザで開くCommon.Util.openExternalを使う。
export function ConsoleButton({ type, ocid, region, parentId }: ConsoleButtonProps) {
  const handleClick = () => {
    Common.Util.openExternal(buildConsoleUrl(type, ocid, region, parentId)).catch((error: unknown) =>
      console.error("[freelens-oci-cluster] openExternal failed", error),
    );
  };

  return <Icon material="open_in_new" tooltip="コンソールで開く" interactive small onClick={handleClick} />;
}
