// Enacted earmarks of a fiscal year -> public stats docs (netlify/lib/earmarks.js,
// netlify/lib/earmark-sources.js).
//
//   node scripts/build-earmarks.js [--fy 2026] [--write]
//
// Downloads each source table's Congressional Record page and enacted law from GovInfo (cached
// in the OS temp dir), parses the table, runs its checks, matches requesters to members
// (congress-legislators, current + historical), prints a report, and with --write stores:
//   stats/earmarks-<fy>                 index: per table counts, totals, checks, notes; totals by
//                                       state and by member (bioguide -> [count, total])
//   stats/earmarks-<fy>-<key>           one table: accounts + rows (bill window)
//   stats/earmarks-<fy>-state-<ST>      across tables, every project located in the state or requested
//                                       by one of its members (a Virginia senator's DC project is in
//                                       VA's doc too): the member window reads its member's state
// A table that fails any check isn't written (the index lists it as not published, with why).

import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EARMARK_SOURCES } from '../netlify/lib/earmark-sources.js';
import { findTables, lawDivisionText, matchRequesters, memberIndex, packRows, parseTable, recordLines, runCheck } from '../netlify/lib/earmarks.js';
import { getText } from '../netlify/lib/http.js';

const args = process.argv.slice(2);
const fy = Number(args[args.indexOf('--fy') + 1]) || 2026;
const WRITE = args.includes('--write');
const sources = EARMARK_SOURCES[fy];
if (!sources) throw new Error(`No earmark sources for fiscal year ${fy}`);
const CACHE = path.join(os.tmpdir(), 'cw-earmarks');
fs.mkdirSync(CACHE, { recursive: true });

async function cached(name, url) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const text = await getText(url, { timeoutMs: 60000 });
  fs.writeFileSync(file, text);
  return text;
}
const recordPage = g => cached(`${g}.htm`, `https://www.govinfo.gov/content/pkg/${g.slice(0, 15)}/html/${g}.htm`);
const lawXml = billId => {
  const [, type, num, congress] = /^([a-z]+)(\d+)-(\d+)$/.exec(billId);
  const stem = `BILLS-${congress}${type}${num}enr`;
  return cached(`${stem}.xml`, `https://www.govinfo.gov/content/pkg/${stem}/xml/${stem}.xml`);
};

// Members serving on the day each table was printed (its Congressional Record date).
const people = [
  ...JSON.parse(await cached('legislators-current.json', 'https://unitedstates.github.io/congress-legislators/legislators-current.json')),
  ...JSON.parse(await cached('legislators-historical.json', 'https://unitedstates.github.io/congress-legislators/legislators-historical.json')),
];
const indexes = new Map();
const indexFor = date => { if (!indexes.has(date)) indexes.set(date, memberIndex(people, date)); return indexes.get(date); };

// bioguide -> the state they represent (their latest term), for the state docs; and the name
// shown for them (former members aren't in the site's member directory).
const homeState = new Map(people.map(p => [p.id.bioguide, p.terms?.at(-1)?.state]));
const displayName = new Map(people.map(p => [p.id.bioguide, p.name?.official_full || [p.name?.first, p.name?.last].filter(Boolean).join(' ')]));
// The people a doc's rows name: { bioguide: [name, party letter, state] }.
const peopleOf = packed => {
  const out = {};
  for (const row of packed.rows) for (const id of [...row[6], ...row[7]]) {
    if (id.startsWith('~') || out[id]) continue;
    const p = people.find(x => x.id.bioguide === id);
    out[id] = [displayName.get(id), (p?.terms?.at(-1)?.party || '').charAt(0), homeState.get(id)];
  }
  return out;
};

const results = [];
const unmatched = new Map();
for (const src of sources) {
  const lines = recordLines(await recordPage(src.granule));
  const tables = findTables(lines);
  const t = tables[src.table];
  const same = t && (src.title ? src.title.test(t.title.join(' ')) : src.header.test(t.header.join(' ')));
  if (!same) throw new Error(`${src.key}: table ${src.table} of ${src.granule} isn't the expected one (title: ${t?.title.join(' / ')})`);
  const parsed = parseTable(t, { amountHeading: src.amountHeading });
  const index = indexFor(src.granule.slice(5, 15));
  const ctx = {
    lawText: lawDivisionText(await lawXml(src.bill_id), src.division),
    statementText: lines.slice(tables[src.table - 1]?.end || 0, t.start).join('\n'),
    parts: (src.checks.find(c => c.kind === 'parts')?.tables || []).map(k => parseTable(tables[k])),
  };
  const checks = src.checks.map(c => runCheck(c, parsed.rows, ctx));
  const problems = [...(parsed.unread.length ? [`${parsed.unread.length} rows without a readable amount`] : []), ...checks.filter(c => !c.ok).map(c => `${c.kind} check failed: ${c.detail}`)];
  // Requesters -> members. A combined "Requestor(s)" column (Financial Services) is matched
  // against both chambers.
  for (const r of parsed.rows) {
    r.houseMatched = matchRequesters(r.house, r.state, 'house', index);
    r.senateMatched = matchRequesters(r.senate, r.state, 'senate', index);
    for (const m of matchRequesters(r.requesters, r.state, null, index)) {
      const isSen = m.id && people.find(p => p.id.bioguide === m.id)?.terms.some(tm => tm.type === 'sen' && tm.state === r.state);
      (isSen ? r.senateMatched : r.houseMatched).push(m);
    }
    for (const m of [...r.houseMatched, ...r.senateMatched]) if (!m.id) unmatched.set(`${m.name} (${r.state})`, (unmatched.get(`${m.name} (${r.state})`) || 0) + 1);
  }
  results.push({ src, parsed, checks, problems, published: problems.length === 0 });
}

