// "This Congress so far": daily series for one Congress, so any Congress can be compared
// with another at the same day of its two-year term (public/congress-page.js).
//
// stats/congress-<n> (public read, under stats/):
//   { congress, start: "YYYY-MM-DD" (Jan 3), as_of, final, days,
//     introduced, passed_one, passed_both, laws, floor_voted: [daily counts, index = day],
//     votes: { House, Senate: [daily counts] },
//     split: { House|Senate: { same, opposed: [daily counts] } },
//     totals: { ...same names: sums }, generated_at }
// Daily counts, not running totals (smaller); the page adds them up. Day 0 = January 3;
// laws signed after the term ends (the President's last signings) run past day 730.
//
// Bills = measures that can become law: H.R., S., H.J.Res., S.J.Res. Passage dates are
// the first "Passed/agreed to in House|Senate" action (the same rule as the bill stage).
// Sources: GovInfo BILLSTATUS (bulk, past Congresses), Congress.gov (bill actions, House
// votes), senate.gov (Senate votes), the House Clerk (party totals of past House votes).

import { partyAlignment, easternDate } from './vote-stats.js';
import { loadVoteIndex } from './vote-index.js';

export const LAW_TYPES = ['hr', 's', 'hjres', 'sjres'];
export const congressStart = c => `${1787 + 2 * c}-01-03`;
export const dayIndex = (start, ymd) => Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400e3);

// First House / Senate passage and the law date, from a bill's actions
// ([{ actionDate, text }]; any order).
export function passageDates(actions = []) {
  const first = re => actions.filter(a => re.test((a.text || '').trim())).map(a => a.actionDate).filter(Boolean).sort()[0] || null;
  return {
    house: first(/^passed\/agreed to in house/i),
    senate: first(/^passed\/agreed to in senate/i),
    law: first(/^became (public|private) law/i),
  };
}

