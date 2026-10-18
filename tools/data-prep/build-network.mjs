/**
 * One-time data-prep script (Phase P0, D-004): builds the Delhi Metro network pack.
 *
 * Primary source: OpenStreetMap route relations (network="Delhi Metro",
 * route=subway). Each relation's ordered `stop_position` members give the
 * station order per line/direction/branch, plus coordinates — a single,
 * self-consistent source for order + coords. Wikipedia wikitext (cached) is
 * used only as a line-inventory cross-check.
 *
 * Output: src/metro/delhiNetwork.json (lines → segments → ordered stations)
 * with inter-station times ESTIMATED from great-circle distance + dwell
 * (derived estimates; real median times come from recorded rides later).
 *
 * Run: node tools/data-prep/build-network.mjs
 */
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(ROOT, 'cache');
const OUT = path.join(ROOT, '..', '..', 'src', 'metro', 'delhiNetwork.g.ts');

const LINE_COLORS = {
  red: '#E11837',
  yellow: '#F5C115',
  blue: '#0057B7',
  green: '#00A651',
  violet: '#7B2FBE',
  pink: '#FF69B4',
  magenta: '#D9225C',
  grey: '#909090',
  orange: '#FF8C00',
  aqua: '#00A0D2',
};

const LINE_TITLES = {
  red: 'Red Line',
  yellow: 'Yellow Line',
  blue: 'Blue Line',
  green: 'Green Line',
  violet: 'Violet Line',
  pink: 'Pink Line',
  magenta: 'Magenta Line',
  grey: 'Grey Line',
  orange: 'Airport Express Line',
  aqua: 'Aqua Line',
};

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/\((?:[a-z ]+line)\)/gi, '') // drop "(Pink Line)" style suffixes
    .replace(/\s*\((?:formerly.*?)\)\s*$/i, '')
    .replace(/\s*(metro station|station)\s*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const haz = (a, b) => {
  const R = 6371e3;
  const p = Math.PI / 180;
  const dLat = (b[0] - a[0]) * p;
  const dLon = (b[1] - a[1]) * p;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * p) * Math.cos(b[0] * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// canonical name map: snapshot/CSV/wiki spellings → display names
const ALIASES = new Map(
  Object.entries({
    'dwarka morh': 'Dwarka Mor',
    'barakhambha road': 'Barakhamba Road',
    'ramakrishna ashram marg': 'RK Ashram Marg',
    'shaheed sthal new bus adda': 'Shaheed Sthal',
    'pragati maidan': 'Supreme Court',
    'millennium city centre': 'Millennium City Centre Gurugram',
    'milap nagar': 'Milap Nagar',
    'mewla maharajpur': 'Mewala Maharajpur',
    'gtb nagar': 'Guru Tegh Bahadur Nagar',
    'chawri bazaar': 'Chawri Bazar',
    'vishwavidyalaya': 'Vishwa Vidyalaya',
    'delhi cantonment': 'Delhi Cantt',
    'noida golf course': 'Golf Course',
    'raja nahar singh': 'Raja Nahar Singh (Ballabhgarh)',
    'pulbangash': 'Pul Bangash',
    'rohini': 'Rohini West',
    'a i i m s': 'AIIMS',
    'm g road': 'MG Road',
    'chawri bazzar': 'Chawri Bazar',
    'badhkal mor': 'Badkhal Mor',
    'nhpc chowk': 'NHPC Chowk',
    'badarpur': 'Badarpur Border',
    'lal qila': 'Lal Quila',
    'rajendra nagar': 'Major Mohit Sharma Rajendra Nagar',
    'rohini east': 'Rohini East',
    'igt airport': 'Indira Gandhi International Airport',
    'igi airport': 'Indira Gandhi International Airport',
    'new delhi airport express terminal': 'New Delhi',
    'iit delhi': 'IIT Delhi',
    'north pitampura prashant vihar': 'Uttari Pitampura-Prashant Vihar',
    'uttari pitampura prashant vihar': 'Uttari Pitampura-Prashant Vihar',
    'dwarka kakrola': 'Nangli',
    'nangli najafgarh': 'Nangli',
    'welcome pink line': 'Welcome',
  }),
);
const canonical = (s) => {
  const n = norm(s);
  return ALIASES.get(n) ?? s;
};

/**
 * Parse the Wikipedia master station list (OPEN stations only) into
 * normName → {name, colors:Set}. Used to veto not-yet-open OSM relations
 * (Phase 4 extensions) and stations.
 */
function masterOpenIndex(stationsWikitext) {
  const byNorm = new Map();
  const tableRe = /\{\|([\s\S]*?)\|\}/g;
  let m;
  while ((m = tableRe.exec(stationsWikitext))) {
    const block = m[1];
    if (!block.includes('{{stl|') || !block.includes('{{rcb|')) continue;
    const rows = block.split(/\n\|-/);
    // Only the big OPEN-stations table qualifies (Phase 4 / legend tables are small,
    // their stations must NOT veto real ones).
    const stlCount = [...block.matchAll(/\{\{stl\|Delhi Metro\|/g)].length;
    if (stlCount < 150) continue;
    let pending = null; // rowspan'd station cell continuing into next row(s)
    for (const row of rows) {
      let entry = null;
      // Some rows use a raw station link instead of the stl template.
      const stl = row.match(/\{\{stl\|Delhi Metro\|([^}|]+)/);
      const link = stl ? null : row.match(/\[\[([^|\]]+)\s*(?:\|([^\]]*))*\]\]/);
      let displayName = stl ? canonical(stl[1].trim()) : null;
      if (!stl && link) {
        const disp = (link[2] ?? link[1]).replace(/\s*metro station\s*/i, '').trim();
        if (disp && disp.length > 1 && !/^category|file|list/i.test(disp)) {
          displayName = canonical(disp);
        }
      }
      if (displayName) {
        const normName = norm(displayName);
        entry = byNorm.get(normName) ?? { name: displayName, colors: new Set() };
        byNorm.set(normName, entry);
        const rs = row.match(/rowspan="?(\d+)/);
        const span = rs ? parseInt(rs[1], 10) : 1;
        pending = span > 1 ? { normName, name: displayName, left: span - 1 } : null;
      } else if (pending && pending.left > 0) {
        entry = byNorm.get(pending.normName) ?? { name: pending.name, colors: new Set() };
        entry.entryVia = 'rowspan';
        byNorm.set(pending.normName, entry);
        pending.left -= 1;
      } else {
        continue;
      }
      // interchanges span several physical rows → collect ALL rcb tags
      for (const m2 of row.matchAll(/\{\{rcb\|Delhi Metro\|([^}|]+)/g)) {
        const color = norm(m2[1]).replace(/branch.*/, '');
        entry.colors.add(color);
      }
    }
  }
  return byNorm;
}

async function overpassQuery(osmQuery) {
  const f = path.join(CACHE, 'overpass-route-relations.json');
  const body = 'data=' + encodeURIComponent(osmQuery);
  try {
    return JSON.parse(await fs.readFile(f, 'utf8'));
  } catch {
    const mirrors = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];
    let lastErr;
    for (let attempt = 0; attempt < 6; attempt++) {
      const url = mirrors[attempt % mirrors.length];
      const sleepMs = 15_000 * (attempt > 1 ? 1 : 0);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'MetroAlarm data-prep 0.1 (contact: local build script)',
          },
          body,
        });
        if (!res.ok) throw new Error(`overpass ${url} → ${res.status}`);
        const j = await res.json();
        await fs.writeFile(f, JSON.stringify(j));
        return j;
      } catch (e) {
        lastErr = e;
        console.warn(`attempt ${attempt + 1} on ${url} failed: ${e.message}; backing off...`);
        await new Promise((r) => setTimeout(r, sleepMs || 10_000));
      }
    }
    throw lastErr;
  }
}

