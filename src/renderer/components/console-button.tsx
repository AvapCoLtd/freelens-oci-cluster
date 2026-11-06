import { buildConsoleUrl, type OciConsoleResourceType } from "../match/console-url";
import { Button, Icon } from "./freelens-ui";

export interface ConsoleButtonProps {
  type: OciConsoleResourceType;
  ocid: string;
  region: string;
  /** 親付きリソース(subnet/SL/RT/NSG=VCN、waf=ポリシー)で必須。未解決の間は呼び出し元がボタン自体を出さない。 */
  parentId?: string;
}

// ホストのwindow-openハンドラが新規ウィンドウを拒否し、http/https URLを既定ブラウザへ渡す。
function openConsole(url: string): void {
  window.open(url);
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
