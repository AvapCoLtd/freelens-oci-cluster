import { TOPOLOGY_NODE_KINDS, type TopologyEdge, type TopologyNode, type TopologyNodeKind } from "./topology-graph";

export interface TopologyPoint {
  x: number;
  y: number;
}

export interface TopologySize {
  width: number;
  height: number;
}

export interface TopologyLayoutNode {
  id: string;
  /** 配置上の親。グラフのparentIdと異なるのはUnplaced領域の子と親を失ったゲートウェイだけ */
  parentId?: string;
  /** parentIdを持つノードは親ボックス左上からの相対座標、持たないノードは絶対座標 */
  position: TopologyPoint;
  size: TopologySize;
  /** グラフに対応ノードが無い配置専用コンテナ(Unplaced領域)か */
  synthetic: boolean;
  /** コンテナ見出し帯の高さ。エッジのルーティングがここを水平に横切らないための情報 */
  header?: number;
}

export interface TopologyLayout {
  /** 深さ昇順・同深さはid昇順(React Flowのnodes配列は親が子より前にある必要がある) */
  nodes: TopologyLayoutNode[];
  size: TopologySize;
}

/** 配置根拠が解決できないInstance/LBを集める配置専用コンテナのid。 */
export const UNPLACED_REGION_ID = "topology-unplaced";

/** 親を持たないときにUnplaced領域へ入る種別。 */
const UNPLACED_KINDS: ReadonlySet<TopologyNodeKind> = new Set(["instance", "instance-group", "lb", "nlb"]);

/** 左レーンでVCNより上に積む帯。上から順にトラフィックが降りる並び。 */
const TRAFFIC_BANDS: readonly TopologyNodeKind[] = ["k8s-service", "waf"];
const TRAFFIC_KINDS: ReadonlySet<TopologyNodeKind> = new Set(TRAFFIC_BANDS);

/** 右レーンへ回す種別。VCN側とはエッジで繋がらない独立成分。 */
const STORAGE_KINDS: ReadonlySet<TopologyNodeKind> = new Set([
  "k8s-pv",
  "volume",
  "filesystem",
  "backup-policy",
  "snapshot-policy",
]);

const LEAF_SIZE: Record<TopologyNodeKind, TopologySize> = {
  vcn: { width: 240, height: 120 },
  subnet: { width: 200, height: 100 },
  // 種別チップ(12px)+本文(16px)+行間2+上下パディング12で42px要る。40だと本文が下端で切れる。
  "subnet-summary": { width: 168, height: 52 },
  "instance-group": { width: 168, height: 56 },
  instance: { width: 168, height: 56 },
  lb: { width: 184, height: 56 },
  nlb: { width: 184, height: 56 },
  gateway: { width: 152, height: 48 },
  waf: { width: 168, height: 48 },
  "k8s-service": { width: 184, height: 48 },
  "k8s-pv": { width: 184, height: 48 },
  volume: { width: 168, height: 48 },
  filesystem: { width: 168, height: 48 },
  "backup-policy": { width: 184, height: 48 },
  "snapshot-policy": { width: 184, height: 48 },
};

interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// topはコンテナ見出し(種別・名前・CIDRの3行)の帯。子はこの内側にだけ置く。
// 帯を詰めると見出しが先頭行の子ボックスに潜り込む。
const CONTAINER_HEADER = 58;
// VCNは外から入るエッジ(WAF/Service/PV)が枠を跨ぐ。見出し帯の下と四辺にエッジの通り道を空ける。
const VCN_PADDING: Padding = { top: CONTAINER_HEADER + 40, right: 56, bottom: 56, left: 56 };
const SUBNET_PADDING: Padding = { top: CONTAINER_HEADER + 16, right: 32, bottom: 32, left: 32 };
const UNPLACED_PADDING: Padding = { top: 52, right: 28, bottom: 28, left: 28 };
const UNPLACED_HEADER = 28;

/**
 * 箱の間に空けるエッジのコリドー。
 * 深い階層ほど短いエッジしか通らないため、外側ほど広く取る。
 */
interface Gap {
  x: number;
  y: number;
}

