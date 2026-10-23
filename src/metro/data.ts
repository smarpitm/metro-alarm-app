/**
 * Metro network data pack — v0 (all Delhi Metro lines, generated)
 *
 * Station order, GPS anchors and inter-station times are sourced from the
 * generated pack (`tools/data-prep/build-network.mjs` →
 * `src/metro/delhiNetwork.g.ts`), which derives them from OpenStreetMap route
 * relations with Wikipedia as a cross-check. Inter-station times are
 * distance-derived estimates (dwell + dist / V_EFF) — replace with measured
 * medians from Phase P0 data-collection rides (docs/station-detection.md §9).
 */

export interface StationDef {
  id: string;
  name: string;
  /** travel time in seconds from THIS station to the next one (symmetric for v0) */
  toNextS?: number;
  /** GPS anchor coordinates (from OSM route relations) */
  lat?: number;
  lon?: number;
}

export interface SegmentDef {
  id: string;
  /** ordered station list; first and last are termini */
  stations: StationDef[];
}

/** A physical line; segments = separate branches sharing junction stations. */
export interface LineDef {
  id: string;
  name: string;
  segments: SegmentDef[];
}

export interface NetworkData {
  lines: LineDef[];
  /** walk+wait time to change from one LINE to another at one station complex */
  transferPenaltyS: number;
  /** walk time across a branch junction on the SAME line (train continues; 0 = seamless) */
  sameLineBranchPenaltyS: number;
}


/** All stations in the network, id -> name (deduped). */
export function collectStations(network: NetworkData): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of network.lines) {
    for (const segment of line.segments) {
      for (const s of segment.stations) {
        if (!map.has(s.id)) {
          map.set(s.id, s.name);
        }
      }
    }
  }
  return map;
}

export interface StationCoord {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export function collectStationsWithCoords(network: NetworkData): StationCoord[] {
  const map = new Map<string, StationCoord>();
  for (const line of network.lines) {
    for (const segment of line.segments) {
      for (const s of segment.stations) {
        if (!map.has(s.id) && s.lat != null && s.lon != null) {
          map.set(s.id, { id: s.id, name: s.name, lat: s.lat, lon: s.lon });
        }
      }
    }
  }
  return Array.from(map.values());
}

