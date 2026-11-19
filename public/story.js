// A bill's story: the milestones of its official action history as a short timeline, in
// plain words. Pure: official actions (bill-detail) + the bill's stored votes -> steps.
// Only what an action says happens here; anything unrecognized is left to the Actions tab.

export function recordedVoteId(rv) {
  const chamber = { House: "house", Senate: "senate" }[rv?.chamber];
  if (!chamber || !rv.congress || !rv.session || !rv.rollNumber) return null;
  return `${rv.congress}-${rv.session}-${chamber}-vote-${rv.rollNumber}`;
}

const other = c => (c === "House" ? "Senate" : "House");
const OVERRIDE = /objections of the president|over(?:riding)? (?:the )?veto/i;

// "215–214" from the stored vote, else from the action's own text.
function tally(action, votes) {
  const rv = action.recordedVotes?.[0];
  const id = recordedVoteId(rv);
  const v = id ? votes.find(x => x.id === id) : null;
  if (v?.tallies?.yea != null) {
    const tie = v.tie_breaker?.by ? `, the ${v.tie_breaker.by} broke the tie` : "";
    return { text: `${v.tallies.yea}–${v.tallies.nay}${tie}`, voteId: id };
  }
  const m = /(?:Yeas and Nays|recorded vote|Yea-Nay Vote\.?)[:\s]*(\d+)\s*-\s*(\d+)/i.exec(action.text);
  return { text: m ? `${m[1]}–${m[2]}` : null, voteId: id && v ? id : null };
}
function how(action, votes) {
  const t = tally(action, votes);
  if (t.text) return t;
  if (/voice vote/i.test(action.text)) return { text: "by voice vote", voteId: null };
  if (/unanimous consent|without objection/i.test(action.text)) return { text: "by unanimous consent", voteId: null };
  return { text: null, voteId: null };
}

// One chamber settling the differences: accepting the other's amendment outright, or
// approving a conference report. A counter-amendment or a request for a conference isn't.
function settled(text) {
  const framed = /^resolving differences -- (house|senate) actions:\s*(.*)$/i.exec(text);
  const body = framed ? framed[2] : text;
  if (!/agreed to/i.test(body) || /disagree|with an amendment/i.test(body)) return null;
  const said = /^on motion that the (house) agree to the senate amendment\b/i.exec(body) || /^(house|senate) agreed to (?:the )?(?:senate|house) amendment\b/i.exec(body);
  const compromise = framed && /conference report/i.test(body);
  const raw = framed?.[1] || said?.[1];
  if (!raw || (!said && !compromise)) return null;
  return { chamber: raw[0].toUpperCase() + raw.slice(1).toLowerCase(), compromise: Boolean(compromise) };
}

// Order of steps that share a date.
const RANK = { introduced: 0, committee: 1, reported: 2, floor: 3, committee2: 4, reported2: 5, floor2: 6, agreed: 7, presented: 8, vetoed: 9, override: 10, law: 11 };

// bill: { introduced_date, chamber, type }; actions: newest or oldest first; votes: the
// bill's vote_summaries. -> [{ key, date, text, detail, voteId }], oldest first.
export function billStory(bill, actions = [], votes = []) {
  const origin = bill?.chamber === "Senate" || (!bill?.chamber && /^S/i.test(bill?.type || "")) ? "Senate" : "House";
  const resolution = /RES$/i.test(String(bill?.type || "").replace(/[.\s]/g, "")) && !/J/i.test(String(bill?.type || ""));
  const steps = new Map();
  const add = (key, rank, date, text, extra = {}) => { if (!steps.has(key)) steps.set(key, { key, rank, date, text, detail: null, voteId: null, ...extra }); };
  const chamberOf = a => /\bsenate\b/i.exec(a.source || "")?.[0] ? "Senate" : /\bhouse\b/i.test(a.source || "") ? "House" : null;

  const ordered = [...actions].filter(a => a.actionDate).sort((a, b) => a.actionDate.localeCompare(b.actionDate));
  for (const a of ordered) {
    const t = a.text.trim();
    let m;
    if ((m = /^introduced in (?:the )?(house|senate)/i.exec(t))) {
      const c = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      add("introduced", RANK.introduced, a.actionDate, `Introduced in the ${c}`);
    } else if ((m = /referred (?:jointly )?to the ((?:house |senate )?committee on [^,.;]+)/i.exec(t))) {
      const c = /received in the (house|senate)/i.exec(t)?.[1];
      const chamber = c ? c[0].toUpperCase() + c.slice(1).toLowerCase() : /^senate /i.test(m[1]) ? "Senate" : /^house /i.test(m[1]) ? "House" : chamberOf(a) || origin;
      const name = m[1].replace(/^(house|senate) /i, "").replace(/^committee/i, "Committee");
      add(`committee-${chamber}`, chamber === origin ? RANK.committee : RANK.committee2, a.actionDate, `Sent to the ${chamber} ${name}`);
    } else if (/^(ordered to be reported|reported (?:\(amended\) )?by)/i.test(t)) {
      const chamber = chamberOf(a) || origin;
      add(`reported-${chamber}`, chamber === origin ? RANK.reported : RANK.reported2, a.actionDate, `A committee sent it to the full ${chamber}`);
    } else if ((m = /^passed\/agreed to in (house|senate):/i.exec(t))) {
      const c = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), h = how(a, votes);
      if (OVERRIDE.test(t)) add(`override-${c}`, RANK.override, a.actionDate, `The ${c} voted to override the veto`, { detail: h.text, voteId: h.voteId });
      else add(`passed-${c}`, c === origin ? RANK.floor : RANK.floor2, a.actionDate,
        `${resolution ? "Agreed to in" : "Passed"} the ${c}${c !== origin && /with an amendment|with amendments/i.test(t) ? " with changes" : ""}`, { detail: h.text, voteId: h.voteId });
    } else if ((m = /^failed of passage\/not agreed to in (house|senate):/i.exec(t))) {
      const c = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), h = how(a, votes);
      if (OVERRIDE.test(t)) add(`override-${c}`, RANK.override, a.actionDate, `The ${c} failed to override the veto`, { detail: h.text, voteId: h.voteId });
      else add(`failed-${c}`, c === origin ? RANK.floor : RANK.floor2, a.actionDate, `Failed in the ${c}`, { detail: h.text, voteId: h.voteId });
    } else if ((m = settled(t))) {
      const h = how(a, votes);
      add(`agreed-${m.chamber}`, RANK.agreed, a.actionDate, m.compromise ? `The ${m.chamber} approved the compromise version` : `The ${m.chamber} accepted the ${other(m.chamber)}'s changes`, { detail: h.text, voteId: h.voteId });
    } else if (/^presented to president/i.test(t)) add("presented", RANK.presented, a.actionDate, "Sent to the President");
    else if (/^vetoed by president/i.test(t)) add("vetoed", RANK.vetoed, a.actionDate, "Vetoed by the President");
    else if ((m = /^became (public|private) law no:?\s*([\d-]+)/i.exec(t))) add("law", RANK.law, a.actionDate, `Became ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} Law ${m[2]}`);
  }
  if (!steps.has("introduced") && bill?.introduced_date) add("introduced", RANK.introduced, bill.introduced_date, `Introduced in the ${origin}`);
  return [...steps.values()].sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank);
}