/** 左レーン(トラフィック)と右レーン(ストレージ)の間。レーンを跨ぐエッジは無く、読み分けの余白。 */
const LANE_GAP = 120;
/** レーンの中の行間・ノード間。 */
const LANE_INNER_GAP: Gap = { x: 48, y: 56 };
const VCN_GAP: Gap = { x: 88, y: 80 };
const SUBNET_GAP: Gap = { x: 56, y: 48 };
const UNPLACED_GAP: Gap = { x: 40, y: 32 };

/** 帯を横長に保つ目安の縦横比。列数はこの比になる折り返し幅から決まる。 */
const BAND_ASPECT = 2.4;
const MIN_BAND_WIDTH = 560;

const MIN_CONTENT: TopologySize = { width: 168, height: 40 };
const MAX_COLUMNS = 4;

const KIND_ORDER = new Map<TopologyNodeKind, number>(TOPOLOGY_NODE_KINDS.map((kind, index) => [kind, index]));

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNodes(a: TopologyNode, b: TopologyNode): number {
  const byKind = (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0);
  return byKind !== 0 ? byKind : compareText(a.id, b.id);
}

interface Box {
  id: string;
  synthetic: boolean;
  size: TopologySize;
  position: TopologyPoint;
  children: Box[];
  header?: number;
}

function columnsFor(count: number): number {
  return Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(count))));
}

function chunk(boxes: Box[], columns: number): Box[][] {
  const rows: Box[][] = [];
  for (let index = 0; index < boxes.length; index += columns) rows.push(boxes.slice(index, index + columns));
  return rows;
}

/** 行を上から順に、行内は左から順に詰める。行高は行内の最大高で、行同士・兄弟同士は重ならない。 */
function placeRows(rows: Box[][], origin: TopologyPoint, gap: Gap): TopologySize {
  let width = 0;
  let y = origin.y;
  for (const row of rows) {
    let x = origin.x;
    let rowHeight = 0;
    for (const box of row) {
      box.position = { x, y };
      x += box.size.width + gap.x;
      rowHeight = Math.max(rowHeight, box.size.height);
    }
    width = Math.max(width, x - gap.x - origin.x);
    y += rowHeight + gap.y;
  }
  return {
    width: Math.max(width, MIN_CONTENT.width),
    height: Math.max(y - gap.y - origin.y, MIN_CONTENT.height),
  };
}

function gridRows(boxes: Box[]): Box[][] {
  return chunk(boxes, columnsFor(boxes.length));
}

function container(id: string, synthetic: boolean, padding: Padding, gap: Gap, rows: Box[][], header: number): Box {
  const content = placeRows(rows, { x: padding.left, y: padding.top }, gap);
  return {
    id,
    synthetic,
    size: {
      width: padding.left + content.width + padding.right,
      height: padding.top + content.height + padding.bottom,
    },
    position: { x: 0, y: 0 },
    children: rows.flat(),
    header,
  };
}

function leaf(node: TopologyNode): Box {
  return { id: node.id, synthetic: false, size: LEAF_SIZE[node.kind], position: { x: 0, y: 0 }, children: [] };
}

interface Lane {
  boxes: Box[];
  size: TopologySize;
}

/** 折り返し幅。箱の総面積からBAND_ASPECTの横長になる幅を逆算し、数十ノードでも縦長の疎格子にしない。 */
function bandWidth(boxes: readonly Box[], floor: number): number {
  let total = 0;
  let tallest = 0;
  for (const box of boxes) {
    total += box.size.width + LANE_INNER_GAP.x;
    tallest = Math.max(tallest, box.size.height);
  }
  return Math.max(floor, Math.sqrt(total * (tallest + LANE_INNER_GAP.y) * BAND_ASPECT));
}

