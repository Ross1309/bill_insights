// Build netlify/lib/zip-districts-<congress>.js (data as a plain module, so any bundler takes it): which congressional district(s) each
// ZIP Code Tabulation Area lies in, for ZIP-only lookups in find-district.
//
//   node scripts/build-zip-districts.js [--congress 119|120] [--dir <cache dir>]
//
// Sources (U.S. Census Bureau, public domain; downloaded once into the cache dir):
// - ZCTA <-> 2020 census block relationship file (1 GB): every block's ZCTA + land area.
// - Block equivalency files of the 118th, 119th and 120th Congress's districts
//   (Redistricting Data Office): every block's district. The 119th zip holds a national file.
// Census blocks are the building blocks of both ZCTAs and districts, so a ZCTA's districts
// are exactly the districts of its blocks: no estimating. Each district's share of the
// ZCTA's land area orders the list (the files have no population).
// ZCTAs approximate USPS ZIP codes; PO-box-only and single-business ZIPs have none.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const congresses = arg('--congress') ? [Number(arg('--congress'))] : [119, 120];
const dir = arg('--dir') || path.join(os.tmpdir(), 'census-zip-districts');
fs.mkdirSync(dir, { recursive: true });

const RDO = 'https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files';
const FILES = {
  zcta: ['zcta_block.txt', 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt'],
  119: ['cd119.zip', `${RDO}/2025/119-congressional-district-befs/cd119.zip`, 'NationalCD119.txt'],
  120: ['cd120.zip', `${RDO}/2027/120-congressional-district-befs/cd120.zip`, 'NationalCD120.txt'],
};

// State FIPS -> USPS (same as find-district).
const FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
  '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
  '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY',
  '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
};

function download([file, url]) {
  const dest = path.join(dir, file);
  if (!fs.existsSync(dest)) {
    console.log(`downloading ${url}`);
    execFileSync('curl', ['-sSfL', '-o', `${dest}.part`, url], { stdio: 'inherit' });
    fs.renameSync(`${dest}.part`, dest);
  }
  return dest;
}

function lines(stream) {
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

// "WA7" style code: state + district number; at-large seats and delegates are 0.
function districtCode(geoid, cdfp) {
  const state = FIPS[geoid.slice(0, 2)];
  if (!state) return null;
  const n = Number(cdfp.trim());
  if (cdfp.trim() === 'ZZ' || !Number.isFinite(n)) return null;   // water-only blocks
  return `${state}${n === 98 ? 0 : n}`;                             // 98 = DC / delegate
}

async function blockDistricts(congress) {
  const [file, url, member] = FILES[congress];
  const zip = download([file, url]);
  const { spawn } = await import('node:child_process');
  const unzip = spawn('unzip', ['-p', zip, member]);
  const map = new Map();          // block GEOID (as a number) -> district code
  let header = true;
  for await (const line of lines(unzip.stdout)) {
    if (header) { header = false; continue; }
    const [geoid, ...rest] = line.split(',');
    const code = districtCode(geoid, rest[rest.length - 1]);
    if (code) map.set(Number(geoid), code);
  }
  if (map.size < 7_000_000) throw new Error(`${member}: only ${map.size} blocks`);
  return map;
}

async function build(congress) {
  const blocks = await blockDistricts(congress);
  const zcta = download(FILES.zcta);
  const areas = new Map();        // zcta -> Map(district -> land area)
  let header = true, missing = 0;
  for await (const line of lines(fs.createReadStream(zcta))) {
    if (header) { header = false; continue; }
    const f = line.split('|');
    const z = f[1];
    if (!z) continue;             // block outside every ZCTA
    const code = blocks.get(Number(f[9]));
    if (!code) { missing++; continue; }
    const land = Number(f[15]) || 0;
    if (!areas.has(z)) areas.set(z, new Map());
    const m = areas.get(z);
    m.set(code, (m.get(code) || 0) + land);
  }
  const zips = {};
  let split = 0;
  for (const [z, m] of [...areas].sort()) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    // Water-only parts (no land) can't be anyone's address: leave them out unless nothing else.
    let list = [...m].filter(([, land]) => land > 0);
    if (!list.length) list = [...m];
    list.sort((a, b) => b[1] - a[1]);
    if (list.length > 1) split++;
    // "WA7" or "WA1:62,WA9:38" (percent of the ZCTA's land, rounded; at least 1)
    zips[z] = list.length === 1 ? list[0][0]
      : list.map(([c, land]) => `${c}:${Math.max(1, Math.round((100 * land) / (total || 1)))}`).join(',');
  }
  const out = {
    congress,
    source: 'U.S. Census Bureau: 2020 ZCTA-to-block relationship file and the Redistricting Data Office block equivalency file of the ' + `${congress}th Congress`,
    note: 'Percent = share of the ZIP area\'s land in each district (not population).',
    count: Object.keys(zips).length,
    split,
    zips,
  };
  const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'netlify', 'lib', `zip-districts-${congress}.js`);
  fs.writeFileSync(dest, `// Generated by scripts/build-zip-districts.js. Do not edit.\nexport default ${JSON.stringify(out)};\n`);
  console.log(`${congress}th: ${out.count} ZIP areas, ${split} in more than one district, ${missing} blocks without a district -> ${path.relative(process.cwd(), dest)} (${Math.round(fs.statSync(dest).size / 1024)} KB)`);
}

for (const c of congresses) {
  if (!FILES[c]) throw new Error(`No block file known for the ${c}th Congress`);
  await build(c);
}
