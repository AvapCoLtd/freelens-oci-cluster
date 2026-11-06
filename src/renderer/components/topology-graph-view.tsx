import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import xyflowCss from "@xyflow/react/dist/style.css?inline";
import * as React from "react";
import type { TopologyLegendRow } from "../match/topology-edge-filter";
import type { TopologyFlow, TopologyFlowNodeData, TopologySide } from "../match/topology-flow";
import {
  EDGE_HEALTH_COLOR,
  EDGE_HEALTH_DASH,
  EDGE_HEALTH_LABEL,
  EDGE_KIND_COLOR,
  EDGE_KIND_DASH,
  EDGE_KIND_LABEL,
  EDGE_KIND_OPACITY,
  edgeDashOf,
  sourceHandleId,
  TOPOLOGY_EDGE_Z_INDEX,
  TOPOLOGY_SIDES,
  targetHandleId,
} from "../match/topology-flow";
import type { TopologyEdgeHealth, TopologyEdgeKind } from "../match/topology-graph";
import type { TopologyPoint } from "../match/topology-layout";
import { matchTopologyNodes } from "../match/topology-search";
import type { InjectedStyle } from "./injected-style";

/** React Flow本体のスタイル。既存流儀に合わせてJS内文字列として注入する。 */
export const XYFLOW_STYLE: InjectedStyle = { id: "oci-xyflow", css: xyflowCss };

const ROOT_CLASS = "oci-topology";
const BOX_CLASS = "oci-topology-box";
const LABEL_CLASS = "oci-topology-label";