function wrapRows(boxes: readonly Box[], maxWidth: number): Box[][] {
  const rows: Box[][] = [];
  let row: Box[] = [];
  let width = 0;
  for (const box of boxes) {
    const grown = row.length === 0 ? box.size.width : width + LANE_INNER_GAP.x + box.size.width;
    if (row.length > 0 && grown > maxWidth) {
      rows.push(row);
      row = [box];
      width = box.size.width;
      continue;
    }
    row.push(box);
    width = grown;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * 行を上から積む。centeredなら各行をレーン幅の中央へ寄せる。
 * placeRowsの戻り値はMIN_CONTENTで底上げされるため、レーンの実寸は測り直す。
 */
function lane(rows: Box[][], centered: boolean): Lane {
  const filled = rows.filter((row) => row.length > 0);
  const boxes = filled.flat();
  if (boxes.length === 0) return { boxes, size: { width: 0, height: 0 } };
  placeRows(filled, { x: 0, y: 0 }, LANE_INNER_GAP);
  let width = 0;
  let height = 0;
  for (const box of boxes) {
    width = Math.max(width, box.position.x + box.size.width);
    height = Math.max(height, box.position.y + box.size.height);
  }
  if (centered) {
    for (const row of filled) {
      const last = row[row.length - 1] as Box;
      const shift = Math.round((width - (last.position.x + last.size.width)) / 2);
      for (const box of row) box.position = { x: box.position.x + shift, y: box.position.y };
    }
  }
  return { boxes, size: { width, height } };
}

/**
 * ストレージの鎖(PV→Volume/FSS→ポリシー)を1本1行に切り出す。
 * 既に別の行へ置いたノードは辿り直さない(共有ポリシーは最初の行にだけ現れる)。
 * 起点も後続も入力順(kind→id昇順)で選ぶため、edgesの並びに依らず同一結果になる。
 */
function storageChains(members: readonly TopologyNode[], edges: readonly TopologyEdge[]): TopologyNode[][] {
  const rank = new Map(members.map((node, at) => [node.id, at]));
  const nextOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (!rank.has(edge.source) || !rank.has(edge.target) || edge.source === edge.target) continue;
    addTo(nextOf, edge.source, edge.target);
  }
  for (const list of nextOf.values()) {
    list.sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number));
  }
  const byId = new Map(members.map((node) => [node.id, node]));
  const placed = new Set<string>();
  const chains: TopologyNode[][] = [];
  for (const start of members) {
    if (placed.has(start.id)) continue;
    const chain: TopologyNode[] = [];
    let current: string | undefined = start.id;
    while (current && !placed.has(current)) {
      placed.add(current);
      chain.push(byId.get(current) as TopologyNode);
      current = (nextOf.get(current) ?? []).find((id) => !placed.has(id));
    }
    chains.push(chain);
  }
  return chains;
}

function addTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
    return;
  }
  map.set(key, [value]);
}

/**
 * 包含構造(parentId)から座標と親ボックスサイズを決める。
 * edgesは帯の中の並び順にだけ使う(繋がるノードを隣接させる)。
 * 入力配列の順序に依らず同一結果を返し、子は必ず親の内側(パディング込み)に収まる。
 */