// One GovInfo BILLSTATUS file -> { introduced, house, senate, law }. Only the bill's own
// <actions> (4-space indent, a child of <bill>): related bills and amendments carry
// actions of their own.
export function parseBillStatus(xml) {
  const introduced = /<introducedDate>([^<]+)<\/introducedDate>/.exec(xml)?.[1] || null;
  const block = /\n {4}<actions>([\s\S]*?)\n {4}<\/actions>/.exec(xml)?.[1] || '';
  const actions = [...block.matchAll(/<actionDate>([^<]+)<\/actionDate>(?:(?!<actionDate>)[\s\S])*?<text>([\s\S]*?)<\/text>/g)]
    .map(m => ({ actionDate: m[1], text: m[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim() }));
  return { introduced, ...passageDates(actions), actionCount: actions.length };
}

// House Clerk roll-call XML -> { D|R|I: { yea, nay } } ("Aye"/"No" totals count as yea/nay).
const PARTY = { Republican: 'R', Democratic: 'D', Independent: 'I' };
export function houseClerkBreakdown(xml) {
  const out = {};
  for (const m of xml.matchAll(/<totals-by-party>([\s\S]*?)<\/totals-by-party>/g)) {
    const p = PARTY[/<party>([^<]+)<\/party>/.exec(m[1])?.[1]?.trim()];
    if (!p) continue;
    const n = tag => Number(new RegExp(`<${tag}>(\\d+)</${tag}>`).exec(m[1])?.[1] || 0);
    out[p] = { yea: n('yea-total'), nay: n('nay-total') };
  }
  return out;
}

// Is an updated bill worth fetching the actions of (did it maybe pass a chamber)? From
// Congress.gov's update list: { latestAction: { text }, originChamber }. Skipped: bills
// whose latest action is a referral or committee step in their own chamber, or the
// introduction. A bill referred in the *other* chamber has passed its own, so it counts.
export function maybePassed({ latestAction, originChamber } = {}) {
  const t = String(latestAction?.text || '').trim();
  if (!t) return false;
  const own = originChamber === 'Senate' ? 'Senate' : 'House';
  if (/^(introduced|sponsor introductory remarks)/i.test(t)) return false;
  if (/^referred to the (house )?(sub)?committee/i.test(t) || /^referred to the subcommittee/i.test(t)) return own !== 'House';
  if (/^read twice and referred to/i.test(t)) return own !== 'Senate';
  return true;
}

// Party split of one vote (partyAlignment): 'same' | 'opposed' | 'unclear'.
export const splitOf = breakdown => partyAlignment(breakdown || {});

// Build the stats doc from per-item dates. Every date is "YYYY-MM-DD" (Eastern for votes).
//   introducedByDay: [daily counts] (index = day) or introducedDates: [dates]
//   bills: [{ house, senate }] (passage dates; only bills that passed something needed)
//   lawDates: [dates]; votes: [{ date, chamber, measure (e.g. "hr1234") | null, split }]
export function buildCongressDoc({ congress, asOf, final = false, introducedByDay = null, introducedDates = [], bills = [], lawDates = [], votes = [] }) {
  const start = congressStart(congress);
  const lastDay = Math.max(0, final ? dayIndex(start, asOf) : Math.min(dayIndex(start, asOf), 800));
  const series = () => new Array(lastDay + 1).fill(0);
  const add = (arr, ymd) => { const d = ymd ? dayIndex(start, ymd) : -1; if (d >= 0 && d <= lastDay) arr[d]++; };

  const introduced = introducedByDay ? [...introducedByDay, ...series()].slice(0, lastDay + 1) : series();
  if (!introducedByDay) introducedDates.forEach(d => add(introduced, d));
  const passedOne = series(), passedBoth = series(), laws = series(), floorVoted = series();
  for (const b of bills) {
    const one = [b.house, b.senate].filter(Boolean).sort();
    if (one.length) add(passedOne, one[0]);
    if (one.length === 2) add(passedBoth, one[1]);
  }
  lawDates.forEach(d => add(laws, d));

  const v = { House: series(), Senate: series() };
  const split = { House: { same: series(), opposed: series() }, Senate: { same: series(), opposed: series() } };
  const firstVote = new Map();
  for (const x of votes) {
    if (!v[x.chamber]) continue;
    add(v[x.chamber], x.date);
    if (x.split === 'same' || x.split === 'opposed') add(split[x.chamber][x.split], x.date);
    const law = x.measure && LAW_TYPES.includes(x.measure.replace(/\d+$/, ''));
    if (law && (!firstVote.has(x.measure) || x.date < firstVote.get(x.measure))) firstVote.set(x.measure, x.date);
  }
  for (const d of firstVote.values()) add(floorVoted, d);

  const sum = a => a.reduce((s, n) => s + n, 0);
  return {
    congress, start, as_of: asOf, final, days: lastDay + 1,
    introduced, passed_one: passedOne, passed_both: passedBoth, laws, floor_voted: floorVoted, votes: v, split,
    totals: {
      introduced: sum(introduced), passed_one: sum(passedOne), passed_both: sum(passedBoth), laws: sum(laws), floor_voted: sum(floorVoted),
      votes: { House: sum(v.House), Senate: sum(v.Senate) },
      split: { House: { same: sum(split.House.same), opposed: sum(split.House.opposed) }, Senate: { same: sum(split.Senate.same), opposed: sum(split.Senate.opposed) } },
    },
  };
}

// --- The Congress in progress: from stored data + the upkeep state ---------------------
// sync_state/congress-<n> (server only), kept by sync-congress-stats and seeded by
// scripts/build-congress-stats.js:
//   { introduced: [daily counts], max: { hr: highest bill number counted, ... },
//     bills: { "hr1234": { h: date|null, s: date|null } } (bills that passed a chamber),
//     last_check: ISO (Congress.gov update window), updated_at }
// Votes come from vote_index (party splits from party_breakdown), laws from `bills`.

export async function currentCongressDoc(db, congress, state, asOf) {
  const index = await loadVoteIndex(db, congress) || [];
  const votes = index.map(v => ({
    date: easternDate(v.date), chamber: v.chamber, split: splitOf(v.party_breakdown),
    measure: v.bill_id ? String(v.bill_id).split('-')[0] : null,
  }));
  const lawSnap = await db.collection('bills').where('stage', '==', 'law').select('congress', 'law_date', 'latestAction').get();
  const lawDates = lawSnap.docs.map(d => d.data()).filter(b => Number(b.congress) === congress)
    .map(b => b.law_date || b.latestAction?.actionDate || null).filter(Boolean);
  const bills = Object.values(state?.bills || {}).map(b => ({ house: b.h || null, senate: b.s || null }));
  return buildCongressDoc({ congress, asOf, introducedByDay: state?.introduced || [], bills, lawDates, votes });
}

// Bills of a type numbered after `fromNumber`, from Congress.gov: numbers are assigned in
// order but not without gaps (S. 5718 existed when only 5,702 Senate bills did), so this
// walks forward until `misses` numbers in a row don't exist. Returns { dates: [[number,
// introducedDate]], max } where max is the last number known to be done (a failed request
// stops the walk there, to be retried next time).
export async function probeNewBills(getJson, congress, type, fromNumber, key, { limit = 150, misses = 8, concurrency = 8 } = {}) {
  const dates = [];
  let n = fromNumber, gap = 0;
  while (gap < misses && dates.length < limit) {
    const batch = Array.from({ length: concurrency }, (_, i) => n + 1 + i);
    const res = await Promise.all(batch.map(k => getJson(`https://api.congress.gov/v3/bill/${congress}/${type}/${k}?api_key=${key}&format=json`)
      .then(r => r?.bill?.introducedDate || null, err => (err.status === 404 ? null : 'error'))));
    for (let i = 0; i < batch.length; i++) {
      if (res[i] === 'error') return { dates, max: n };
      if (res[i]) { dates.push([batch[i], res[i]]); gap = 0; } else gap++;
      n = batch[i];
      if (gap >= misses) break;
    }
  }
  // Trailing misses aren't "done": the next bill may get one of those numbers.
  return { dates, max: dates.length ? Math.max(fromNumber, dates.at(-1)[0]) : fromNumber };
}
