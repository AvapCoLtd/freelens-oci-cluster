import type { TopologyPoint } from "./topology-layout";

export type TopologySide = "top" | "right" | "bottom" | "left";

export interface RouteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouteNode {
  id: string;
  /** 絶対座標の矩形 */
  rect: RouteRect;
  /** 包含の親。自分と相手の祖先だけは障害物から外す(跨いで出入りするため) */
  parentId?: string;
  /** コンテナ見出し帯の高さ。ここを水平に横切ると見出し文字と重なる */
  header?: number;
}

export interface RouteEdge {
  id: string;
  source: string;
  target: string;
  sourceSide: TopologySide;
  targetSide: TopologySide;
}

/** 障害物矩形を膨らませる余白。箱の辺すれすれを通路として選ばせない。 */
const CLEARANCE = 4;
/** 端点から最初の折れ点までの距離。 */
const STUB = 10;
/** 通路をレーンへ刻む間隔。 */
const LANE_PITCH = 16;
/** 1つの通路に刻むレーンの上限。増やすほど格子が膨らむ。 */
const MAX_LANES = 5;
const TURN_COST = 24;
/** 他のエッジが使った線分を再利用する代価。レーンを1本ずらす代価より十分大きくする。 */
const REUSE_COST = 400;
/** コンテナ見出し帯を水平に横切る代価。 */
const HEADER_COST = 600;
/** 格子の上限セル数。超えたらスタブ直結へ落とす。 */
const MAX_GRID_CELLS = 250_000;

const HORIZONTAL = 0;
const VERTICAL = 1;

