import { Common } from "@freelensapp/extensions";
import { buildConsoleUrl, type OciConsoleResourceType } from "../match/console-url";
import { Button, Icon } from "./freelens-ui";

export interface ConsoleButtonProps {
  type: OciConsoleResourceType;
  ocid: string;
  region: string;
  /** 親付きリソース(subnet/SL/RT/NSG=VCN、waf=ポリシー)で必須。未解決の間は呼び出し元がボタン自体を出さない。 */
  parentId?: string;
}

// window.openはElectronのBrowserWindow内遷移になり得るため、既定ブラウザで開くCommon.Util.openExternalを使う。
function openConsole(url: string): void {
  Common.Util.openExternal(url).catch((error: unknown) =>
    console.error("[freelens-oci-cluster] openExternal failed", error),
  );
}

export function ConsoleButton({ type, ocid, region, parentId }: ConsoleButtonProps) {
  return (
    <Icon
      material="open_in_new"
      tooltip="Open in Console"
      interactive
      small
      onClick={() => openConsole(buildConsoleUrl(type, ocid, region, parentId))}
    />
  );
}

/** 生成済みURLを持つ呼び出し元(トポロジー図の詳細パネル)向けのラベル付きボタン。 */
export function ConsoleLinkButton({ url }: { url: string }) {
  return <Button primary small label="Open in Console" onClick={() => openConsole(url)} />;
}
