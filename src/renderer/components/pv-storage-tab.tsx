import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import type { ClusterOciData } from "../fetch/fetch";
import type { OciConsoleResourceType } from "../match/console-url";
import { filterRows } from "../match/filter-rows";
import {
  distinctBlockVolumeOcids,
  distinctFssRefOcids,
  fileSystemOcidOf,
  fileSystemOcidsOf,
  getCsiSource,
  isFssExportOcid,
  isOrphanedPvStorage,
  type PvStorageOrphanKind,
  type PvStorageResolution,
  resolvePvStorage,
} from "../match/pv-storage";
import { entriesReady, sectionsReady } from "../match/section-ready";
import { sortRows } from "../match/sort-rows";
import { ConsoleButton } from "./console-button";
import { EmptyState } from "./empty-state";
import { SectionError } from "./error-guidance";
import { OcidCopyButton } from "./ocid-copy-button";
import { SearchBar } from "./search-bar";
import { SortableHeaderCell } from "./sortable-header-cell";
import { LoadingBlock } from "./spinner";
import { LifecycleBadge } from "./status-badge";
import { TABLE_STYLE, TD_STYLE, TH_STYLE, UNMATCHED_ROW_STYLE } from "./table-styles";
import { useColumnSort } from "./use-column-sort";
import type { SearchState } from "./use-search-query";

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
  /** 参照先の実体がOCIに存在しないと確定したPV(残骸)。エラーではなく観測結果として出す */
  orphaned?: true;
}

// OCIは権限不足と不在に同じ応答を返すため、不在と断定せず両方を読める文言にする。
const ORPHAN_MESSAGE: Record<PvStorageOrphanKind, string> = {
  volume: "Not found in OCI or not accessible (orphaned PV)",
  filesystem: "Not found in OCI or not accessible (orphaned PV)",
  export: "Export not found or not accessible (file system may still exist)",
};

// バックアップポリシー名の表示(未割当="None"は保護されていないボリュームの検出材料)。
function backupPolicyLabel(policy: ClusterOciData["volumeBackupPolicies"][string] | undefined): string {
  if (!policy?.ok) return "-";
  return policy.data.policyName ?? "None";
}

function resolveStorage(data: ClusterOciData, resolution: PvStorageResolution): StorageResolution {
  const orphaned = isOrphanedPvStorage(resolution, data);
  if (orphaned) {
    return {
      displayName: ORPHAN_MESSAGE[orphaned],
      ocid: resolution.ocid,
      kindLabel: resolution.kind === "block_volume" ? "Volume" : "FSS",
      backupLabel: "-",
      orphaned: true,
    };
  }
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
      displayName: volume?.["display-name"] ?? "-",
      lifecycleState: volume?.["lifecycle-state"],
      sizeGb: volume?.["size-in-gbs"],
      ocid,
      consoleType: "volume",
      kindLabel: "Volume",
      backupLabel,
      backupPolicyId,
      backupConsoleType: "volume-backup-policy",
    };
  }
  if (resolution.kind === "file_system" && resolution.ocid) {
    const ocid = fileSystemOcidOf(resolution.ocid, data.fssExports);
    const fsResult = ocid ? data.fileSystems[ocid] : undefined;
    if (!fsResult?.ok) {
      return { displayName: "-", kindLabel: "FSS", ocid, consoleType: "filesystem", backupLabel: "-" };
    }
    const policyId = fsResult.data["filesystem-snapshot-policy-id"];
    return {
      displayName: fsResult.data["display-name"] ?? "-",
      lifecycleState: fsResult.data["lifecycle-state"],
      ocid,
      consoleType: "filesystem",
      kindLabel: "FSS",
      backupLabel: policyId ? backupPolicyLabel(data.fssSnapshotPolicies[policyId]) : "None",
      backupPolicyId: policyId,
      backupConsoleType: "fss-snapshot-policy",
    };
  }
  return { displayName: "-", kindLabel: "Unsupported", backupLabel: "-" };
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

function searchTextOf(row: PvRow): readonly (string | number | undefined)[] {
  return [
    row.pvName,
    row.pvcLabel,
    // orphaned行のentity列はORPHAN_MESSAGE(実体名ではない)ため、説明文で行が引けないよう外す。
    row.storage.orphaned ? undefined : row.storage.displayName,
    row.storage.kindLabel,
    row.storage.sizeGb,
    row.storage.backupLabel,
    row.storage.lifecycleState,
  ];
}

