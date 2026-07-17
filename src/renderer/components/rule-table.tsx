import type * as React from "react";
import type { RouteRow, RuleRow } from "../match/rule-rows";
import { TABLE_STYLE, TD_STYLE, TH_STYLE } from "./table-styles";

const DIRECTION_LABEL: Record<RuleRow["direction"], string> = {
  ingress: "IN",
  egress: "OUT",
};

const SUB_TABLE_STYLE: React.CSSProperties = { ...TABLE_STYLE, fontSize: 12 };

/** SL/NSG共通のルール表(展開領域用)。 */
export function RuleTable({ rows }: { rows: RuleRow[] }) {
  if (rows.length === 0) return <div style={{ color: "var(--textColorSecondary, #9aa0a6)" }}>ルールなし</div>;
  return (
    <table style={SUB_TABLE_STYLE}>
      <thead>
        <tr>
          <th style={TH_STYLE}>方向</th>
          <th style={TH_STYLE}>プロトコル</th>
          <th style={TH_STYLE}>送信元/宛先</th>
          <th style={TH_STYLE}>ポート</th>
          <th style={TH_STYLE}>stateless</th>
          <th style={TH_STYLE}>説明</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((rule, index) => (
          // ルールに一意IDが無いため添字keyを使う(並び替えは行わないため安全)
          // biome-ignore lint/suspicious/noArrayIndexKey: 上記理由
          <tr key={index}>
            <td style={TD_STYLE}>{DIRECTION_LABEL[rule.direction]}</td>
            <td style={TD_STYLE}>{rule.protocol}</td>
            <td style={TD_STYLE}>{rule.peer}</td>
            <td style={TD_STYLE}>{rule.ports}</td>
            <td style={TD_STYLE}>{rule.stateless ? "yes" : "no"}</td>
            <td style={TD_STYLE}>{rule.description ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface RouteRuleTableProps {
  rows: RouteRow[];
  /** ルート宛先ゲートウェイの生死表示(networkページが gateways Record から引いて描画する)。 */
  renderStatus?: (entityId: string | undefined) => React.ReactNode;
}

/** RTのルート表(展開領域用)。 */
export function RouteRuleTable({ rows, renderStatus }: RouteRuleTableProps) {
  if (rows.length === 0) return <div style={{ color: "var(--textColorSecondary, #9aa0a6)" }}>ルートなし</div>;
  return (
    <table style={SUB_TABLE_STYLE}>
      <thead>
        <tr>
          <th style={TH_STYLE}>宛先</th>
          <th style={TH_STYLE}>経由</th>
          {renderStatus && <th style={TH_STYLE}>経由の状態</th>}
          <th style={TH_STYLE}>説明</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((route, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: ルートに一意IDが無く並び替えも行わない
          <tr key={index}>
            <td style={TD_STYLE}>{route.destination}</td>
            <td style={TD_STYLE}>{route.entityKind}</td>
            {renderStatus && <td style={TD_STYLE}>{renderStatus(route.entityId)}</td>}
            <td style={TD_STYLE}>{route.description ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
