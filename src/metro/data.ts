/**
 * Metro network data pack — v0 (Blue Line MVP)
 *
 * Station order, GPS anchors and inter-station times are sourced from the
 * generated pack (`tools/data-prep/build-network.mjs` →
 * `src/metro/delhiNetwork.g.ts`), which derives them from OpenStreetMap route
 * relations with Wikipedia as a cross-check. Inter-station times are
 * distance-derived estimates (dwell + dist / V_EFF) — replace with measured
 * medians from Phase P0 data-collection rides (docs/station-detection.md §9).
 *
 * The trunk and both branches share Yamuna Bank as a junction; it appears once
 * in each segment list so the graph treats Dwarka↔Noida and Dwarka↔Vaishali as
 * single-line rides (0 changes).
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

/** Legacy placeholder value kept for reference; real per-segment times are on each station now. */
export const PLACEHOLDER_TO_NEXT_S = 160;

/** Trunk: Dwarka Sector 21 → Yamuna Bank (34 stations, reversed from generated seg1). */
const trunkStations: StationDef[] = [
  { id: 'dwarka-sector-21', name: 'Dwarka Sector 21', lat: 28.551986, lon: 77.0584649, toNextS: 255 },
  { id: 'dwarka-sector-8', name: 'Dwarka Sector 8', lat: 28.5656075, lon: 77.0670615, toNextS: 157 },
  { id: 'dwarka-sector-9', name: 'Dwarka Sector 9', lat: 28.5742819, lon: 77.0653509, toNextS: 170 },
  { id: 'dwarka-sector-10', name: 'Dwarka Sector 10', lat: 28.5810731, lon: 77.0575146, toNextS: 158 },
  { id: 'dwarka-sector-11', name: 'Dwarka Sector 11', lat: 28.586462, lon: 77.0494551, toNextS: 169 },
  { id: 'dwarka-sector-12', name: 'Dwarka Sector 12', lat: 28.5922515, lon: 77.0407464, toNextS: 144 },
  { id: 'dwarka-sector-13', name: 'Dwarka Sector 13', lat: 28.597025, lon: 77.0335556, toNextS: 152 },
  { id: 'dwarka-sector-14', name: 'Dwarka Sector 14', lat: 28.602234, lon: 77.0259935, toNextS: 218 },
  { id: 'dwarka-kakrola', name: 'Dwarka - Kakrola (Blue Line)', lat: 28.6149318, lon: 77.0227861, toNextS: 177 },
  { id: 'dwarka-mor', name: 'Dwarka Mor', lat: 28.6192912, lon: 77.0332835, toNextS: 180 },
  { id: 'nawada', name: 'Nawada', lat: 28.6202562, lon: 77.0450835, toNextS: 167 },
  { id: 'uttam-nagar-west', name: 'Uttam Nagar West', lat: 28.6217367, lon: 77.0557191, toNextS: 159 },
  { id: 'uttam-nagar-east', name: 'Uttam Nagar East', lat: 28.6248301, lon: 77.0652972, toNextS: 206 },
  { id: 'janakpuri-west', name: 'Janakpuri West', lat: 28.6295652, lon: 77.0780939, toNextS: 150 },
  { id: 'janakpuri-east', name: 'Janakpuri East', lat: 28.6329889, lon: 77.0867273, toNextS: 164 },
  { id: 'tilak-nagar', name: 'Tilak Nagar', lat: 28.6365265, lon: 77.096482, toNextS: 155 },
  { id: 'subhash-nagar', name: 'Subhash Nagar', lat: 28.6404628, lon: 77.1052347, toNextS: 138 },
  { id: 'tagore-garden', name: 'Tagore Garden', lat: 28.6437288, lon: 77.1128703, toNextS: 177 },
  { id: 'rajouri-garden', name: 'Rajouri Garden (Blue Line)', lat: 28.6490372, lon: 77.122743, toNextS: 155 },
  { id: 'ramesh-nagar', name: 'Ramesh Nagar', lat: 28.652725, lon: 77.1316569, toNextS: 185 },
  { id: 'moti-nagar', name: 'Moti Nagar', lat: 28.6578419, lon: 77.1424425, toNextS: 138 },
  { id: 'kirti-nagar', name: 'Kirti Nagar (Blue Line)', lat: 28.6557294, lon: 77.1506502, toNextS: 143 },
  { id: 'shadipur', name: 'Shadipur', lat: 28.6515664, lon: 77.1582426, toNextS: 199 },
  { id: 'patel-nagar', name: 'Patel Nagar', lat: 28.6449953, lon: 77.1692658, toNextS: 150 },
  { id: 'rajendra-place', name: 'Rajendra Place', lat: 28.6424765, lon: 77.1782794, toNextS: 162 },
  { id: 'karol-bagh', name: 'Karol Bagh', lat: 28.6439905, lon: 77.1885276, toNextS: 174 },
  { id: 'jhandewalan', name: 'Jhandewalan', lat: 28.6442998, lon: 77.1999053, toNextS: 162 },
  { id: 'ramakrishna-ashram-marg', name: 'Ramakrishna Ashram Marg', lat: 28.6392249, lon: 77.2085684, toNextS: 199 },
  { id: 'rajiv-chowk', name: 'Rajiv Chowk', lat: 28.6327591, lon: 77.2196877, toNextS: 110 },
  { id: 'barakhambha-road', name: 'Barakhambha Road', lat: 28.6297527, lon: 77.2249956, toNextS: 161 },
  { id: 'mandi-house', name: 'Mandi House', lat: 28.6255914, lon: 77.2341954, toNextS: 140 },
  { id: 'supreme-court', name: 'Supreme Court', lat: 28.6234593, lon: 77.2425121, toNextS: 128 },
  { id: 'indraprastha', name: 'Indraprastha', lat: 28.6205832, lon: 77.2495452, toNextS: 267 },
  { id: 'yamuna-bank', name: 'Yamuna Bank', lat: 28.6231406, lon: 77.2680442, toNextS: undefined },
];