/** 一覧の各セルが埋まる材料(OCI側)が揃ったか。PV行はK8s由来なので行数自体は先に確定している。 */
function storageCellsReady(data: ClusterOciData, resolutions: PvStorageResolution[]): boolean {
  if (!sectionsReady(data.volumes, data.taggedResources)) return false;
  const refOcids = distinctFssRefOcids(resolutions);
  if (!entriesReady(data.fssExports, refOcids.filter(isFssExportOcid))) return false;
  const fileSystemIds = fileSystemOcidsOf(refOcids, data.fssExports);
  if (!entriesReady(data.fileSystems, fileSystemIds)) return false;
  if (!entriesReady(data.volumeBackupPolicies, distinctBlockVolumeOcids(resolutions))) return false;
  const policyIds = fileSystemIds
    .map((id) => {
      const fileSystem = data.fileSystems[id];
      return fileSystem?.ok ? fileSystem.data["filesystem-snapshot-policy-id"] : undefined;
    })
    .filter((id): id is string => !!id);
  return entriesReady(data.fssSnapshotPolicies, policyIds);
}

export interface PvStorageTabProps {
  data: ClusterOciData;
  region: string | undefined;
  search: SearchState;
}

export const PvStorageTab = observer(function PvStorageTab({ data, region, search }: PvStorageTabProps) {
  const pvStore = Renderer.K8sApi.persistentVolumeStore;
  const [sort, toggleSort] = useColumnSort<PvColumn>("pv");
  const { query, setQuery } = search;

  if (!pvStore.isLoaded) {
    return <LoadingBlock />;
  }
  const pvs = pvStore.items;
  if (pvs.length === 0) {
    return <EmptyState message="No PersistentVolumes" />;
  }
  const resolved = pvs.map((pv) => {
    const csi = getCsiSource(pv.spec);
    return { pv, resolution: resolvePvStorage(csi?.driver, csi?.volumeHandle) };
  });
  // 行のOCI列が後から埋まるとテーブルがガタつくため、材料が揃ってから表を出す。
  if (
    !storageCellsReady(
      data,
      resolved.map((entry) => entry.resolution),
    )
  ) {
    return <LoadingBlock />;
  }

  const rows: PvRow[] = resolved.map(({ pv, resolution }) => {
    const claimRef = pv.spec.claimRef;
    return {
      key: pv.getId(),
      pvName: pv.getName(),
      pvcLabel: claimRef ? `${claimRef.namespace ?? "-"}/${claimRef.name}` : "-",
      storage: resolveStorage(data, resolution),
    };
  });
  const sortedRows = sortRows(filterRows(rows, query, searchTextOf), SORT_VALUE[sort.column], sort.direction);

  return (
    <div>
      {!data.volumes.ok && <SectionError kind={data.volumes.kind} raw={data.volumes.raw} />}
      <SearchBar query={query} onChange={setQuery} placeholder="Search PV / PVC / entity name" />
      {sortedRows.length === 0 ? (
        <EmptyState message={`No volumes match "${query}"`} />
      ) : (
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
                Entity Name
              </SortableHeaderCell>
              <SortableHeaderCell column="kind" sort={sort} onSort={toggleSort}>
                Kind
              </SortableHeaderCell>
              <SortableHeaderCell column="size" sort={sort} onSort={toggleSort}>
                Size (GB)
              </SortableHeaderCell>
              <SortableHeaderCell column="backup" sort={sort} onSort={toggleSort}>
                Backup
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
              if (storage.kindLabel === "Unsupported") {
                return (
                  <tr key={row.key} style={UNMATCHED_ROW_STYLE}>
                    <td style={TD_STYLE}>{row.pvName}</td>
                    <td style={TD_STYLE}>{row.pvcLabel}</td>
                    <td style={TD_STYLE} colSpan={6}>
                      Unsupported (no matching Block Volume / FSS found)
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={row.key} style={storage.orphaned ? UNMATCHED_ROW_STYLE : undefined}>
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
      )}
    </div>
  );
});
