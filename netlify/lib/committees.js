// Members' committee seats, from the public-domain congress-legislators dataset:
// committees-current.json (names, subcommittees) + committee-membership-current.json
// ({ "HSJU": [{ bioguide, title, rank, party }], "HSJU08": [...] }: subcommittee ids are
// the committee id + the subcommittee's thomas_id).

import { getJson } from './http.js';

const BASE = 'https://unitedstates.github.io/congress-legislators';

// bioguideId -> [{ id, name, title, subcommittees: [{ name, title }] }], or null when the
// dataset can't be read (callers then leave stored committees alone).
export async function fetchMemberCommittees() {
  try {
    const [committees, membership] = await Promise.all([
      getJson(`${BASE}/committees-current.json`, { timeoutMs: 20000 }),
      getJson(`${BASE}/committee-membership-current.json`, { timeoutMs: 20000 }),
    ]);
    return memberCommittees(committees, membership);
  } catch (err) {
    console.warn(`committee data unavailable (${err.message}); committees left unchanged.`);
    return null;
  }
}

// Pure: build the per-member lists. Full committees with a title (Chair, Ranking Member …)
// first, then by name; subcommittees listed under their committee only when the member
// also sits on it (they always do).
export function memberCommittees(committees, membership) {
  const byMember = new Map();
  const seat = (id, bioguide) => (membership[id] || []).find(m => m.bioguide === bioguide);
  for (const c of committees || []) {
    for (const m of membership[c.thomas_id] || []) {
      if (!m.bioguide) continue;
      const subs = (c.subcommittees || [])
        .map(s => ({ s, mine: seat(`${c.thomas_id}${s.thomas_id}`, m.bioguide) }))
        .filter(x => x.mine)
        .map(({ s, mine }) => ({ name: s.name, title: mine.title || null }));
      const list = byMember.get(m.bioguide) || [];
      list.push({ id: c.thomas_id, name: c.name, title: m.title || null, subcommittees: subs });
      byMember.set(m.bioguide, list);
    }
  }
  const subject = n => n.replace(/^(House|Senate|Joint) (Select |Permanent Select |Special )?Committee on (the )?/i, '');
  for (const list of byMember.values()) list.sort((a, b) => (b.title ? 1 : 0) - (a.title ? 1 : 0) || subject(a.name).localeCompare(subject(b.name)));
  return byMember;
}
