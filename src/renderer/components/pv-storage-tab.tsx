import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type { OciConsoleResourceType } from "../match/console-url";
import { getCsiSource, resolvePvStorage } from "../match/pv-storage";
import { sortRows } from "../match/sort-rows";
import type { ClusterOciData } from "../sdk/fetch";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { OcidCopyButton } from "./ocid-copy-button";
import { SortableHeaderCell } from "./sortable-header-cell";
import { LifecycleBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE, UNMATCHED_ROW_STYLE } from "./table-styles";
import { useColumnSort } from "./use-column-sort";

interface StorageResolution {
  displayName: string;
  lifecycleState?: string;
  sizeGb?: number;
  ocid?: string;
  consoleType?: OciConsoleResourceType;
  kindLabel: string;
  backupLabel: string;
  backupPolicyId?: string;
  backupConsoleType?: OciConsoleResourceType;
}

// バックアップポリシー名の表示(未割当="なし"は保護されていないボリュームの検出材料)。
function backupPolicyLabel(policy: ClusterOciData["volumeBackupPolicies"][string] | undefined): string {
  if (!policy) return "取得中...";
  if (!policy.ok) return "-";
  return policy.data.policyName ?? "なし";
}

function resolveStorage(
  data: ClusterOciData,
  driver: string | undefined,
  volumeHandle: string | undefined,
): StorageResolution {
  const resolution = resolvePvStorage(driver, volumeHandle);
  if (resolution.kind === "block_volume" && resolution.ocid) {
    const ocid = resolution.ocid;
    const backup = data.volumeBackupPolicies[ocid];
    const backupLabel = backupPolicyLabel(backup);
    const backupPolicyId = backup?.ok ? backup.data.policyId : undefined;
    if (!data.volumes.ok) {
      return {
        displayName: "-",
        kindLabel: "Volume",
        ocid,
        consoleType: "volume",
        backupLabel,
        backupPolicyId,
        backupConsoleType: "volume-backup-policy",
      };
    }
    const volume = data.volumes.data.find((v) => v.id === ocid);
    return {
      displayName: volume?.displayName ?? "-",
      lifecycleState: volume?.lifecycleState,
      sizeGb: volume?.sizeInGBs,
      ocid,
      consoleType: "volume",
      kindLabel: "Volume",
      backupLabel,
      backupPolicyId,
      backupConsoleType: "volume-backup-policy",
    };
  }
  if (resolution.kind === "file_system" && resolution.ocid) {
    const ocid = resolution.ocid;
    const fsResult = data.fileSystems[ocid];
    if (!fsResult?.ok) {
      return { displayName: "-", kindLabel: "FSS", ocid, consoleType: "filesystem", backupLabel: "取得中..." };
    }
    const policyId = fsResult.data.filesystemSnapshotPolicyId;
    return {
      displayName: fsResult.data.displayName ?? "-",
      lifecycleState: fsResult.data.lifecycleState,
      ocid,
      consoleType: "filesystem",
      kindLabel: "FSS",
      backupLabel: policyId ? backupPolicyLabel(data.fssSnapshotPolicies[policyId]) : "なし",
      backupPolicyId: policyId,
      backupConsoleType: "fss-snapshot-policy",
    };
  }
  return { displayName: "-", kindLabel: "未対応", backupLabel: "-" };
}

type PvColumn = "pv" | "pvc" | "entity" | "kind" | "size" | "backup" | "lifecycle";

interface PvRow {
  key: string;
  pvName: string;
  pvcLabel: string;
  storage: StorageResolution;
}

const SORT_VALUE: Record<PvColumn, (row: PvRow) => string | number | undefined> = {
  pv: (row) => row.pvName,
  pvc: (row) => row.pvcLabel,
  entity: (row) => row.storage.displayName,
  kind: (row) => row.storage.kindLabel,
  size: (row) => row.storage.sizeGb,
  backup: (row) => row.storage.backupLabel,
  lifecycle: (row) => row.storage.lifecycleState,
};

