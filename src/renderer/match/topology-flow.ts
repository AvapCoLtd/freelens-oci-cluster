import type {
  TopologyEdgeKind,
  TopologyGraph,
  TopologyNode,
  TopologyNodeKind,
  TopologyNodeStatus,
} from "./topology-graph";
import type { TopologyLayout, TopologyLayoutNode, TopologyPoint } from "./topology-layout";
import { type RouteEdge, type RouteNode, routeTopologyEdges, type TopologySide } from "./topology-routes";

export type { TopologySide } from "./topology-routes";

export const NODE_KIND_LABEL: Record<TopologyNodeKind, string> = {
  vcn: "VCN",
  subnet: "Subnet",
  "subnet-summary": "Subnets",
  "instance-group": "Instances",
  instance: "Instance",
  lb: "LB",
  nlb: "NLB",
  gateway: "Gateway",
  waf: "WAF",
  "k8s-service": "Service",
  "k8s-pv": "PV",
  volume: "Volume",
  filesystem: "File System",
  "backup-policy": "Backup Policy",
  "snapshot-policy": "Snapshot Policy",
};

export const EDGE_KIND_LABEL: Record<TopologyEdgeKind, string> = {
  backend: "LB → Instance",
  "waf-lb": "WAF → LB",
  "service-lb": "Service → LB",
  "pv-storage": "PV → Storage",
  "volume-backup": "Volume → Backup Policy",
  "fss-snapshot": "File System → Snapshot Policy",
  route: "Subnet → Gateway",
};

/**
 * エッジ種別の線色。暗色テーマ上で色相だけで見分けられるよう、彩度を抑えつつ色相を離す。
 * 凡例・線・矢印マーカーはすべてここを参照する。
 */
export const EDGE_KIND_COLOR: Record<TopologyEdgeKind, string> = {
  backend: "#7ea6d8",
  "waf-lb": "#d1868f",
  "service-lb": "#7fbf9a",
  "pv-storage": "#cfb173",
  "volume-backup": "#a892d6",
  "fss-snapshot": "#6fb6bd",
  route: "#8b9196",
};

/**
 * 親跨ぎエッジはコンテナノードより高いz-indexでないと親ボックスの下に隠れる。
 * 選択ノードはReact Flow側で+1000されるため、それより上に出る値にする。
 */
export const TOPOLOGY_EDGE_Z_INDEX = 2000;

export const UNPLACED_LABEL = "Unplaced";

export type TopologyFlowVariant = "container" | "resource";

/** ノードが持つハンドルの向き。描画側はこの4方向すべてを非表示ハンドルとして出す。 */
export const TOPOLOGY_SIDES: readonly TopologySide[] = ["top", "right", "bottom", "left"];

export function sourceHandleId(side: TopologySide): string {
  return `s-${side}`;
}

export function targetHandleId(side: TopologySide): string {
  return `t-${side}`;
}

export interface TopologyFlowNodeData {
  variant: TopologyFlowVariant;
  kind?: TopologyNodeKind;
  kindLabel?: string;
  label: string;
  /** コンテナのCIDR。1行に収める都合で先頭CIDR + 残り件数に省略する(全量は詳細パネル) */
  sublabel?: string;
  status: TopologyNodeStatus;
  /** クリックで展開する集約ノードか */
  expandable: boolean;
}

export interface TopologyFlowNode {
  id: string;
  type: TopologyFlowVariant;
  parentId?: string;
  /** parentIdを持つノードは親相対、持たないノードは絶対座標(React Flowの座標系と同じ) */
  position: TopologyPoint;
  width: number;
  height: number;
  data: TopologyFlowNodeData;
}

export interface TopologyFlowEdge {
  id: string;
  source: string;
  target: string;
  /** 相対位置から選んだ接続辺。両端のボックスが向かい合う面を使う */
  sourceSide: TopologySide;
  targetSide: TopologySide;
  sourceHandle: string;
  targetHandle: string;
  /** 障害物を避けた直交折れ線(絶対座標)。描画側はこの点列をそのままSVGパスにする */
  points: TopologyPoint[];
  kind: TopologyEdgeKind;
  label: string;
  color: string;
}

export interface TopologyFlow {
  /** レイアウト出力順(親が子より前)。React Flowはこの順序を要求する */
  nodes: TopologyFlowNode[];
  edges: TopologyFlowEdge[];
}

const CONTAINER_KINDS: ReadonlySet<TopologyNodeKind> = new Set(["vcn", "subnet"]);

/** 1行に収める副題。IPv6併記などで複数あるときは先頭CIDR + 残り件数にする。 */
function cidrSublabel(node: TopologyNode): string | undefined {
  const value = node.detail.find((row) => row.role === "cidr")?.value;
  if (!value) return undefined;
  const cidrs = value.split("\n");
  const head = cidrs[0] as string;
  return cidrs.length > 1 ? `${head} +${cidrs.length - 1}` : head;
}

