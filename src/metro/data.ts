/**
 * Metro network data pack — v0
 *
 * ⚠️ PLACEHOLDER DATA: station ORDER below was assembled manually and must be
 * verified station-by-station in Phase P0 (docs/station-detection.md §9). All
 * inter-station times use PLACEHOLDER_TO_NEXT_S; real per-segment times come from
 * recorded rides (docs/decisions.md D-004). The planner logic and UI do not
 * depend on these values being accurate — only the displayed minutes are.
 */

export interface StationDef {
  id: string;
  name: string;
  /** travel time in seconds from THIS station to the next one (symmetric for v0) */
  toNextS?: number;
  /** GPS anchor coordinates (present in the generated full-network pack) */
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

export const PLACEHOLDER_TO_NEXT_S = 160;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const st = (name: string): StationDef => ({
  id: slug(name),
  name,
  toNextS: PLACEHOLDER_TO_NEXT_S,
});

const trunkNames = [
  'Dwarka Sector 21', 'Dwarka Sector 8', 'Dwarka Sector 9', 'Dwarka Sector 10',
  'Dwarka Sector 11', 'Dwarka Sector 12', 'Dwarka Sector 13', 'Dwarka Sector 14',
  'Dwarka', 'Dwarka Mor', 'Nawada', 'Uttam Nagar West', 'Uttam Nagar East',
  'Janakpuri West', 'Janakpuri East', 'Tilak Nagar', 'Subhash Nagar',
  'Tagore Garden', 'Rajouri Garden', 'Ramesh Nagar', 'Moti Nagar', 'Kirti Nagar',
  'Shadipur', 'Patel Nagar', 'Rajendra Place', 'Karol Bagh', 'Jhandewalan',
  'RK Ashram Marg', 'Rajiv Chowk', 'Barakhamba Road', 'Mandi House',
  'Supreme Court', 'Indraprastha', 'Yamuna Bank',
];

const noidaBranchNames = [
  'Yamuna Bank', 'Akshardham', 'Mayur Vihar-I', 'Mayur Vihar Extension',
  'New Ashok Nagar', 'Noida Sector 15', 'Noida Sector 16', 'Noida Sector 18',
  'Noida City Centre', 'Noida Sector 34', 'Noida Sector 52', 'Noida Sector 61',
  'Noida Sector 59', 'Noida Sector 62', 'Noida Electronic City',
];

const vaishaliBranchNames = [
  'Yamuna Bank', 'Laxmi Nagar', 'Nirman Vihar', 'Preet Vihar', 'Karkarduma',
  'Anand Vihar', 'Kaushambi', 'Vaishali',
];

export const blueLineNetwork: NetworkData = {
  transferPenaltyS: 300,
  sameLineBranchPenaltyS: 0,
  lines: [
    {
      id: 'blue',
      name: 'Blue Line',
      segments: [
        { id: 'trunk', stations: trunkNames.map(st) },
        { id: 'noida', stations: noidaBranchNames.map(st) },
        { id: 'vaishali', stations: vaishaliBranchNames.map(st) },
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
