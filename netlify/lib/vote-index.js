// Compact vote index: the small fields of every stored vote, in one server-only doc
// per Congress, session and chamber: `vote_index/{congress}-{session}-{house|senate}`
// (~700 votes x ~300 bytes at most, well under Firestore's 1 MB doc limit).
//
//   { congress, session, chamber, count, entries: [{ id, date, roll, question, result,
//     bill_id, tallies, party_breakdown }], updated_at }
//
// The nightly ingest and the stats rebuild read these 4 docs instead of ~1,600 vote
// docs. The ingest adds each new vote when it applies it (same `members_applied`
// flag as member_votes), and scripts/build-member-votes.js rebuilds them from scratch.
// Firestore rules give browsers no access (only firebase-admin uses it).

import { bulkWriter } from './firebase.js';
import { voteCategory } from './vote-stats.js';
import { billName, billSummaryLine } from '../../public/util.js';
import { isCeremonial } from '../../public/stage.js';

export const indexDocId = (congress, session, chamber) => `${congress}-${session}-${String(chamber).toLowerCase()}`;

export function indexEntry(vote) {
  return {
    id: vote.id || vote.vote_id,
    date: vote.date || null,
    roll: vote.roll_call_number ?? null,
    question: vote.question || null,
    result: vote.result || null,
    bill_id: vote.bill_id || null,
    legislation: vote.legislation || null,            // "HR 2102", "PN 1129" (nominations)
    document_title: vote.document_title || null,      // Senate: bill title or nominee
    tallies: vote.tallies || null,
    party_breakdown: vote.party_breakdown || null,
  };
}

// Group full vote docs by index doc: Map docId -> { congress, session, chamber, entries }.
export function entriesByIndexDoc(votes) {
  const out = new Map();
  for (const v of votes) {
    if (!v.congress || !v.session || !v.chamber) continue;
    const key = indexDocId(v.congress, v.session, v.chamber);
    if (!out.has(key)) out.set(key, { congress: v.congress, session: v.session, chamber: v.chamber, entries: [] });
    out.get(key).entries.push(indexEntry(v));
  }
  return out;
}

// Add or replace entries (by id), oldest first.
export function mergeIndex(existingEntries, entries) {
  const byId = new Map((existingEntries || []).map(e => [e.id, e]));
  for (const e of entries) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// Expand index entries back into vote-shaped objects (the fields stats code uses).
export function indexVotes(doc) {
  return (doc.entries || []).map(e => ({
    ...e,
    congress: doc.congress,
    session: doc.session,
    chamber: doc.chamber,
    roll_call_number: e.roll,
  }));
}

// --- vote_summaries/{vote id}: public, a vote doc without the ~435 member positions
// (~1 KB instead of ~30 KB). The Votes tab and a bill's Votes tab page through these;
// "How each member voted" still loads the full `votes` doc.
// kind: 'passage' (final vote on a bill/resolution), 'nomination', 'rule' (a House rule:
// sets the terms of debate for another bill), 'cloture', 'amendment', 'procedural', 'other'.
// The Votes tab's "Key votes" = passage + nomination.
export function voteKind(question, billTitle) {
  const cat = voteCategory(question || '');
  if (cat === 'passage' && /^Providing for consideration of/i.test(billTitle || '')) return 'rule';
  return cat;
}

export function voteSummary(vote, billTitle = null, billSummary = null, ceremonial = false) {
  const { individual_votes: members, members_applied, updatedAt, id, ...rest } = vote;
  return { ...rest, bill_title: billTitle, bill_summary: billSummary, bill_ceremonial: ceremonial, kind: voteKind(vote.question, billTitle), member_count: Array.isArray(members) ? members.length : 0 };
}

// Bill titles and summary lines come from the bills collection (one read per distinct bill).
export async function writeVoteSummaries(db, votes) {
  const ids = [...new Set(votes.map(v => v.bill_id).filter(Boolean))];
  const titles = new Map(), summaries = new Map(), ceremonial = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    const snaps = await db.getAll(...ids.slice(i, i + 300).map(id => db.collection('bills').doc(id)), { fieldMask: ['title', 'short_title', 'ai_summary', 'type', 'subjects'] });
    snaps.forEach(s => {
      if (!s.exists) return;
      titles.set(s.id, billName(s.data()));
      summaries.set(s.id, billSummaryLine(s.data()));
      if (isCeremonial(s.data())) ceremonial.add(s.id);
    });
  }
  const writer = bulkWriter(db);
  for (const v of votes) writer.set(db.collection('vote_summaries').doc(v.id || v.vote_id), voteSummary(v, titles.get(v.bill_id) ?? null, summaries.get(v.bill_id) ?? null, ceremonial.has(v.bill_id)));
  await writer.close();
  return votes.length;
}

// A bill just got its AI summary: put its first point on the vote cards already stored.
export async function refreshVoteSummaryLines(db, billIds) {
  const writer = bulkWriter(db);
  for (const id of new Set(billIds)) {
    const bill = (await db.collection('bills').doc(id).get()).data();
    const line = billSummaryLine(bill);
    if (!line) continue;
    const votes = await db.collection('vote_summaries').where('bill_id', '==', id).select().get();
    votes.docs.forEach(d => writer.update(d.ref, { bill_summary: line }));
  }
  await writer.close();
}

// Add full vote docs to their index docs. `replace` = start each doc from scratch.
export async function updateVoteIndex(db, admin, votes, { replace = false } = {}) {
  const groups = entriesByIndexDoc(votes);
  if (!groups.size) return 0;
  const refs = [...groups.keys()].map(id => db.collection('vote_index').doc(id));
  const snaps = replace ? [] : await db.getAll(...refs);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await Promise.all([...groups.values()].map((g, i) => {
    const entries = mergeIndex(snaps[i]?.exists ? snaps[i].data().entries : [], g.entries);
    return refs[i].set({ congress: g.congress, session: g.session, chamber: g.chamber, count: entries.length, entries, updated_at: now });
  }));
  return groups.size;
}

// Every indexed vote of a Congress (both sessions, both chambers), or null if the
// Congress has no index docs at all (callers then fall back to querying `votes`).
export async function loadVoteIndex(db, congress) {
  const refs = [1, 2].flatMap(s => ['House', 'Senate'].map(c => db.collection('vote_index').doc(indexDocId(congress, s, c))));
  const snaps = await db.getAll(...refs);
  const docs = snaps.filter(s => s.exists).map(s => s.data());
  return docs.length ? docs.flatMap(indexVotes) : null;
}