/** Simple fetch w/ file cache (wikitext pages). */
async function cachedFetch(file, url) {
  const f = path.join(CACHE, file);
  try {
    return await fs.readFile(f, 'utf8');
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
    const text = await res.text();
    await fs.writeFile(f, text, 'utf8');
    return text;
  }
}

/** Same retry wrapper, separate cache file (all stop_position nodes in NCR). */
async function overpassQuery2(osmQuery) {
  const f = path.join(CACHE, 'overpass-all-stops.json');
  const body = 'data=' + encodeURIComponent(osmQuery);
  try {
    return JSON.parse(await fs.readFile(f, 'utf8'));
  } catch {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'MetroAlarm data-prep 0.1 (contact: local build script)',
      },
      body,
    });
    if (!res.ok) throw new Error(`overpass → ${res.status}`);
    const j = await res.json();
    await fs.writeFile(f, JSON.stringify(j));
    return j;
  }
}

/** Ordered station-name list from a per-line Wikipedia page (first big stl table). */
function wikiLineOrder(file) {
  try {
    const wt = readFileSync(path.join(CACHE, file), 'utf8');
    const tables = [];
    const tableRe = /\{\|([\s\S]*?)\|\}/g;
    let m;
    while ((m = tableRe.exec(wt))) {
      const rows = [...m[1].matchAll(/\{\{stl\|Delhi Metro\|([^}|]+)/g)].map((r) =>
        r[1].trim(),
      );
      if (rows.length >= 10) tables.push(rows);
    }
    return tables.sort((a, b) => b.length - a.length)[0] ?? [];
  } catch (e) {
    console.warn(`wikiLineOrder(${file}) failed:`, e.message);
    return [];
  }
}

const main = async () => {
  await fs.mkdir(CACHE, { recursive: true });

  const q =
    '[out:json][timeout:180];(' +
    'rel["network"="Delhi Metro"]["route"="subway"];' +
    ');out body;' +
    'node(r)["public_transport"="stop_position"];' +
    'out body;';

  const data = await overpassQuery(q);

  // universal stop-node coords by name (covers stations missing from relations)
  const q2 =
    '[out:json][timeout:120];(' +
    'node["public_transport"="stop_position"](28.2,76.8,29.0,77.7);' +
    'node["railway"="station"]["station"="subway"](28.2,76.8,29.0,77.7);' +
    ');out body;';
  const all = await overpassQuery2(q2);
  const nameCoords = new Map(); // norm(name) → [lat, lon]
  for (const el of all.elements) {
    const name = el.tags?.name;
    if (name && Number.isFinite(el.lat) && !nameCoords.has(norm(canonical(name)))) {
      nameCoords.set(norm(canonical(name)), [el.lat, el.lon]);
    }
  }

  // master open-station index from Wikipedia
  await cachedFetch(
    'stations-master-wikitext.txt',
    'https://en.wikipedia.org/w/index.php?title=List_of_Delhi_Metro_stations&action=raw',
  );
  const masterWt = await fs.readFile(path.join(CACHE, 'stations-master-wikitext.txt'), 'utf8');
  const master = masterOpenIndex(masterWt);

  // nodes / platforms by id
  const stopsById = new Map();
  for (const el of data.elements) {
    if (el.type === 'node') {
      stopsById.set(el.id, { lat: el.lat, lon: el.lon, name: el.tags?.name });
    } else if (el.type === 'way') {
      stopsById.set(el.id, { lat: el.center?.lat, lon: el.center?.lon, name: el.tags?.name });
    }
  }

  const coordFor = (name) => {
    const n = norm(canonical(name));
    if (nameCoords.has(n)) return nameCoords.get(n);
    return MANUAL_COORDS.get(n);
  };

  // Estimated coords for stations no dataset covers yet (renamed Red stations).
  // ⚠ UNVERIFIED estimates — replaced by ride-measured anchors in Phase P0.
  const MANUAL_COORDS = new Map(
    Object.entries({
      'dr baba saheb ambedkar hospital': [28.6997, 77.1375], // near Pitampura/Rohini East corridor
    }),
  );

  // group relations by line; drop exact reverse-direction duplicates
  const lines = new Map();
  for (const el of data.elements) {
    if (el.type !== 'relation') continue;
    if (el.tags?.route === 'master') continue;
    const nm = el.tags?.name ?? '';
    const colorKey = Object.keys(LINE_COLORS).find((c) =>
      nm.toLowerCase().includes(c === 'orange' ? 'airport' : c),
    );
    if (!colorKey) continue;
    if (!lines.has(colorKey)) lines.set(colorKey, []);
    lines.get(colorKey).push(el);
  }

  const network = { generatedAt: new Date().toISOString(), lines: [] };
  for (const [colorKey, rels] of lines) {
    const sequences = [];
    for (const rel of rels) {
      const ordered = [];
      for (const mem of rel.members ?? []) {
        if (mem.type === 'node' && mem.role === 'stop') {
          const st = stopsById.get(mem.ref);
          if (st?.name) {
            if (ordered.length === 0 || norm(ordered.at(-1).name) !== norm(st.name)) {
              ordered.push({ name: st.name, lat: st.lat, lon: st.lon });
            }
          }
        }
      }
      if (ordered.length < 3) continue;
      ordered.forEach((st) => {
        if (st.lat == null) {
          const c = coordFor(st.name);
          if (c) {
            st.lat = c[0];
            st.lon = c[1];
          }
        }
      });
      // skip if an already-kept sequence is this one reversed (opposite direction)
      const isReverseOf = sequences.some(
        (s) =>
          s.length === ordered.length &&
          norm(s[0].name) === norm(ordered.at(-1).name) &&
          norm(s.at(-1).name) === norm(ordered[0].name),
      );
      if (isReverseOf) {
        console.log(`  ${LINE_TITLES[colorKey]} skip reverse dup of "${rel.tags?.name}"`);
        continue;
      }
      sequences.push(ordered);
      console.log(
        `  ${LINE_TITLES[colorKey]} rel="${rel.tags?.name}": ${ordered.length} stops, first="${ordered[0].name}" last="${ordered.at(-1).name}"`,
      );
    }

    // Veto not-open stations/relations against the Wikipedia master list.
    const vetoed = [];
    // fuzzy fallback: find a master key that matches after stripping word gaps
    const flatSearch = (n) => {
      const k = n.replace(/\s+/g, '');
      for (const [key, val] of master) {
        const kk = key.replace(/\s+/g, '');
        if (kk === k || kk.includes(k) || k.includes(kk)) return val;
      }
      return undefined;
    };
    const lookup = (name) => master.get(norm(canonical(name))) ?? flatSearch(norm(canonical(name)));
    const valid = sequences
      .map((rows) => {
        const kept = [];
        for (const st of rows) {
          const open = lookup(st.name);
          if (
            open &&
            [...open.colors].some(
              (c) => c.includes(colorKey) || (colorKey === 'orange' && c.includes('airport')),
            )
          ) {
            kept.push(st);
          } else {
            vetoed.push(st.name);
          }
        }
        return kept;
      })
      .filter((rows) => {
        // Rel-level check: both endpoints must be open on THIS line color.
        // (Under-construction relations have one endpoint not listed as open.)
        const lineOk = (name) => {
          const open = lookup(name);
          const ok =
            open &&
            [...open.colors].some(
              (c) => c.includes(colorKey) || (colorKey === 'orange' && c.includes('airport')),
            );
          if (!ok) {
            console.log(
              `    endpoint check fail: "${name}" → master=${open ? [...open.colors].join(',') : 'ABSENT'} (line=${colorKey})`,
            );
          }
          return ok;
        };
        return rows.length >= 3 && lineOk(rows[0].name) && lineOk(rows.at(-1).name);
      });
    if (vetoed.length && valid.length < sequences.length) {
      console.log(`  ${LINE_TITLES[colorKey]}: dropped whole sequence(s); vetoed: ${[...new Set(vetoed)].join(', ')}`);
    } else if (vetoed.length) {
      console.log(`  ${LINE_TITLES[colorKey]}: vetoed stations: ${[...new Set(vetoed)].join(', ')}`);
    }

    // Red Line: OSM relations are missing 10 stations; wiki red page order is
    // authoritative. Overrides the OSM sequences for red only.
    let lineSequences = valid;
    if (colorKey === 'red') {
      const wikiRows = wikiLineOrder('red-wikitext.txt');
      if (wikiRows.length >= 20) {
        lineSequences = [
          wikiRows.map((name) => {
            const c = coordFor(name);
            return { name, lat: c?.[0], lon: c?.[1] };
          }),
        ];
        console.log(`  ${LINE_TITLES[colorKey]}: wiki override applied (${wikiRows.length} stations)`);
      }
    }

    network.lines.push({
      id: colorKey,
      name: LINE_TITLES[colorKey],
      color: LINE_COLORS[colorKey],
      segments: lineSequences.map((rows, i) => ({ id: `seg${i + 1}`, stations: rows.map(toStation) })),
    });
    console.log(
      `${LINE_TITLES[colorKey]}: ${lineSequences.length} segment(s), stations=[${lineSequences.map((s) => s.length).join(' | ')}]`,
    );
  }

  fillTimes(network);

  const banner =
    `/** GENERATED by tools/data-prep/build-network.mjs — do not edit.\n` +
    ` * Sources: OSM route relations (order+coords), Wikipedia list of Delhi Metro\n` +
    ` * stations (open-station veto), wiki Red Line page (order).\n` +
    ` * Inter-station times are distance-derived estimates (DWELL+dist / V_EFF)\n` +
    ` * — replace with measured medians in Phase P0.\n */\n`;
  await fs.writeFile(
    OUT,
    banner + `export default ${JSON.stringify(network, null, 2)} as const;\n`,
  );
  console.log(`\nwrote ${OUT}`);
}

function fillTimes(network) {
  for (const line of network.lines) {
    for (const seg of line.segments) {
      seg.stations = seg.stations.map(toStation);
    }
  }
};

function toStation(st, i, arr) {
  const next = arr[i + 1];
  let toNextS;
  if (next?.lat != null && st.lat != null) {
    toNextS = Math.round(DWELL + haz([st.lat, st.lon], [next.lat, next.lon]) / V_EFF);
  }
  return {
    id: slug(norm(st.name)),
    name: st.name,
    lat: st.lat ?? undefined,
    lon: st.lon ?? undefined,
    toNextS: next ? (toNextS ?? PLACEHOLDER) : undefined,
    _isTerminus: !next,
  };
}

const PLACEHOLDER = 160;
/** Derived estimate constants: dwell + effective speed incl. accel/brake. */
const DWELL = 30;
const V_EFF = 7.7; // m/s (≈27.7 km/h) — replace with ride-measured medians in P0

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
