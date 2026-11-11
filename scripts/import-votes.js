// Backfill every House and Senate roll-call vote of a congress into `votes`.
// Resumable: votes already in Firestore are skipped, so re-running continues.
//
//   node scripts/import-votes.js                    # dry run: counts what's missing
//   node scripts/import-votes.js --write            # import all missing votes
//   node scripts/import-votes.js --write --chamber senate --limit 100
//   node scripts/import-votes.js --write --congress 118
//
// House votes come from Congress.gov (1 request per vote); Senate votes from
// senate.gov XML (1 request per vote, gently rate limited).

import 'dotenv/config';
import { getDb, admin } from '../netlify/lib/firebase.js';
import { listHouseVotes, buildHouseVoteDoc } from '../netlify/lib/house-votes.js';
import { listSenateVotes, fetchSenateVote, senateVoteId, currentCongressSession } from '../netlify/lib/senate-votes.js';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const WRITE = flag('write');
const CONGRESS = Number(option('congress', currentCongressSession().congress));
const CHAMBER = option('chamber', 'both');
const LIMIT = Number(option('limit', Infinity));
const { CONGRESS_API_KEY } = process.env;
if (!CONGRESS_API_KEY) throw new Error('CONGRESS_API_KEY is not set.');

// Current AND historical legislators: senators who have since left (resigned,
// appointed elsewhere, replaced) still need their LIS id mapped for past votes.
const LEGISLATORS_URLS = [
  'https://unitedstates.github.io/congress-legislators/legislators-current.json',
  'https://unitedstates.github.io/congress-legislators/legislators-historical.json',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadLisMap() {
  const map = new Map();
  for (const url of LEGISLATORS_URLS) {
    const list = await (await fetch(url)).json();
    for (const l of list) if (l.id?.lis && l.id?.bioguide && !map.has(l.id.lis)) map.set(l.id.lis, l.id.bioguide);
  }
  return map;
}

// Fill in bioguideId on stored Senate votes where it's missing but now mappable.
async function remapSenateVotes(db, lisToBioguide) {
  const snap = await db.collection('votes').where('chamber', '==', 'Senate').get();
  const writer = db.bulkWriter();
  let docs = 0, entries = 0;
  for (const d of snap.docs) {
    const votes = d.data().individual_votes || [];
    let changed = 0;
    const fixed = votes.map(v => {
      if (v.bioguideId || !v.lis_member_id || !lisToBioguide.has(v.lis_member_id)) return v;
      changed++;
      return { ...v, bioguideId: lisToBioguide.get(v.lis_member_id) };
    });
    if (changed) {
      writer.update(d.ref, { individual_votes: fixed });
      docs++;
      entries += changed;
    }
  }
  await writer.close();
  return { docs, entries };
}

// Run `fn` over items with a small concurrency limit.
async function pool(items, concurrency, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

async function main() {
  const db = getDb();
  const { FieldValue } = admin.firestore;
  const existing = new Set((await db.collection('votes').select().get()).docs.map(d => d.id));
  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'}: congress ${CONGRESS}, chamber ${CHAMBER}; ${existing.size} votes already stored\n`);

  const tasks = [];
  if (CHAMBER === 'both' || CHAMBER === 'house') {
    const house = await listHouseVotes(CONGRESS, CONGRESS_API_KEY);
    const missing = house.filter(v => !existing.has(`${CONGRESS}-${v.sessionNumber}-house-vote-${v.rollCallNumber}`));
    console.log(`House: ${house.length} roll calls, ${missing.length} missing`);
    tasks.push(...missing.map(item => ({ chamber: 'House', item })));
  }
  if (CHAMBER === 'both' || CHAMBER === 'senate') {
    const senate = await listSenateVotes(CONGRESS, [2, 1]);
    const missing = senate.filter(e => !existing.has(senateVoteId(e)));
    console.log(`Senate: ${senate.length} roll calls, ${missing.length} missing`);
    tasks.push(...missing.map(entry => ({ chamber: 'Senate', entry })));
  }

  const todo = tasks.slice(0, LIMIT);
  if (!WRITE) {
    console.log(`\nWould import ${todo.length} votes. Re-run with --write.`);
    return;
  }

  const needsSenate = CHAMBER === 'both' || CHAMBER === 'senate';
  const lisToBioguide = needsSenate ? await loadLisMap() : new Map();

  const writer = db.bulkWriter();
  const counts = { House: 0, Senate: 0, failed: 0, unmapped: 0 };
  const house = todo.filter(t => t.chamber === 'House');
  const senate = todo.filter(t => t.chamber === 'Senate');
  const progress = () => {
    const done = counts.House + counts.Senate + counts.failed;
    if (done % 50 === 0) console.log(`  ${done}/${todo.length} (House ${counts.House}, Senate ${counts.Senate}, failed ${counts.failed})`);
  };

  await Promise.all([
    pool(house, 4, async ({ item }) => {
      try {
        const doc = await buildHouseVoteDoc(item, CONGRESS, CONGRESS_API_KEY);
        writer.set(db.collection('votes').doc(doc.vote_id), { ...doc, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        counts.House++;
      } catch (err) {
        console.error(`  ✗ House ${item.sessionNumber}/${item.rollCallNumber}: ${err.message}`);
        counts.failed++;
      }
      progress();
    }),
    pool(senate, 2, async ({ entry }) => {
      try {
        const { doc, unmapped } = await fetchSenateVote(entry, lisToBioguide);
        writer.set(db.collection('votes').doc(doc.vote_id), { ...doc, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        counts.Senate++;
        counts.unmapped += unmapped;
      } catch (err) {
        console.error(`  ✗ Senate ${entry.session}/${entry.number}: ${err.message}`);
        counts.failed++;
      }
      progress();
      await sleep(150); // be gentle with senate.gov
    }),
  ]);
  await writer.close();

  if (needsSenate) {
    const fixed = await remapSenateVotes(db, lisToBioguide);
    console.log(`Remapped ${fixed.entries} senator entries on ${fixed.docs} stored Senate votes.`);
  }

  console.log(`\nDone. ${JSON.stringify(counts)}`);
  if (counts.unmapped) {
    console.log('Note: "unmapped" = senator entries with no bioguide id in current or historical legislators.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
