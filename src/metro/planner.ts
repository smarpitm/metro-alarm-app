import { NetworkData } from './data';
import { GraphEdge, buildGraph } from './graph';

export interface Leg {
  lineId: string;
  lineName: string;
  boardId: string;
  boardName: string;
  alightId: string;
  alightName: string;
  stations: { id: string; name: string }[];
  timeS: number;
}

export interface Plan {
  legs: Leg[];
  /** total seconds including all transfer penalties */
  timeS: number;
  changes: number;
  stationCount: number;
}

export type PlanMode = 'fastest' | 'leastChanges';

interface Cost {
  time: number;
  changes: number;
}

function wins(a: Cost, b: Cost, mode: PlanMode): boolean {
  if (mode === 'fastest') {
    return a.time < b.time;
  }
  // lexicographic: fewer changes first, then fastest
  return a.changes !== b.changes ? a.changes < b.changes : a.time < b.time;
}

/**
 * ponytail: queue is an O(n^2) linear scan; node count for the whole network
 * is < 300 so this holds. Swap in a binary heap only if the graph grows 10x.
 */
export function plan(
  network: NetworkData,
  originId: string,
  destId: string,
  mode: PlanMode,
): Plan | null {
  if (originId === destId) {
    return { legs: [], timeS: 0, changes: 0, stationCount: 1 };
  }

  const graph = buildGraph(network);
  const dist = new Map<string, Cost>();
  const prev = new Map<string, { from: string; edge: GraphEdge }>();
  const done = new Set<string>();
  const queue: { node: string; cost: Cost }[] = [];

  // seed every node at the origin station (could be several if interchanges)
  for (const node of graph.nodes.values()) {
    if (node.stationId === originId) {
      const zero = { time: 0, changes: 0 };
      dist.set(node.key, zero);
      queue.push({ node: node.key, cost: zero });
    }
  }

  while (queue.length > 0) {
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (wins(queue[i].cost, queue[best].cost, mode)) {
        best = i;
      }
    }
    const { node, cost } = queue.splice(best, 1)[0];
    if (done.has(node)) {
      continue;
    }
    done.add(node);

    for (const edge of graph.adj.get(node) ?? []) {
      const changes = cost.changes + (edge.transfer && !edge.sameLine ? 1 : 0);
      const cand: Cost = { time: cost.time + edge.timeS, changes };
      const cur = dist.get(edge.to);
      if (!cur || wins(cand, cur, mode)) {
        dist.set(edge.to, cand);
        prev.set(edge.to, { from: node, edge });
        queue.push({ node: edge.to, cost: cand });
      }
    }
  }

  // pick best goal among nodes at the destination station
  let goalKey: string | null = null;
  let goalCost: Cost | null = null;
  for (const node of graph.nodes.values()) {
    if (node.stationId === destId) {
      const c = dist.get(node.key);
      if (c && (!goalCost || wins(c, goalCost, mode))) {
        goalKey = node.key;
        goalCost = c;
      }
    }
  }
  if (!goalKey || !goalCost) {
    return null;
  }

  // walk parent pointers back to a seeded origin node
  const nodeKeys: string[] = [goalKey];
  const edgeList: GraphEdge[] = [];
  let cur: string = goalKey;
  while (true) {
    const p = prev.get(cur);
    if (!p) {
      break;
    }
    nodeKeys.unshift(p.from);
    edgeList.unshift(p.edge);
    cur = p.from;
  }

  // split path into legs at real (cross-line) transfers
  const legs: Leg[] = [];
  let chunkStart = 0;
  let chunkTime = 0;
  const flush = (endIdx: number) => {
    const chunk = nodeKeys.slice(chunkStart, endIdx + 1).map(k => graph.nodes.get(k)!);
    // dedupe consecutive duplicates (branch junction is one physical station)
    const stations: { id: string; name: string }[] = [];
    for (const n of chunk) {
      const last = stations[stations.length - 1];
      if (!last || last.id !== n.stationId) {
        stations.push({ id: n.stationId, name: n.name });
      }
    }
    const first = chunk[0];
    const lastNode = chunk[chunk.length - 1];
    legs.push({
      lineId: first.lineId,
      lineName: lineNames.get(first.lineId) ?? first.lineId,
      boardId: first.stationId,
      boardName: first.name,
      alightId: lastNode.stationId,
      alightName: lastNode.name,
      stations,
      timeS: Math.max(0, chunkTime),
    });
  };

  const lineNames = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    lineNames.set(node.lineId, node.lineId.toUpperCase().charAt(0) + node.lineId.slice(1) + ' Line');
  }

  for (let i = 0; i < edgeList.length; i++) {
    chunkTime += edgeList[i].timeS;
    if (edgeList[i].transfer && !edgeList[i].sameLine) {
      flush(i);
      chunkStart = i + 1;
      chunkTime = 0;
    }
  }
  flush(nodeKeys.length - 1);

  const stationCount = new Set(
    legs.flatMap(leg => leg.stations.map(x => x.id)),
  ).size;

  return {
    legs,
    timeS: goalCost.time,
    changes: goalCost.changes,
    stationCount,
  };
}

export function planFastest(
  network: NetworkData,
  originId: string,
  destId: string,
): Plan | null {
  return plan(network, originId, destId, 'fastest');
}

export function planLeastChanges(
  network: NetworkData,
  originId: string,
  destId: string,
): Plan | null {
  return plan(network, originId, destId, 'leastChanges');
}