/** Noida branch: Yamuna Bank → Noida Electronic City (17 stations, reversed from generated seg1 head). */
const noidaStations: StationDef[] = [
  { id: 'yamuna-bank', name: 'Yamuna Bank', lat: 28.6231406, lon: 77.2680442, toNextS: 194 },
  { id: 'akshardham', name: 'Akshardham', lat: 28.6178791, lon: 77.2795258, toNextS: 266 },
  { id: 'mayur-vihar-i', name: 'Mayur Vihar - I (Blue Line)', lat: 28.6040558, lon: 77.2895211, toNextS: 182 },
  { id: 'mayur-vihar-extension', name: 'Mayur Vihar Extension', lat: 28.5944669, lon: 77.2944279, toNextS: 149 },
  { id: 'new-ashok-nagar', name: 'New Ashok Nagar', lat: 28.5891047, lon: 77.3015826, toNextS: 172 },
  { id: 'noida-sector-15', name: 'Noida Sector 15', lat: 28.5849263, lon: 77.3116814, toNextS: 156 },
  { id: 'noida-sector-16', name: 'Noida Sector 16', lat: 28.5781067, lon: 77.3178293, toNextS: 179 },
  { id: 'noida-sector-18', name: 'Noida Sector 18', lat: 28.5707894, lon: 77.3261467, toNextS: 174 },
  { id: 'botanical-garden', name: 'Botanical Garden', lat: 28.5639195, lon: 77.3343678, toNextS: 191 },
  { id: 'noida-golf-course', name: 'Noida Golf Course', lat: 28.5674266, lon: 77.346399, toNextS: 194 },
  { id: 'noida-city-centre', name: 'Noida City Centre', lat: 28.5747852, lon: 77.3562496, toNextS: 151 },
  { id: 'noida-sector-34', name: 'Noida Sector 34', lat: 28.5802275, lon: 77.3635215, toNextS: 181 },
  { id: 'noida-sector-52', name: 'Noida Sector 52', lat: 28.5867347, lon: 77.3728019, toNextS: 187 },
  { id: 'noida-sector-61', name: 'Noida Sector 61', lat: 28.5975791, lon: 77.372309, toNextS: 159 },
  { id: 'noida-sector-59', name: 'Noida Sector 59', lat: 28.6065246, lon: 77.3727211, toNextS: 181 },
  { id: 'noida-sector-62', name: 'Noida Sector 62', lat: 28.6169832, lon: 77.3736218, toNextS: 194 },
  { id: 'noida-electronic-city', name: 'Noida Electronic City', lat: 28.6282598, lon: 77.3750964, toNextS: undefined },
];

/** Vaishali branch: Yamuna Bank → Vaishali (8 stations, from generated seg2). */
const vaishaliStations: StationDef[] = [
  { id: 'yamuna-bank', name: 'Yamuna Bank', lat: 28.6233069, lon: 77.2679515, toNextS: 191 },
  { id: 'laxmi-nagar', name: 'Laxmi Nagar', lat: 28.6306223, lon: 77.2775015, toNextS: 175 },
  { id: 'nirman-vihar', name: 'Nirman Vihar', lat: 28.6365579, lon: 77.2867522, toNextS: 159 },
  { id: 'preet-vihar', name: 'Preet Vihar', lat: 28.6414409, lon: 77.2952594, toNextS: 195 },
  { id: 'karkarduma', name: 'Karkarduma (Blue Line)', lat: 28.6484435, lon: 77.305527, toNextS: 165 },
  { id: 'anand-vihar', name: 'Anand Vihar (Blue Line)', lat: 28.6468919, lon: 77.316053, toNextS: 137 },
  { id: 'kaushambi', name: 'Kaushambi', lat: 28.6454076, lon: 77.3243389, toNextS: 232 },
  { id: 'vaishali', name: 'Vaishali', lat: 28.6497651, lon: 77.3395056, toNextS: undefined },
];

export const blueLineNetwork: NetworkData = {
  transferPenaltyS: 300,
  sameLineBranchPenaltyS: 0,
  lines: [
    {
      id: 'blue',
      name: 'Blue Line',
      segments: [
        { id: 'trunk', stations: trunkStations },
        { id: 'noida', stations: noidaStations },
        { id: 'vaishali', stations: vaishaliStations },
      ],
    },
  ],
};

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

