import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { ociPreferencesStore } from "../../common/store/oci-preferences-store";

// appPreferences登録のInput/Hintはregistrationからprops無しで描画される(ExtensionPreferenceBlock参照)。
export const OciCommandInput = observer(function OciCommandInput() {
  return (
    <Renderer.Component.Input
      value={ociPreferencesStore.ociCliCommand}
      placeholder="oci"
      onChange={(value) => ociPreferencesStore.setOciCliCommand(value)}
    />
  );
});

export function OciCommandHint() {
  return (
    <span>
      The command this extension runs to read OCI resources. Leave it blank to run `oci` from PATH; whatever
      authentication that command already uses (config file, session token, injected credentials) applies as is. Any
      oci-compatible command can be set instead, e.g. `wsl oci` when the CLI lives in WSL. The value is split on
      whitespace into the executable and its leading arguments, so an argument cannot contain spaces (quoting is not
      interpreted). Changes take effect on the next data fetch (Refresh, or reselecting the cluster).
    </span>
  );
}

export const OciPollingIntervalInput = observer(function OciPollingIntervalInput() {
  return (
    <Renderer.Component.Input
      value={String(ociPreferencesStore.nodePollingIntervalSeconds)}
      onChange={(value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) ociPreferencesStore.setNodePollingIntervalSeconds(parsed);
      }}
    />
  );
});

export function OciPollingIntervalHint() {
  return (
    <span>
      The auto-refresh interval (when the toggle is on) shared across pages. Default is 60 seconds, minimum 30 seconds
      (lower values are rounded up). Changes take effect from the next refresh cycle.
    </span>
  );
}