export interface PvStorageTabProps {
  data: ClusterOciData;
  region: string | undefined;
}

export const PvStorageTab = observer(function PvStorageTab({ data, region }: PvStorageTabProps) {
  const pvStore = Renderer.K8sApi.persistentVolumeStore;
  const [sort, toggleSort] = useColumnSort<PvColumn>("pv");

  if (!pvStore.isLoaded) {
    return <EmptyState message="読み込み中..." />;
  }
  const pvs = pvStore.items;
  if (pvs.length === 0) {
    return <EmptyState message="PersistentVolume がありません" />;
  }

  const rows: PvRow[] = pvs.map((pv) => {
    const csi = getCsiSource(pv.spec);
    const claimRef = pv.spec.claimRef;
    return {
      key: pv.getId(),
      pvName: pv.getName(),
      pvcLabel: claimRef ? `${claimRef.namespace ?? "-"}/${claimRef.name}` : "-",
      storage: resolveStorage(data, csi?.driver, csi?.volumeHandle),
    };
  });
  const sortedRows = sortRows(rows, SORT_VALUE[sort.column], sort.direction);

  return (
    <div>
      {!data.volumes.ok && <SectionError kind={data.volumes.kind} raw={data.volumes.raw} />}
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            <SortableHeaderCell column="pv" sort={sort} onSort={toggleSort}>
              PV
            </SortableHeaderCell>
            <SortableHeaderCell column="pvc" sort={sort} onSort={toggleSort}>
              PVC
            </SortableHeaderCell>
            <SortableHeaderCell column="entity" sort={sort} onSort={toggleSort}>
              実体名
            </SortableHeaderCell>
            <SortableHeaderCell column="kind" sort={sort} onSort={toggleSort}>
              種別
            </SortableHeaderCell>
            <SortableHeaderCell column="size" sort={sort} onSort={toggleSort}>
              サイズ(GB)
            </SortableHeaderCell>
            <SortableHeaderCell column="backup" sort={sort} onSort={toggleSort}>
              バックアップ
            </SortableHeaderCell>
            <SortableHeaderCell column="lifecycle" sort={sort} onSort={toggleSort}>
              lifecycle-state
            </SortableHeaderCell>
            <th style={TH_STYLE}>OCID</th>
            <th style={TH_STYLE} />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const { storage } = row;
            if (storage.kindLabel === "未対応") {
              return (
                <tr key={row.key} style={UNMATCHED_ROW_STYLE}>
                  <td style={TD_STYLE}>{row.pvName}</td>
                  <td style={TD_STYLE}>{row.pvcLabel}</td>
                  <td style={TD_STYLE} colSpan={6}>
                    未対応(対応する Block Volume / FSS が見つかりません)
                  </td>
                </tr>
              );
            }
            return (
              <tr key={row.key}>
                <td style={TD_STYLE}>{row.pvName}</td>
                <td style={TD_STYLE}>{row.pvcLabel}</td>
                <td style={TD_STYLE}>{storage.displayName}</td>
                <td style={TD_STYLE}>{storage.kindLabel}</td>
                <td style={TD_STYLE}>{storage.kindLabel === "Volume" ? (storage.sizeGb ?? "-") : "-"}</td>
                <td style={TD_STYLE}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {storage.backupLabel}
                    {storage.backupPolicyId && storage.backupConsoleType && region && (
                      <ConsoleButton type={storage.backupConsoleType} ocid={storage.backupPolicyId} region={region} />
                    )}
                  </span>
                </td>
                <td style={TD_STYLE}>
                  <LifecycleBadge state={storage.lifecycleState} />
                </td>
                <td style={TD_STYLE}>{storage.ocid ? <OcidCopyButton ocid={storage.ocid} /> : "-"}</td>
                <td style={TD_STYLE}>
                  {storage.ocid && storage.consoleType && region && (
                    <ConsoleButton type={storage.consoleType} ocid={storage.ocid} region={region} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