// Report
const usd = n => `$${Math.round(n).toLocaleString('en-US')}`;
let names = 0, matched = 0;
for (const { src, parsed, checks, published, problems } of results) {
  const total = parsed.rows.reduce((a, r) => a + r.amount, 0);
  for (const r of parsed.rows) for (const m of [...r.houseMatched, ...r.senateMatched]) { names++; if (m.id) matched++; }
  console.log(`${published ? 'OK  ' : 'SKIP'} ${src.key.padEnd(13)} ${String(parsed.rows.length).padStart(5)} projects ${usd(total).padStart(16)}  (${src.bill_id} div. ${src.division})`);
  for (const c of checks) console.log(`       ${c.ok ? '✓' : '✗'} ${c.kind}: ${c.detail}`);
  for (const p of problems) console.log(`       ! ${p}`);
}
console.log(`requester names: ${names}, matched to one member: ${matched} (${(100 * matched / names).toFixed(1)}%)`);
console.log('unmatched (most frequent):', [...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} ×${v}`).join(', '));

// Docs
const live = results.filter(r => r.published);
const byState = {}, byMember = {}, stateRows = {};
for (const { src, parsed } of live) {
  for (const r of parsed.rows) {
    const st = r.state || '??';
    byState[st] = byState[st] || [0, 0]; byState[st][0]++; byState[st][1] += r.amount;
    const ids = new Set([...r.houseMatched, ...r.senateMatched].map(m => m.id).filter(Boolean));
    for (const id of ids) { byMember[id] = byMember[id] || [0, 0]; byMember[id][0]++; byMember[id][1] += r.amount; }
    const homes = new Set([r.state, ...[...ids].map(id => homeState.get(id))].filter(Boolean));
    for (const st of homes) (stateRows[st] ||= []).push(r);
    r.table = src.key;
  }
}
const indexDoc = {
  fy,
  tables: results.map(({ src, parsed, checks, published, problems }) => ({
    key: src.key, subcommittee: src.subcommittee, bill_id: src.bill_id, law: src.law, division: src.division,
    published, count: parsed.rows.length, total: parsed.rows.reduce((a, r) => a + r.amount, 0),
    house: parsed.rows.filter(r => r.houseMatched.length).length, senate: parsed.rows.filter(r => r.senateMatched.length).length,
    checks: checks.map(c => ({ kind: c.kind, ok: c.ok, source: c.source, note: c.note })),
    amount_note: src.amountNote || null, problems,
    source_url: `https://www.govinfo.gov/content/pkg/${src.granule.slice(0, 15)}/html/${src.granule}.htm`,
  })),
  totals: { count: live.reduce((a, r) => a + r.parsed.rows.length, 0), total: live.reduce((a, r) => a + r.parsed.rows.reduce((b, x) => b + x.amount, 0), 0) },
  by_state: byState,
  by_member: byMember,
  generated_at: new Date().toISOString(),
};
const tableDocs = live.map(({ src, parsed }) => {
  const packed = packRows(parsed.rows);
  return [`earmarks-${fy}-${src.key}`, { fy, key: src.key, bill_id: src.bill_id, division: src.division, subcommittee: src.subcommittee, ...packed, people: peopleOf(packed) }];
});
const stateDocs = Object.entries(stateRows).map(([st, rows]) => {
  const packed = packRows(rows);
  // Each row also says which table (bill) it comes from.
  packed.rows.forEach((row, i) => row.push(rows[i].table));
  return [`earmarks-${fy}-state-${st}`, { fy, state: st, ...packed, people: peopleOf(packed) }];
});
const size = o => Buffer.byteLength(JSON.stringify(o));
console.log(`docs: index ${Math.round(size(indexDoc) / 1024)} KB; tables ${tableDocs.map(([k, d]) => `${k.replace(`earmarks-${fy}-`, '')} ${Math.round(size(d) / 1024)} KB`).join(', ')}; largest state ${Math.round(Math.max(...stateDocs.map(([, d]) => size(d))) / 1024)} KB (${stateDocs.length} states)`);
for (const [k, d] of [...tableDocs, ...stateDocs]) if (size(d) > 900_000) throw new Error(`${k} is ${size(d)} bytes, too close to Firestore's 1 MB limit`);

if (WRITE) {
  const { getDb, bulkWriter } = await import('../netlify/lib/firebase.js');
  const db = getDb();
  const writer = bulkWriter(db);
  for (const [k, d] of [...tableDocs, ...stateDocs]) writer.set(db.collection('stats').doc(k), d);
  writer.set(db.collection('stats').doc(`earmarks-${fy}`), indexDoc);
  await writer.close();
  console.log(`wrote ${tableDocs.length + stateDocs.length + 1} docs`);
} else {
  console.log('dry run: pass --write to store');
}
