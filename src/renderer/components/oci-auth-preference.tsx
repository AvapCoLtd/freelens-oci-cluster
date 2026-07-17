import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { ociPreferencesStore } from "../store/oci-preferences-store";

// appPreferences登録のInput/Hintはregistrationからprops無しで描画される(ExtensionPreferenceBlock参照)。
export const OciAuthCommandInput = observer(function OciAuthCommandInput() {
  return (
    <Renderer.Component.Input
      value={ociPreferencesStore.authCommand}
      placeholder="(blank: use ~/.oci/config)"
      onChange={(value) => ociPreferencesStore.setAuthCommand(value)}
    />
  );
});

export function OciAuthCommandHint() {
  return (
    <span>
      If left blank, authenticates from ~/.oci/config (or the path in the OCI_CONFIG_FILE environment variable). If set,
      runs that command and reads credentials from its JSON stdout (see README for the format). Credentials are kept in
      memory only and never written to disk. Changes take effect on the next data fetch (Refresh, or reselecting the
      cluster).
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