interface Obstacle {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function inflate(rect: RouteRect): Obstacle {
  return {
    x0: rect.x - CLEARANCE,
    x1: rect.x + rect.width + CLEARANCE,
    y0: rect.y - CLEARANCE,
    y1: rect.y + rect.height + CLEARANCE,
  };
}

function isVerticalSide(side: TopologySide): boolean {
  return side === "top" || side === "bottom";
}

/** values は昇順。value 未満の要素数。 */
function countBelow(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((values[mid] as number) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** values は昇順。value 以下の要素数。 */
function countAtMost(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((values[mid] as number) <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * 箱の境界を通路の壁とみなし、壁の外側・壁と壁の間のレーンを格子線として並べる。
 * ports は端点の座標で、これが格子線に無いと出入りのスタブが格子へ繋がらない。
 */
function axisLines(bounds: readonly number[], ports: readonly number[]): number[] {
  const walls = [...new Set(bounds.map((value) => Math.round(value)))].sort((a, b) => a - b);
  const lines = new Set<number>(walls);
  for (const wall of walls) {
    lines.add(wall - STUB);
    lines.add(wall + STUB);
  }
  for (let at = 0; at + 1 < walls.length; at += 1) {
    const from = walls[at] as number;
    const span = (walls[at + 1] as number) - from;
    const lanes = Math.min(MAX_LANES, Math.floor(span / LANE_PITCH) - 1);
    for (let lane = 0; lane < lanes; lane += 1) lines.add(Math.round(from + (span * (lane + 1)) / (lanes + 1)));
  }
  for (const port of ports) lines.add(Math.round(port));
  return [...lines].sort((a, b) => a - b);
}

type Block = readonly [number, number, number, number];

/** 矩形群の被覆数を2次元の差分和で数える。out[a * sizeB + b] が (a, b) の被覆数。 */
function coverage(sizeA: number, sizeB: number, blocks: readonly Block[]): Int32Array {
  const stride = sizeB + 1;
  const diff = new Int32Array((sizeA + 1) * stride);
  for (const [a0, a1, b0, b1] of blocks) {
    if (a0 >= a1 || b0 >= b1) continue;
    diff[a0 * stride + b0] += 1;
    diff[a1 * stride + b0] -= 1;
    diff[a0 * stride + b1] -= 1;
    diff[a1 * stride + b1] += 1;
  }
  for (let a = 0; a <= sizeA; a += 1) {
    for (let b = 0; b <= sizeB; b += 1) {
      const at = a * stride + b;
      if (a > 0) diff[at] += diff[at - stride] as number;
      if (b > 0) diff[at] += diff[at - 1] as number;
      if (a > 0 && b > 0) diff[at] -= diff[at - stride - 1] as number;
    }
  }
  const out = new Int32Array(Math.max(0, sizeA * sizeB));
  for (let a = 0; a < sizeA; a += 1) {
    for (let b = 0; b < sizeB; b += 1) out[a * sizeB + b] = diff[a * stride + b] as number;
  }
  return out;
}

interface Heap {
  keys: number[];
  values: number[];
}

function heapPush(heap: Heap, key: number, value: number): void {
  let at = heap.keys.length;
  heap.keys.push(key);
  heap.values.push(value);
  while (at > 0) {
    const parent = (at - 1) >> 1;
    if ((heap.keys[parent] as number) <= (heap.keys[at] as number)) break;
    [heap.keys[parent], heap.keys[at]] = [heap.keys[at] as number, heap.keys[parent] as number];
    [heap.values[parent], heap.values[at]] = [heap.values[at] as number, heap.values[parent] as number];
    at = parent;
  }
}

function heapPop(heap: Heap): number {
  const top = heap.values[0] as number;
  const key = heap.keys.pop() as number;
  const value = heap.values.pop() as number;
  if (heap.keys.length > 0) {
    heap.keys[0] = key;
    heap.values[0] = value;
    let at = 0;
    for (;;) {
      const left = at * 2 + 1;
      const right = left + 1;
      let best = at;
      if (left < heap.keys.length && (heap.keys[left] as number) < (heap.keys[best] as number)) best = left;
      if (right < heap.keys.length && (heap.keys[right] as number) < (heap.keys[best] as number)) best = right;
      if (best === at) break;
      [heap.keys[best], heap.keys[at]] = [heap.keys[at] as number, heap.keys[best] as number];
      [heap.values[best], heap.values[at]] = [heap.values[at] as number, heap.values[best] as number];
      at = best;
    }
  }
  return top;
}

function pushEntry(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function compareId(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 直交折れ線から一直線に並ぶ中間点を落とす。 */
function simplify(points: readonly TopologyPoint[]): TopologyPoint[] {
  const out: TopologyPoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = out[out.length - 2];
    if (last && before) {
      const straightX = before.x === last.x && last.x === point.x;
      const straightY = before.y === last.y && last.y === point.y;
      if (straightX || straightY) {
        out[out.length - 1] = point;
        continue;
      }
    }
    out.push(point);
  }
  return out;
}

/**
 * ノード矩形を障害物とみなし、エッジごとに直交の折れ線経路を決める。
 * 出力は絶対座標の点列(先頭がsource側の接続点、末尾がtarget側の接続点)で、id順に決定論。
 */
export function routeTopologyEdges(
  nodes: readonly RouteNode[],
  edges: readonly RouteEdge[],
): Map<string, TopologyPoint[]> {
  const routes = new Map<string, TopologyPoint[]>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ordered = edges
    .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target) && edge.source !== edge.target)
    .sort((a, b) => compareId(a.id, b.id));
  if (ordered.length === 0) return routes;

  const slots = new Map<string, string[]>();
  for (const edge of ordered) {
    pushEntry(slots, `${edge.source}|${edge.sourceSide}`, edge.id);
    pushEntry(slots, `${edge.target}|${edge.targetSide}`, edge.id);
  }
  /** 同じ辺に集まるエッジを辺上へ等間隔に散らす。1点に束ねると根元が1本に見える。 */
  const portOf = (nodeId: string, side: TopologySide, edgeId: string): TopologyPoint => {
    const rect = (nodeById.get(nodeId) as RouteNode).rect;
    const members = slots.get(`${nodeId}|${side}`) as string[];
    const ratio = (members.indexOf(edgeId) + 1) / (members.length + 1);
    if (side === "top") return { x: Math.round(rect.x + rect.width * ratio), y: Math.round(rect.y) };
    if (side === "bottom") return { x: Math.round(rect.x + rect.width * ratio), y: Math.round(rect.y + rect.height) };
    if (side === "left") return { x: Math.round(rect.x), y: Math.round(rect.y + rect.height * ratio) };
    return { x: Math.round(rect.x + rect.width), y: Math.round(rect.y + rect.height * ratio) };
  };
  const stubOf = (port: TopologyPoint, side: TopologySide): TopologyPoint => {
    if (side === "top") return { x: port.x, y: port.y - STUB };
    if (side === "bottom") return { x: port.x, y: port.y + STUB };
    if (side === "left") return { x: port.x - STUB, y: port.y };
    return { x: port.x + STUB, y: port.y };
  };

  const legs = ordered.map((edge) => {
    const from = portOf(edge.source, edge.sourceSide, edge.id);
    const to = portOf(edge.target, edge.targetSide, edge.id);
    return { edge, from, to, fromStub: stubOf(from, edge.sourceSide), toStub: stubOf(to, edge.targetSide) };
  });

  const xBounds: number[] = [];
  const yBounds: number[] = [];
  for (const node of nodes) {
    xBounds.push(node.rect.x, node.rect.x + node.rect.width);
    yBounds.push(node.rect.y, node.rect.y + node.rect.height);
  }
  const xPorts: number[] = [];
  const yPorts: number[] = [];
  for (const leg of legs) {
    xPorts.push(leg.from.x, leg.to.x, leg.fromStub.x, leg.toStub.x);
    yPorts.push(leg.from.y, leg.to.y, leg.fromStub.y, leg.toStub.y);
  }
  const xs = axisLines(xBounds, xPorts);
  const ys = axisLines(yBounds, yPorts);
  const nx = xs.length;
  const ny = ys.length;
  if (nx < 2 || ny < 2 || nx * ny > MAX_GRID_CELLS) {
    for (const leg of legs) routes.set(leg.edge.id, simplify([leg.from, leg.fromStub, leg.toStub, leg.to]));
    return routes;
  }
  const xAt = new Map(xs.map((value, index) => [value, index]));
  const yAt = new Map(ys.map((value, index) => [value, index]));

  const horizontalBlocks: Block[] = [];
  const verticalBlocks: Block[] = [];
  const headerBlocks: Block[] = [];
  for (const node of nodes) {
    const box = inflate(node.rect);
    // 水平移動は「線が矩形の内側を通る」かつ「セルが矩形と重なる」とき塞がれる。
    horizontalBlocks.push([
      Math.max(0, countAtMost(xs, box.x0) - 1),
      Math.min(nx - 1, countBelow(xs, box.x1)),
      countAtMost(ys, box.y0),
      countBelow(ys, box.y1),
    ]);
    verticalBlocks.push([
      countAtMost(xs, box.x0),
      countBelow(xs, box.x1),
      Math.max(0, countAtMost(ys, box.y0) - 1),
      Math.min(ny - 1, countBelow(ys, box.y1)),
    ]);
    if (!node.header) continue;
    headerBlocks.push([
      Math.max(0, countAtMost(xs, node.rect.x) - 1),
      Math.min(nx - 1, countBelow(xs, node.rect.x + node.rect.width)),
      countAtMost(ys, node.rect.y),
      countBelow(ys, node.rect.y + node.header),
    ]);
  }
  const horizontalWalls = coverage(nx - 1, ny, horizontalBlocks);
  const verticalWalls = coverage(nx, ny - 1, verticalBlocks);
  const headerWalls = coverage(nx - 1, ny, headerBlocks);
  const usedHorizontal = new Uint8Array(Math.max(0, (nx - 1) * ny));
  const usedVertical = new Uint8Array(Math.max(0, nx * (ny - 1)));

  const stateCount = nx * ny * 2;
  const score = new Float64Array(stateCount);
  const cameFrom = new Int32Array(stateCount);
  const seen = new Int32Array(stateCount);
  const done = new Int32Array(stateCount);
  const heap: Heap = { keys: [], values: [] };
  let generation = 0;

  const ancestorsOf = (id: string, into: Set<string>) => {
    let current = nodeById.get(id)?.parentId;
    while (current && !into.has(current)) {
      into.add(current);
      current = nodeById.get(current)?.parentId;
    }
  };

  /** 経路が横切る単位線分をエッジの占有として記録する。次のエッジはこれを避けてレーンを分ける。 */
  const walkRun = (from: number, to: number, fixed: number, vertical: boolean, mark: boolean): boolean => {
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    for (let at = low; at < high; at += 1) {
      const index = vertical ? fixed * (ny - 1) + at : at * ny + fixed;
      const used = vertical ? usedVertical : usedHorizontal;
      if (mark) used[index] = 1;
      else if (used[index] === 1) return true;
    }
    return false;
  };

  for (const leg of legs) {
    generation += 1;
    const skip: Obstacle[] = [];
    const excluded = new Set<string>([leg.edge.source, leg.edge.target]);
    ancestorsOf(leg.edge.source, excluded);
    ancestorsOf(leg.edge.target, excluded);
    for (const id of excluded) {
      const node = nodeById.get(id);
      if (node) skip.push(inflate(node.rect));
    }

    const freeHorizontal = (cell: number, line: number): boolean => {
      let walls = horizontalWalls[cell * ny + line] as number;
      if (walls === 0) return true;
      const y = ys[line] as number;
      const left = xs[cell] as number;
      const right = xs[cell + 1] as number;
      for (const box of skip) {
        if (box.y0 < y && y < box.y1 && left < box.x1 && box.x0 < right) walls -= 1;
      }
      return walls <= 0;
    };
    const freeVertical = (line: number, cell: number): boolean => {
      let walls = verticalWalls[line * (ny - 1) + cell] as number;
      if (walls === 0) return true;
      const x = xs[line] as number;
      const top = ys[cell] as number;
      const bottom = ys[cell + 1] as number;
      for (const box of skip) {
        if (box.x0 < x && x < box.x1 && top < box.y1 && box.y0 < bottom) walls -= 1;
      }
      return walls <= 0;
    };

    const fromI = xAt.get(leg.from.x) as number;
    const fromJ = yAt.get(leg.from.y) as number;
    const toI = xAt.get(leg.to.x) as number;
    const toJ = yAt.get(leg.to.y) as number;
    const startI = xAt.get(leg.fromStub.x) as number;
    const startJ = yAt.get(leg.fromStub.y) as number;
    const goalI = xAt.get(leg.toStub.x) as number;
    const goalJ = yAt.get(leg.toStub.y) as number;
    const startDir = isVerticalSide(leg.edge.sourceSide) ? VERTICAL : HORIZONTAL;
    const goalDir = isVerticalSide(leg.edge.targetSide) ? VERTICAL : HORIZONTAL;

    const search = (avoidUsed: boolean): TopologyPoint[] | undefined => {
      if (avoidUsed) {
        const sourceStubTaken = isVerticalSide(leg.edge.sourceSide)
          ? walkRun(fromJ, startJ, fromI, true, false)
          : walkRun(fromI, startI, fromJ, false, false);
        const targetStubTaken = isVerticalSide(leg.edge.targetSide)
          ? walkRun(toJ, goalJ, toI, true, false)
          : walkRun(toI, goalI, toJ, false, false);
        if (sourceStubTaken || targetStubTaken) return undefined;
      }
      generation += 1;
      heap.keys.length = 0;
      heap.values.length = 0;
      const goalX = xs[goalI] as number;
      const goalY = ys[goalJ] as number;
      const start = (startI * ny + startJ) * 2 + startDir;
      const goal = (goalI * ny + goalJ) * 2 + goalDir;
      score[start] = 0;
      seen[start] = generation;
      cameFrom[start] = -1;
      heapPush(heap, Math.abs((xs[startI] as number) - goalX) + Math.abs((ys[startJ] as number) - goalY), start);
      let found = false;
      while (heap.values.length > 0) {
        const state = heapPop(heap);
        if (done[state] === generation) continue;
        done[state] = generation;
        if (state === goal) {
          found = true;
          break;
        }
        const dir = state & 1;
        const cell = state >> 1;
        const i = (cell / ny) | 0;
        const j = cell % ny;
        const base = score[state] as number;
        for (let move = 0; move < 4; move += 1) {
          const nextI = move === 0 ? i - 1 : move === 1 ? i + 1 : i;
          const nextJ = move === 2 ? j - 1 : move === 3 ? j + 1 : j;
          if (nextI < 0 || nextI >= nx || nextJ < 0 || nextJ >= ny) continue;
          const nextDir = move < 2 ? HORIZONTAL : VERTICAL;
          const segment = move < 2 ? Math.min(i, nextI) * ny + j : i * (ny - 1) + Math.min(j, nextJ);
          if (move < 2 ? !freeHorizontal(Math.min(i, nextI), j) : !freeVertical(i, Math.min(j, nextJ))) continue;
          const taken = (move < 2 ? usedHorizontal[segment] : usedVertical[segment]) === 1;
          if (taken && avoidUsed) continue;
          let cost =
            move < 2
              ? Math.abs((xs[nextI] as number) - (xs[i] as number))
              : Math.abs((ys[nextJ] as number) - (ys[j] as number));
          if (nextDir !== dir) cost += TURN_COST;
          if (taken) cost += REUSE_COST;
          if (move < 2 && (headerWalls[segment] as number) > 0) cost += HEADER_COST;
          const next = (nextI * ny + nextJ) * 2 + nextDir;
          const total = base + cost;
          if (seen[next] === generation && (score[next] as number) <= total) continue;
          seen[next] = generation;
          score[next] = total;
          cameFrom[next] = state;
          heapPush(
            heap,
            total + Math.abs((xs[nextI] as number) - goalX) + Math.abs((ys[nextJ] as number) - goalY),
            next,
          );
        }
      }
      if (!found) return undefined;
      const reversed: TopologyPoint[] = [];
      for (let state = goal; state >= 0; state = cameFrom[state] as number) {
        const cell = state >> 1;
        reversed.push({ x: xs[(cell / ny) | 0] as number, y: ys[cell % ny] as number });
      }
      reversed.reverse();
      return simplify([leg.from, ...reversed, leg.to]);
    };

    const points = search(true) ?? search(false) ?? simplify([leg.from, leg.fromStub, leg.toStub, leg.to]);
    routes.set(leg.edge.id, points);
    for (let at = 0; at + 1 < points.length; at += 1) {
      const a = points[at] as TopologyPoint;
      const b = points[at + 1] as TopologyPoint;
      if (a.x === b.x) {
        const line = xAt.get(a.x);
        const low = yAt.get(a.y);
        const high = yAt.get(b.y);
        if (line !== undefined && low !== undefined && high !== undefined) walkRun(low, high, line, true, true);
      } else {
        const line = yAt.get(a.y);
        const low = xAt.get(a.x);
        const high = xAt.get(b.x);
        if (line !== undefined && low !== undefined && high !== undefined) walkRun(low, high, line, false, true);
      }
    }
  }
  return routes;
}