export const TOPOLOGY_FLOW_STYLE: InjectedStyle = {
  id: ROOT_CLASS,
  css: [
    // ハンドルはエッジの接続点としてだけ要る。display:noneにすると座標が取れずエッジが原点に寄る。
    `.${ROOT_CLASS} .react-flow__handle { opacity: 0; }`,
    `.${ROOT_CLASS} .react-flow__node { cursor: pointer; transition: opacity 120ms ease; }`,
    `.${ROOT_CLASS} .react-flow__edge { cursor: pointer; }`,
    `.${ROOT_CLASS} .react-flow__edge path { transition: opacity 120ms ease; }`,
    `.${ROOT_CLASS} .react-flow__node.selected .${BOX_CLASS} { outline: 2px solid var(--primary, #3d90ce); }`,
    `.${LABEL_CLASS} { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
  ].join("\n"),
};

const WARNING_COLOR = "var(--colorWarning, #e0a45a)";
const BORDER_COLOR = "var(--borderColor, #3f4041)";
const SECONDARY_COLOR = "var(--textColorSecondary, #9aa0a6)";

const CONTAINER_BOX_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  // ラベルが箱の外へはみ出さないよう見出し帯ごと切る(子ノードはDOM上の子ではないため切られない)。
  overflow: "hidden",
  border: `1px dashed ${BORDER_COLOR}`,
  borderRadius: 6,
  background: "var(--layoutBackground, #24272b)",
  padding: "8px 12px",
  color: "var(--textColorPrimary, #fff)",
};

const RESOURCE_BOX_STYLE: React.CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 2,
  border: `1px solid ${BORDER_COLOR}`,
  borderLeft: `3px solid ${BORDER_COLOR}`,
  borderRadius: 4,
  background: "var(--mainBackground, #1e2124)",
  padding: "6px 10px",
  color: "var(--textColorPrimary, #fff)",
};

// line-heightはボックス高(topology-layoutのLEAF_SIZE)の前提。既定値任せにすると行が伸びて下端で切れる。
const KIND_LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  lineHeight: "12px",
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: SECONDARY_COLOR,
};

const NAME_STYLE: React.CSSProperties = { fontSize: 12, lineHeight: "16px" };

const CONTAINER_NAME_STYLE: React.CSSProperties = { fontSize: 13, lineHeight: "17px", fontWeight: "bold" };

const CIDR_STYLE: React.CSSProperties = { fontSize: 11, lineHeight: "15px", color: SECONDARY_COLOR };

function dataOf(props: NodeProps): TopologyFlowNodeData {
  return props.data as unknown as TopologyFlowNodeData;
}

const HANDLE_POSITION: Record<TopologySide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/** 4方向すべてを出す。どの辺を使うかはtoTopologyFlowがsourceHandle/targetHandleで指名する。 */
function edgeHandles() {
  return TOPOLOGY_SIDES.map((side) => (
    <React.Fragment key={side}>
      <Handle type="target" id={targetHandleId(side)} position={HANDLE_POSITION[side]} isConnectable={false} />
      <Handle type="source" id={sourceHandleId(side)} position={HANDLE_POSITION[side]} isConnectable={false} />
    </React.Fragment>
  ));
}

const ContainerNode = React.memo(function ContainerNode(props: NodeProps) {
  const data = dataOf(props);
  return (
    <div className={BOX_CLASS} style={CONTAINER_BOX_STYLE}>
      {data.kindLabel && <div style={KIND_LABEL_STYLE}>{data.kindLabel}</div>}
      <div className={LABEL_CLASS} style={CONTAINER_NAME_STYLE} title={data.label}>
        {data.label}
      </div>
      {data.sublabel && (
        <div className={LABEL_CLASS} style={CIDR_STYLE} title={data.sublabel}>
          {data.sublabel}
        </div>
      )}
      {edgeHandles()}
    </div>
  );
});

const ResourceNode = React.memo(function ResourceNode(props: NodeProps) {
  const data = dataOf(props);
  const warning = data.status === "warning";
  return (
    <div
      className={BOX_CLASS}
      style={warning ? { ...RESOURCE_BOX_STYLE, borderLeftColor: WARNING_COLOR } : RESOURCE_BOX_STYLE}
    >
      <div style={warning ? { ...KIND_LABEL_STYLE, color: WARNING_COLOR } : KIND_LABEL_STYLE}>
        {data.expandable ? `${data.kindLabel} (click to expand)` : data.kindLabel}
      </div>
      <div className={LABEL_CLASS} style={NAME_STYLE} title={data.label}>
        {data.label}
      </div>
      {edgeHandles()}
    </div>
  );
});

// コンポーネント外で定義しないとReact Flowが毎レンダーで全ノードを作り直す。
const NODE_TYPES: NodeTypes = { container: ContainerNode, resource: ResourceNode };

const CORNER_RADIUS = 6;

/** 直交折れ線を角だけ丸めたSVGパスにする。 */
function orthogonalPath(points: readonly TopologyPoint[], radius: number): string {
  const head = points[0];
  if (!head) return "";
  let path = `M ${head.x},${head.y}`;
  for (let at = 1; at + 1 < points.length; at += 1) {
    const previous = points[at - 1] as TopologyPoint;
    const corner = points[at] as TopologyPoint;
    const next = points[at + 1] as TopologyPoint;
    const back = Math.min(
      radius,
      Math.abs(corner.x - previous.x) / 2 + Math.abs(corner.y - previous.y) / 2,
      Math.abs(next.x - corner.x) / 2 + Math.abs(next.y - corner.y) / 2,
    );
    const enter = {
      x: corner.x + Math.sign(previous.x - corner.x) * back,
      y: corner.y + Math.sign(previous.y - corner.y) * back,
    };
    const leave = {
      x: corner.x + Math.sign(next.x - corner.x) * back,
      y: corner.y + Math.sign(next.y - corner.y) * back,
    };
    path += ` L ${enter.x},${enter.y} Q ${corner.x},${corner.y} ${leave.x},${leave.y}`;
  }
  const tail = points[points.length - 1] as TopologyPoint;
  return `${path} L ${tail.x},${tail.y}`;
}

function OrthogonalEdge({ id, data, style, markerEnd, interactionWidth }: EdgeProps) {
  const points = (data?.points ?? []) as TopologyPoint[];
  return (
    <BaseEdge
      id={id}
      path={orthogonalPath(points, CORNER_RADIUS)}
      style={style}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  );
}

const EDGE_TYPES: EdgeTypes = { orthogonal: OrthogonalEdge };

// 親跨ぎエッジは既定のz-indexだと親ボックスの背面に回る。
const DEFAULT_EDGE_OPTIONS = {
  // 経路は導出層が障害物を避けて決めた点列。組み込みのsmoothstepは箱を貫く。
  type: "orthogonal",
  zIndex: TOPOLOGY_EDGE_Z_INDEX,
  style: { stroke: SECONDARY_COLOR },
  markerEnd: { type: MarkerType.ArrowClosed, color: SECONDARY_COLOR },
};

const ACCENT_COLOR = "var(--primary, #3d90ce)";
const DIM_OPACITY = 0.12;
const DIM_NODE_OPACITY = 0.25;
// 強調エッジは既定のエッジ(TOPOLOGY_EDGE_Z_INDEX)より前に出す。
const ACCENT_EDGE_Z_INDEX = TOPOLOGY_EDGE_Z_INDEX + 100;

function toFlowNodes(flow: TopologyFlow): Node[] {
  return flow.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    parentId: node.parentId,
    position: node.position,
    // measuredに依存しないよう固定値で渡す(レイアウトが決めたサイズがそのまま図のサイズ)。
    width: node.width,
    height: node.height,
    style: { width: node.width, height: node.height },
    draggable: false,
    data: node.data as unknown as Record<string, unknown>,
  }));
}

function edgeStyleOf(edge: TopologyFlow["edges"][number]): React.CSSProperties {
  const dash = edgeDashOf(edge);
  const opacity = EDGE_KIND_OPACITY[edge.kind];
  return {
    stroke: edge.color,
    ...(opacity === undefined ? {} : { strokeOpacity: opacity }),
    ...(dash === undefined ? {} : { strokeDasharray: dash }),
  };
}

function toFlowEdges(flow: TopologyFlow): Edge[] {
  return flow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    ariaLabel: edge.label,
    data: { points: edge.points },
    style: edgeStyleOf(edge),
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.color, width: 14, height: 14 },
  }));
}

interface Highlight {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
}

/** 強調ノードを囲むコンテナまで減光すると、関連ノードがどのVCN/Subnetの中か読めなくなる。 */
function withAncestors(nodes: Node[], ids: ReadonlySet<string>): Set<string> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const expanded = new Set(ids);
  for (const id of ids) {
    let parentId = parentOf.get(id);
    while (parentId && !expanded.has(parentId)) {
      expanded.add(parentId);
      parentId = parentOf.get(parentId);
    }
  }
  return expanded;
}

/** 注目ノード(またはエッジ)に接続するエッジと対向ノードを集める。 */
function highlightOf(
  nodes: Node[],
  edges: Edge[],
  nodeId: string | undefined,
  edgeId: string | undefined,
): Highlight | undefined {
  if (edgeId) {
    const edge = edges.find((entry) => entry.id === edgeId);
    if (edge) {
      return { nodeIds: withAncestors(nodes, new Set([edge.source, edge.target])), edgeIds: new Set([edge.id]) };
    }
  }
  if (!nodeId) return undefined;
  const nodeIds = new Set([nodeId]);
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;
    edgeIds.add(edge.id);
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  return { nodeIds: withAncestors(nodes, nodeIds), edgeIds };
}

/** 検索マッチとその親、マッチノードに接続するエッジ(片端がマッチなら残す)。 */
function searchHighlightOf(nodes: Node[], edges: Edge[], matched: ReadonlySet<string>): Highlight {
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (matched.has(edge.source) || matched.has(edge.target)) edgeIds.add(edge.id);
  }
  return { nodeIds: withAncestors(nodes, matched), edgeIds };
}

/**
 * 強調対象でない要素だけ新しいオブジェクトにする(同一参照のノードはReact Flowが再描画を省く)。
 * focusとsearchが同時にあるときはfocusだけを見る(重ねるとホバー先まで減光したままになる)。
 */
function applyHighlight(nodes: Node[], edges: Edge[], focus: Highlight | undefined, search: Highlight | undefined) {
  const highlight = focus ?? search;
  if (!highlight) return { nodes, edges };
  return {
    nodes: nodes.map((node) =>
      highlight.nodeIds.has(node.id) ? node : { ...node, style: { ...node.style, opacity: DIM_NODE_OPACITY } },
    ),
    edges: edges.map((edge) => {
      if (!highlight.edgeIds.has(edge.id)) return { ...edge, style: { ...edge.style, opacity: DIM_OPACITY } };
      // 検索マッチのエッジは種別色のまま残す(色を変えると凡例と対応が取れなくなる)。
      if (!focus) return edge;
      return {
        ...edge,
        zIndex: ACCENT_EDGE_Z_INDEX,
        style: { ...edge.style, stroke: ACCENT_COLOR, strokeOpacity: 1, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: ACCENT_COLOR },
      };
    }),
  };
}

const NO_MATCH_STYLE: React.CSSProperties = {
  border: `1px solid ${BORDER_COLOR}`,
  borderRadius: 4,
  background: "var(--mainBackground, #1e2124)",
  padding: "6px 10px",
  fontSize: 12,
  color: SECONDARY_COLOR,
};

const LEGEND_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  border: `1px solid ${BORDER_COLOR}`,
  borderRadius: 4,
  background: "var(--mainBackground, #1e2124)",
  padding: "6px 8px",
  fontSize: 10,
  lineHeight: "12px",
  color: SECONDARY_COLOR,
  // Controls(左下)の右へずらす。重ねるとズームボタンが押せなくなる。
  marginLeft: 52,
};

const LEGEND_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
  appearance: "none",
  border: "none",
  background: "none",
  padding: 0,
  margin: 0,
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const LEGEND_ROW_OFF_STYLE: React.CSSProperties = { ...LEGEND_ROW_STYLE, opacity: 0.4 };

const LEGEND_HEALTH_ROW_STYLE: React.CSSProperties = { ...LEGEND_ROW_STYLE, paddingLeft: 12 };

const LEGEND_HEALTH_ROW_OFF_STYLE: React.CSSProperties = { ...LEGEND_HEALTH_ROW_STYLE, opacity: 0.4 };

function legendSampleStyle(color: string, dash?: string, opacity?: number): React.CSSProperties {
  return {
    width: 16,
    flexShrink: 0,
    borderTop: `2px ${dash ? "dashed" : "solid"} ${color}`,
    opacity: opacity ?? 1,
  };
}

function EdgeLegend({
  rows,
  onToggleKind,
  onToggleHealth,
}: {
  rows: readonly TopologyLegendRow[];
  onToggleKind: (kind: TopologyEdgeKind) => void;
  onToggleHealth: (health: TopologyEdgeHealth) => void;
}) {
  if (rows.length === 0) return null;
  return (
    // nopanが無いと行を押し下げたままのわずかな動きで図がパンする。
    <Panel position="bottom-left" className="nopan" style={LEGEND_STYLE}>
      {rows.map((row) =>
        row.type === "health" ? (
          <button
            key={row.health}
            type="button"
            aria-pressed={row.shown}
            title={row.shown ? "Click to hide" : "Click to show"}
            style={row.shown ? LEGEND_HEALTH_ROW_STYLE : LEGEND_HEALTH_ROW_OFF_STYLE}
            onClick={() => onToggleHealth(row.health)}
          >
            <span style={legendSampleStyle(EDGE_HEALTH_COLOR[row.health], EDGE_HEALTH_DASH[row.health])} />
            {`${EDGE_HEALTH_LABEL[row.health]} (${row.count})`}
          </button>
        ) : (
          <button
            key={row.kind}
            type="button"
            aria-pressed={row.shown}
            title={row.shown ? "Click to hide" : "Click to show"}
            style={row.shown ? LEGEND_ROW_STYLE : LEGEND_ROW_OFF_STYLE}
            onClick={() => onToggleKind(row.kind)}
          >
            <span
              style={legendSampleStyle(
                EDGE_KIND_COLOR[row.kind],
                EDGE_KIND_DASH[row.kind],
                EDGE_KIND_OPACITY[row.kind],
              )}
            />
            {`${EDGE_KIND_LABEL[row.kind]} (${row.count})`}
          </button>
        ),
      )}
    </Panel>
  );
}

export interface TopologyGraphViewProps {
  flow: TopologyFlow;
  legendRows: readonly TopologyLegendRow[];
  onToggleEdgeKind: (kind: TopologyEdgeKind) => void;
  onToggleEdgeHealth: (health: TopologyEdgeHealth) => void;
  /** マッチしないノード・エッジを減光する検索語。空文字は減光なし */
  searchQuery: string;
  onSelectNode: (id: string | undefined) => void;
}

export function TopologyGraphView({
  flow,
  legendRows,
  onToggleEdgeKind,
  onToggleEdgeHealth,
  searchQuery,
  onSelectNode,
}: TopologyGraphViewProps) {
  const elements = React.useMemo(() => ({ nodes: toFlowNodes(flow), edges: toFlowEdges(flow) }), [flow]);
  // 選択状態はReact Flow側が持つ変更(onNodesChange)で入るため、導出結果をそのまま流し込むのは図の差し替え時だけにする。
  const [nodes, setNodes, onNodesChange] = useNodesState(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);
  // 強調はUI状態。ここに閉じ込めることで図の再導出(グラフ構築・レイアウト)を走らせない。
  const [hoveredNodeId, setHoveredNodeId] = React.useState<string | undefined>(undefined);
  const [hoveredEdgeId, setHoveredEdgeId] = React.useState<string | undefined>(undefined);
  const [focusedNodeId, setFocusedNodeId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    setNodes(elements.nodes);
    setEdges(elements.edges);
    setHoveredNodeId(undefined);
    setHoveredEdgeId(undefined);
    setFocusedNodeId(undefined);
  }, [elements, setNodes, setEdges]);

  const matched = React.useMemo(
    () => (searchQuery.trim().length === 0 ? undefined : matchTopologyNodes(flow.nodes, searchQuery)),
    [flow, searchQuery],
  );
  const searchHighlight = React.useMemo(
    () => (matched ? searchHighlightOf(nodes, edges, matched) : undefined),
    [matched, nodes, edges],
  );

  const view = React.useMemo(
    () =>
      applyHighlight(
        nodes,
        edges,
        highlightOf(nodes, edges, hoveredNodeId ?? focusedNodeId, hoveredEdgeId),
        searchHighlight,
      ),
    [nodes, edges, hoveredNodeId, focusedNodeId, hoveredEdgeId, searchHighlight],
  );

  return (
    <ReactFlow
      className={ROOT_CLASS}
      nodes={view.nodes}
      edges={view.edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeMouseEnter={(_event, node) => setHoveredNodeId(node.id)}
      onNodeMouseLeave={() => setHoveredNodeId(undefined)}
      onEdgeMouseEnter={(_event, edge) => setHoveredEdgeId(edge.id)}
      onEdgeMouseLeave={() => setHoveredEdgeId(undefined)}
      onNodeClick={(_event, node) => {
        setFocusedNodeId(node.id);
        onSelectNode(node.id);
      }}
      onPaneClick={() => {
        setFocusedNodeId(undefined);
        onSelectNode(undefined);
      }}
      minZoom={0.05}
      fitView
    >
      <Background />
      <Controls showInteractive={false} />
      {matched?.size === 0 && (
        <Panel position="top-center" style={NO_MATCH_STYLE}>{`No nodes match "${searchQuery}"`}</Panel>
      )}
      <EdgeLegend rows={legendRows} onToggleKind={onToggleEdgeKind} onToggleHealth={onToggleEdgeHealth} />
    </ReactFlow>
  );
}