export function layoutTopology(nodes: readonly TopologyNode[], edges: readonly TopologyEdge[] = []): TopologyLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, TopologyNode[]>();
  const addChild = (parentId: string, node: TopologyNode) => {
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(node);
    else childrenOf.set(parentId, [node]);
  };
  const roots: TopologyNode[] = [];
  for (const node of [...nodes].sort(compareNodes)) {
    const parentId = node.parentId && byId.has(node.parentId) ? node.parentId : undefined;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    addChild(parentId, node);
  }

  const vcnNodes = roots.filter((node) => node.kind === "vcn");
  // ゲートウェイはVCN内・Subnet外が設計。親未解決のまま最上位へ落とすとVCNボックスの外へ描かれる。
  if (vcnNodes.length === 1) {
    const vcnId = (vcnNodes[0] as TopologyNode).id;
    for (const node of roots.filter((node) => node.kind === "gateway")) addChild(vcnId, node);
  }
  const placedAtRoot = (node: TopologyNode) => node.kind !== "gateway" || vcnNodes.length !== 1;

  /** VCN直下の並び順。エッジで繋がる箱を近づけるため、LB/NLB持ち→Instance持ち→残りのSubnetの順に置く。 */
  const subnetRank = (node: TopologyNode): number => {
    if (node.kind !== "subnet") return 3;
    const children = childrenOf.get(node.id) ?? [];
    if (children.some((child) => child.kind === "lb" || child.kind === "nlb")) return 0;
    if (children.some((child) => child.kind === "instance" || child.kind === "instance-group")) return 1;
    return 2;
  };

  const buildBox = (node: TopologyNode): Box => {
    const children = childrenOf.get(node.id) ?? [];
    if (node.kind === "vcn") {
      const gateways = children.filter((child) => child.kind === "gateway").sort(compareNodes);
      const rest = [...children]
        .filter((child) => child.kind !== "gateway")
        .sort((a, b) => subnetRank(a) - subnetRank(b) || compareNodes(a, b));
      // ゲートウェイはSubnetの格子に混ぜず最下行にまとめる
      const rows = [...gridRows(rest.map(buildBox)), ...chunk(gateways.map(buildBox), MAX_COLUMNS)];
      return container(node.id, false, VCN_PADDING, VCN_GAP, rows, CONTAINER_HEADER);
    }
    if (node.kind === "subnet")
      return container(node.id, false, SUBNET_PADDING, SUBNET_GAP, gridRows(children.map(buildBox)), CONTAINER_HEADER);
    return leaf(node);
  };

  const isExternal = (node: TopologyNode) =>
    node.kind !== "vcn" && !UNPLACED_KINDS.has(node.kind) && placedAtRoot(node);

  const vcnBoxes = vcnNodes.map(buildBox);
  const floor = Math.max(MIN_BAND_WIDTH, ...vcnBoxes.map((box) => box.size.width));
  const bandRows = (accept: (node: TopologyNode) => boolean): Box[][] => {
    const boxes = roots.filter(accept).map(buildBox);
    return boxes.length === 0 ? [] : wrapRows(boxes, bandWidth(boxes, floor));
  };

  const leftRows: Box[][] = [];
  for (const kind of TRAFFIC_BANDS) leftRows.push(...bandRows((node) => isExternal(node) && node.kind === kind));
  leftRows.push(...vcnBoxes.map((box) => [box]));
  leftRows.push(
    ...bandRows((node) => isExternal(node) && !TRAFFIC_KINDS.has(node.kind) && !STORAGE_KINDS.has(node.kind)),
  );
  const left = lane(leftRows, true);

  const storageNodes = roots.filter((node) => isExternal(node) && STORAGE_KINDS.has(node.kind));
  const rightRows: Box[][] = storageChains(storageNodes, edges).map((chain) => chain.map(buildBox));
  const unplaced = roots.filter((node) => UNPLACED_KINDS.has(node.kind)).map(buildBox);
  if (unplaced.length > 0) {
    rightRows.push([
      container(UNPLACED_REGION_ID, true, UNPLACED_PADDING, UNPLACED_GAP, gridRows(unplaced), UNPLACED_HEADER),
    ]);
  }
  const right = lane(rightRows, false);

  const rightX = left.boxes.length > 0 ? left.size.width + LANE_GAP : 0;
  // 右レーンの上端はVCNの上端に揃える。0にするとトラフィック帯の横へ回り込む。
  const rightY = vcnBoxes.length > 0 ? Math.min(...vcnBoxes.map((box) => box.position.y)) : 0;
  for (const box of right.boxes) box.position = { x: box.position.x + rightX, y: box.position.y + rightY };
  const size =
    right.boxes.length > 0
      ? { width: rightX + right.size.width, height: Math.max(left.size.height, rightY + right.size.height) }
      : { width: left.size.width, height: left.size.height };

  const layoutNodes: TopologyLayoutNode[] = [];
  let level: { box: Box; parentId?: string }[] = [...left.boxes, ...right.boxes].map((box) => ({ box }));
  while (level.length > 0) {
    const next: { box: Box; parentId?: string }[] = [];
    for (const { box, parentId } of [...level].sort((a, b) => compareText(a.box.id, b.box.id))) {
      layoutNodes.push({
        id: box.id,
        parentId,
        position: box.position,
        size: box.size,
        synthetic: box.synthetic,
        header: box.header,
      });
      for (const child of box.children) next.push({ box: child, parentId: box.id });
    }
    level = next;
  }
  return { nodes: layoutNodes, size };
}
