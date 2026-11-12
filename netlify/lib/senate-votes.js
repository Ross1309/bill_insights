// Senate roll-call votes from senate.gov's official LIS XML (Congress.gov's API has
// House votes only). Shaped into the same `votes` doc schema as House votes.
//
// Vote menu:  /legislative/LIS/roll_call_lists/vote_menu_{congress}_{session}.xml
// One vote:   /legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{c}_{s}_{00000}.xml
// Senators are identified by LIS member id (e.g. "S428"); callers pass a
// lis -> bioguideId map (from the congress-legislators dataset).

import { partyBreakdown } from './vote-stats.js';
import { getText as fetchText } from './http.js';

const getText = url => fetchText(url, { headers: HEADERS });

const LIS = 'https://www.senate.gov/legislative/LIS';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; CongressWatcher/1.0)' };
const BILL_TYPES = new Set(['HR', 'S', 'HRES', 'SRES', 'HJRES', 'SJRES', 'HCONRES', 'SCONRES']);
const TALLY_KEYS = { yea: 'yea', aye: 'yea', nay: 'nay', no: 'nay', present: 'present', 'not voting': 'not_voting' };
const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
}

// First <name>…</name> in xml (no attributes are used in these files).
function tag(xml, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  const v = m ? decode(m[1]).replace(/\s+/g, ' ').trim() : '';
  return v || null;
}

function blocks(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map(m => m[1]);
}

// Offset of a time zone from UTC at a given instant, in minutes (e.g. -300 for EST).
function tzOffsetMinutes(date, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(date).find(p => p.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] || 0);
  return m[1] === '-' ? -minutes : minutes;
}

// "November 10, 2026, 07:37 PM" (Eastern) -> UTC ISO string, DST-aware.
export function parseSenateDate(text) {
  const m = /^([A-Za-z]+) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}) ?([AP]M)$/i.exec((text || '').trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'PM') hour += 12;
  const asUtc = Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]));
  const offset = tzOffsetMinutes(new Date(asUtc), 'America/New_York');
  return new Date(asUtc - offset * 60000).toISOString();
}


async function fetchMenu(congress, session) {
  const xml = await getText(`${LIS}/roll_call_lists/vote_menu_${congress}_${session}.xml`);
  return blocks(xml, 'vote')
    .map(v => Number(tag(v, 'vote_number')))
    .filter(Boolean)
    .map(number => ({ congress, session, number }));
}

function parseVote(xml, { congress, session, number }, lisToBioguide) {
  const docType = (tag(xml, 'document_type') || '').replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
  const docNumber = tag(xml, 'document_number');
  const docCongress = Number(tag(xml, 'document_congress')) || congress;
  const isBill = BILL_TYPES.has(docType) && /^\d+$/.test(docNumber || '');

  let unmapped = 0;
  const individual_votes = blocks(xml, 'member').map(mb => {
    const lis = tag(mb, 'lis_member_id');
    const bioguideId = (lis && lisToBioguide?.get(lis)) || null;
    if (!bioguideId) unmapped++;
    return {
      bioguideId,
      lis_member_id: lis,
      name: [tag(mb, 'last_name'), tag(mb, 'first_name')].filter(Boolean).join(', ') || null,
      state: tag(mb, 'state'),
      party: tag(mb, 'party'),
      position: tag(mb, 'vote_cast'),
    };
  });

  const tallies = individual_votes.reduce((acc, m) => {
    const key = TALLY_KEYS[(m.position || '').toLowerCase()] || 'other';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { yea: 0, nay: 0, present: 0, not_voting: 0 });

  const majority = tag(xml, 'majority_requirement');
  const id = `${congress}-${session}-senate-vote-${number}`;
  const padded = String(number).padStart(5, '0');

  return {
    unmapped,
    doc: {
      vote_id: id,
      bill_id: isBill ? `${docType.toLowerCase()}${docNumber}-${docCongress}` : null,
      // "HR 2347", or e.g. "PN 512" for nominations (not a bill, so no bill_id).
      legislation: docType && docNumber ? `${docType} ${docNumber}` : null,
      document_title: tag(xml, 'document_title') || tag(xml, 'vote_document_text'),
      amendment: tag(xml, 'amendment_number'),
      chamber: 'Senate',
      congress,
      session,
      roll_call_number: number,
      date: parseSenateDate(tag(xml, 'vote_date')),
      question: tag(xml, 'question') || tag(xml, 'vote_question_text'),
      title: tag(xml, 'vote_title'),
      vote_type: majority ? `Majority required: ${majority}` : null,
      result: tag(xml, 'vote_result'),
      tallies,
      individual_votes,
      party_breakdown: partyBreakdown(individual_votes),
      source_url: `${LIS}/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padded}.htm`,
    },
  };
}

// Vote entries ({ congress, session, number }) for the given sessions, newest first.
// The first session listed is the current one: if its menu can't be read, throw (a
// silent empty list would report a healthy run while missing every new vote). An
// earlier session's menu is optional.
export async function listSenateVotes(congress, sessions = [2, 1]) {
  const entries = [];
  for (const [i, session] of sessions.entries()) {
    entries.push(...await fetchMenu(congress, session).catch(err => {
      if (i === 0) throw new Error(`Senate vote menu ${congress}-${session} unavailable: ${err.message}`);
      console.warn(`Senate vote menu ${congress}-${session} unavailable: ${err.message}`);
      return [];
    }));
  }
  return entries.sort((a, b) => b.session - a.session || b.number - a.number);
}

export function senateVoteId({ congress, session, number }) {
  return `${congress}-${session}-senate-vote-${number}`;
}

// One entry -> { doc, unmapped }.
export async function fetchSenateVote(entry, lisToBioguide) {
  const padded = String(entry.number).padStart(5, '0');
  const xml = await getText(`${LIS}/roll_call_votes/vote${entry.congress}${entry.session}/vote_${entry.congress}_${entry.session}_${padded}.xml`);
  return parseVote(xml, entry, lisToBioguide);
}

