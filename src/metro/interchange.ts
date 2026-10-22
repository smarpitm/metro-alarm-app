/**
 * Delhi Metro interchange platform directory & guidance.
 * Provides platform number and direction hints for major interchange hubs.
 */

interface PlatformEntry {
  matchDest?: (name: string) => boolean;
  platform: string;
}

// Table of known platform numbers for major interchange stations
const PLATFORM_MAP: Record<string, Record<string, PlatformEntry[]>> = {
  'rajiv-chowk': {
    yellow: [
      {
        matchDest: (s) => /badli|samaypur|vishwa|kashmere/i.test(s),
        platform: 'Platform 1',
      },
      {
        matchDest: (s) => /gurugram|millennium|huda|saket|qutab|aiims/i.test(s),
        platform: 'Platform 2',
      },
    ],
    blue: [
      {
        matchDest: (s) => /noida|vaishali|electronic|mayur|akshardham/i.test(s),
        platform: 'Platform 3',
      },
      {
        matchDest: (s) => /dwarka|janakpuri|subhash|rajouri/i.test(s),
        platform: 'Platform 4',
      },
    ],
  },
  'kashmere-gate': {
    red: [
      { matchDest: (s) => /rithala|rohini|netaji|pitampura/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /shaheed|ghaziabad|welcome|dilshad/i.test(s), platform: 'Platform 2' },
    ],
    yellow: [
      { matchDest: (s) => /badli|samaypur|vishwa/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /gurugram|millennium|huda|rajiv|saket/i.test(s), platform: 'Platform 4' },
    ],
    violet: [
      { matchDest: (s) => /raja nahar|faridabad|badarpur|ito/i.test(s), platform: 'Platform 5/6' },
    ],
  },
  'central-secretariat': {
    yellow: [
      { matchDest: (s) => /badli|samaypur|rajiv/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /gurugram|millennium|huda/i.test(s), platform: 'Platform 2' },
    ],
    violet: [
      { matchDest: (s) => /raja nahar|faridabad|badarpur/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /kashmere|ito|mandi/i.test(s), platform: 'Platform 4' },
    ],
  },
  'hauz-khas': {
    yellow: [
      { matchDest: (s) => /badli|samaypur|rajiv/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /gurugram|millennium|huda/i.test(s), platform: 'Platform 2' },
    ],
    magenta: [
      { matchDest: (s) => /botanical|kalkaji|okhla/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /janakpuri|terminal 1|vasant/i.test(s), platform: 'Platform 4' },
    ],
  },
  'mandi-house': {
    blue: [
      { matchDest: (s) => /dwarka|rajiv|karol/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /noida|vaishali/i.test(s), platform: 'Platform 2' },
    ],
    violet: [
      { matchDest: (s) => /raja nahar|faridabad|badarpur/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /kashmere|ito/i.test(s), platform: 'Platform 4' },
    ],
  },
  'botanical-garden': {
    blue: [
      { matchDest: (s) => /noida electronic|sector 62/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /dwarka|yamuna|rajiv/i.test(s), platform: 'Platform 2' },
    ],
    magenta: [
      { matchDest: (s) => /janakpuri|hauz khas|terminal 1/i.test(s), platform: 'Platform 3' },
    ],
  },
  'janakpuri-west': {
    blue: [
      { matchDest: (s) => /dwarka/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /noida|vaishali|rajiv/i.test(s), platform: 'Platform 2' },
    ],
    magenta: [
      { matchDest: (s) => /botanical|hauz khas/i.test(s), platform: 'Platform 3/4' },
    ],
  },
  'kalkaji-mandir': {
    violet: [
      { matchDest: (s) => /kashmere|mandi|ito/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /raja nahar|faridabad/i.test(s), platform: 'Platform 2' },
    ],
    magenta: [
      { matchDest: (s) => /botanical/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /janakpuri|hauz khas/i.test(s), platform: 'Platform 4' },
    ],
  },
  'lajpat-nagar': {
    violet: [
      { matchDest: (s) => /kashmere|ito/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /raja nahar|faridabad/i.test(s), platform: 'Platform 2' },
    ],
    pink: [
      { matchDest: (s) => /majlis park/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /shiv vihar/i.test(s), platform: 'Platform 4' },
    ],
  },
  'dilli-haat-ina': {
    yellow: [
      { matchDest: (s) => /badli|samaypur|rajiv/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /gurugram|millennium|huda/i.test(s), platform: 'Platform 2' },
    ],
    pink: [
      { matchDest: (s) => /majlis park/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /shiv vihar/i.test(s), platform: 'Platform 4' },
    ],
  },
  'mayur-vihar-i': {
    blue: [
      { matchDest: (s) => /noida|vaishali/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /dwarka|rajiv/i.test(s), platform: 'Platform 2' },
    ],
    pink: [
      { matchDest: (s) => /majlis park/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /shiv vihar/i.test(s), platform: 'Platform 4' },
    ],
  },
  'netaji-subhash-place': {
    red: [
      { matchDest: (s) => /rithala/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /shaheed/i.test(s), platform: 'Platform 2' },
    ],
    pink: [
      { matchDest: (s) => /majlis/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /shiv vihar/i.test(s), platform: 'Platform 4' },
    ],
  },
  'welcome': {
    red: [
      { matchDest: (s) => /rithala/i.test(s), platform: 'Platform 1' },
      { matchDest: (s) => /shaheed/i.test(s), platform: 'Platform 2' },
    ],
    pink: [
      { matchDest: (s) => /majlis/i.test(s), platform: 'Platform 3' },
      { matchDest: (s) => /shiv vihar/i.test(s), platform: 'Platform 4' },
    ],
  },
};

/**
 * Returns platform guidance for a transfer station, or null if unmapped.
 */
export function getPlatformGuidance(
  stationId: string,
  toLineId: string,
  toAlightName: string,
): string | null {
  const stationEntry = PLATFORM_MAP[stationId];
  if (!stationEntry) return null;
  const lineEntries = stationEntry[toLineId];
  if (!lineEntries) return null;
  for (const entry of lineEntries) {
    if (!entry.matchDest || entry.matchDest(toAlightName)) {
      return entry.platform;
    }
  }
  return lineEntries[0]?.platform ?? null;
}

/**
 * Formats a clear, concise instruction for changing trains at an interchange.
 */
export function formatInterchangeInstruction(opts: {
  stationName: string;
  toLineName: string;
  toAlightName: string;
  platform?: string | null;
}): string {
  const { stationName, toLineName, toAlightName, platform } = opts;
  const plat = platform ? ` (${platform})` : '';
  return `Change at ${stationName} ➔ Take ${toLineName}${plat} towards ${toAlightName}`;
}
