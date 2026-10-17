import { NetworkData, StationDef } from './data';

export interface GraphEdge {
  to: string;
  /** seconds to traverse this edge (ride time, or penalty for a transfer) */
  timeS: number;
  /** true if this edge is a change of platform/line at one station */
  transfer: boolean;
  /** true if the transfer stays on the same physical line (branch junction) */
  sameLine: boolean;
}

export interface NodeInfo {
  key: string;
  lineId: string;
  segmentId: string;
  stationId: string;
  name: string;
}

export interface Graph {
  nodes: Map<string, NodeInfo>;
  adj: Map<string, GraphEdge[]>;
}

export const DEFAULT_TO_NEXT_S = 160;

/**
 * Builds the routing graph from a NetworkData pack.
 * Node = (station, line, segment). Edges:
 *  - ride edges between consecutive stations (weight = to_next_s),
 *  - transfer edges between nodes of the same physical station
 *    (weight = transferPenaltyS across lines, sameLineBranchPenaltyS within a line).
 */
export function buildGraph(net: NetworkData): Graph {
  const nodes = new Map<string, NodeInfo>();
  const adj = new Map<string, GraphEdge[]>();
  const byStation = new Map<string, NodeInfo[]>();

  const push = (from: string, edge: GraphEdge) => {
    const list = adj.get(from);
    if (list) {
      list.push(edge);
    } else {
      adj.set(from, [edge]);
    }
  };

  for (const line of net.lines) {
    for (const segment of line.segments) {
      const nodeOf = (s: StationDef): NodeInfo => {
        const key = `${line.id}|${segment.id}|${s.id}`;
        let info = nodes.get(key);
        if (!info) {
          info = {
            key,
            lineId: line.id,
            segmentId: segment.id,
            stationId: s.id,
            name: s.name,
          };
          nodes.set(key, info);
          const group = byStation.get(s.id);
          if (group) {
            group.push(info);
          } else {
            byStation.set(s.id, [info]);
          }
        }
        return info;
      };

      for (let i = 0; i < segment.stations.length; i++) {
        const a = nodeOf(segment.stations[i]);
        if (i + 1 < segment.stations.length) {
          const b = nodeOf(segment.stations[i + 1]);
          const t = segment.stations[i].toNextS ?? DEFAULT_TO_NEXT_S;
          push(a.key, { to: b.key, timeS: t, transfer: false, sameLine: true });
          push(b.key, { to: a.key, timeS: t, transfer: false, sameLine: true });
        }
      }
    }
  }

  for (const group of byStation.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) {
          continue;
        }
        const a = group[i];
        const b = group[j];
        if (a.lineId === b.lineId) {
          push(a.key, {
            to: b.key,
            timeS: net.sameLineBranchPenaltyS,
            transfer: true,
            sameLine: true,
          });
        } else {
          push(a.key, {
            to: b.key,
            timeS: net.transferPenaltyS,
            transfer: true,
            sameLine: false,
          });
        }
      }
    }
  }

  return { nodes, adj };
}
