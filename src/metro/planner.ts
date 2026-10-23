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
  /** Human-readable interchange summary e.g. 'Direct' or 'Via Rajiv Chowk' */
  interchangeSummary?: string;
  /** Label for UI presentation */
  label?: string;
}

export type PlanMode = 'fastest' | 'leastChanges';

export interface PlanOptions {
  avoidInterchanges?: string[];
}

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
  options?: PlanOptions,
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

  const avoidSet = options?.avoidInterchanges && options.avoidInterchanges.length > 0
    ? new Set(options.avoidInterchanges)
    : null;

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

    const fromNodeInfo = graph.nodes.get(node);

    for (const edge of graph.adj.get(node) ?? []) {
      // If user wants to avoid transferring at this station:
      if (edge.transfer && !edge.sameLine && avoidSet && fromNodeInfo && avoidSet.has(fromNodeInfo.stationId)) {
        continue;
      }

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
  const lineNames = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    lineNames.set(node.lineId, node.lineId.toUpperCase().charAt(0) + node.lineId.slice(1) + ' Line');
  }

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

  const transferNames = legs.slice(0, -1).map(leg => leg.alightName);
  const interchangeSummary =
    transferNames.length === 0
      ? 'Direct (No interchange)'
      : `Via ${transferNames.join(' ➔ ')}`;

  return {
    legs,
    timeS: goalCost.time,
    changes: goalCost.changes,
    stationCount,
    interchangeSummary,
  };
}

export function planFastest(
  network: NetworkData,
  originId: string,
  destId: string,
  options?: PlanOptions,
): Plan | null {
  const p = plan(network, originId, destId, 'fastest', options);
  if (p && originId !== destId) p.label = '⚡ Fastest Route';
  return p;
}

export function planLeastChanges(
  network: NetworkData,
  originId: string,
  destId: string,
  options?: PlanOptions,
): Plan | null {
  const p = plan(network, originId, destId, 'leastChanges', options);
  if (p && originId !== destId) p.label = '🔄 Fewest Transfers';
  return p;
}

/**
 * Finds alternative routes with different interchange options.
 * Allows rider to pick a different transfer station (e.g. Mandi House vs Rajiv Chowk).
 */
export function planAlternates(
  network: NetworkData,
  originId: string,
  destId: string,
  maxAlternates: number = 3,
): Plan[] {
  if (originId === destId) return [];

  const results: Plan[] = [];
  const planSignature = (p: Plan) =>
    p.legs.map(l => `${l.lineId}@${l.alightId}`).join('|');
  const seenSignatures = new Set<string>();

  const fastest = planFastest(network, originId, destId);
  if (fastest) {
    results.push(fastest);
    seenSignatures.add(planSignature(fastest));
  }

  const leastChanges = planLeastChanges(network, originId, destId);
  if (leastChanges) {
    const sig = planSignature(leastChanges);
    if (!seenSignatures.has(sig)) {
      results.push(leastChanges);
      seenSignatures.add(sig);
    }
  }

  // Extract all transfer station IDs that occurred in primary plans
  const primaryInterchanges = new Set<string>();
  for (const p of results) {
    for (let i = 0; i < p.legs.length - 1; i++) {
      primaryInterchanges.add(p.legs[i].alightId);
    }
  }

  // For each interchange station used in primary paths, calculate routes avoiding it
  for (const avoidStationId of primaryInterchanges) {
    if (results.length >= maxAlternates + 2) break;

    for (const mode of ['fastest', 'leastChanges'] as PlanMode[]) {
      const alt = plan(network, originId, destId, mode, {
        avoidInterchanges: [avoidStationId],
      });
      if (alt && alt.legs.length > 0) {
        const sig = planSignature(alt);
        if (!seenSignatures.has(sig)) {
          // Reject if absurdly slower (> 1.7x fastest or > 40 min longer)
          if (!fastest || alt.timeS <= fastest.timeS * 1.7 + 1800) {
            alt.label = `🔄 Alternate Interchange (${alt.interchangeSummary})`;
            seenSignatures.add(sig);
            results.push(alt);
            if (results.length >= maxAlternates + 2) break;
          }
        }
      }
    }
  }

  return results;
}