function dataOf(node: TopologyNode): TopologyFlowNodeData {
  const container = CONTAINER_KINDS.has(node.kind);
  return {
    variant: container ? "container" : "resource",
    kind: node.kind,
    kindLabel: NODE_KIND_LABEL[node.kind],
    label: node.label,
    sublabel: container ? cidrSublabel(node) : undefined,
    status: node.status ?? "unknown",
    expandable: node.kind === "instance-group",
  };
}

const UNPLACED_DATA: TopologyFlowNodeData = {
  variant: "container",
  label: UNPLACED_LABEL,
  status: "unknown",
  expandable: false,
};

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** レイアウトの親相対座標を絶対座標へ展開する(方向判定は絶対座標でないと親跨ぎで狂う)。 */
function absoluteRects(nodes: readonly TopologyLayoutNode[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  // レイアウト出力は親が子より前に並ぶため、1パスで親の絶対座標が引ける。
  for (const placed of nodes) {
    const origin = placed.parentId ? rects.get(placed.parentId) : undefined;
    rects.set(placed.id, {
      x: (origin?.x ?? 0) + placed.position.x,
      y: (origin?.y ?? 0) + placed.position.y,
      width: placed.size.width,
      height: placed.size.height,
    });
  }
  return rects;
}

/** 一方の辺と他方の辺の隙間。重なっていれば0以下。 */
function gapOf(aStart: number, aSize: number, bStart: number, bSize: number): number {
  return Math.max(bStart - (aStart + aSize), aStart - (bStart + bSize));
}

/**
 * source側の接続辺を決める。
 * 片方の軸だけで離れていればその軸を使う(反対の軸へ出すと隣の箱を回り込む遠回りになる)。
 * 両軸で離れている(斜めの位置関係)ときは中心の離れ方が大きい軸を使う。
 */
function sourceSideOf(source: Rect, target: Rect): TopologySide {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  const gapX = gapOf(source.x, source.width, target.x, target.width);
  const gapY = gapOf(source.y, source.height, target.y, target.height);
  const vertical = gapY > 0 && gapX <= 0 ? true : gapX > 0 && gapY <= 0 ? false : Math.abs(dy) >= Math.abs(dx);
  if (vertical) return dy >= 0 ? "bottom" : "top";
  return dx >= 0 ? "right" : "left";
}

const OPPOSITE_SIDE: Record<TopologySide, TopologySide> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

/**
 * グラフ導出とレイアウトの出力を、React Flowへそのまま渡せる形へ合成する。
 * 座標・サイズはレイアウトの値をそのまま使い、measuredに依存しない。
 */
export function toTopologyFlow(graph: TopologyGraph, layout: TopologyLayout): TopologyFlow {
  const graphNodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes: TopologyFlowNode[] = [];
  for (const placed of layout.nodes) {
    const graphNode = graphNodeById.get(placed.id);
    if (!graphNode && !placed.synthetic) continue;
    const data = graphNode ? dataOf(graphNode) : UNPLACED_DATA;
    nodes.push({
      id: placed.id,
      type: data.variant,
      parentId: placed.parentId,
      position: placed.position,
      width: placed.size.width,
      height: placed.size.height,
      data,
    });
  }

  const placedIds = new Set(nodes.map((node) => node.id));
  const rects = absoluteRects(layout.nodes);
  const headerById = new Map(layout.nodes.map((placed) => [placed.id, placed.header]));
  const routeNodes: RouteNode[] = nodes.map((node) => ({
    id: node.id,
    rect: rects.get(node.id) as Rect,
    parentId: node.parentId,
    header: headerById.get(node.id),
  }));

  const edges: TopologyFlowEdge[] = [];
  const routeEdges: RouteEdge[] = [];
  for (const edge of graph.edges) {
    if (!placedIds.has(edge.source) || !placedIds.has(edge.target)) continue;
    const source = rects.get(edge.source) as Rect;
    const target = rects.get(edge.target) as Rect;
    const sourceSide = sourceSideOf(source, target);
    const targetSide = OPPOSITE_SIDE[sourceSide];
    routeEdges.push({ id: edge.id, source: edge.source, target: edge.target, sourceSide, targetSide });
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceSide,
      targetSide,
      sourceHandle: sourceHandleId(sourceSide),
      targetHandle: targetHandleId(targetSide),
      points: [],
      kind: edge.kind,
      label: EDGE_KIND_LABEL[edge.kind],
      color: EDGE_KIND_COLOR[edge.kind],
    });
  }
  const routes = routeTopologyEdges(routeNodes, routeEdges);
  for (const edge of edges) edge.points = routes.get(edge.id) ?? [];
  return { nodes, edges };
}
