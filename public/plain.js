// Plain-language wording for votes, from the official record (no judgment calls):
//  - a House "rule" (H.Res. "Providing for consideration of the bill (H.R. X)...") sets
//    the terms of debate for another bill
//  - bills pass or are rejected; resolutions are adopted or rejected; nominees are
//    confirmed or rejected
// Official terms stay: Yea / Nay.

import { officialLabel } from "./util.js";

// A House rule's title names the measure it sets debate terms for in its first parentheses:
// "the bill (H.R. 1)", "the joint resolution (H.J. Res. 60)", "the Senate amendment to ... (H.R. 4)".
const RULE = /^Providing for consideration of [^(]*\(([^)]+)\)/i;
const short = title => String(title || "").replace(/ of \d{4}$/, "");
// Long descriptive titles ("Providing for congressional disapproval under chapter 8 …") are
// cut in headlines; the full title is on the card and the bill page.
const clip = (t, n = 110) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t);

// What kind of question a vote was, from its official wording (most specific first).
// Only "passage" decides a measure; the rest are steps on the way, and their headlines
// say so (a cloture vote on a bill is not the bill passing).
export function questionKind(question = "") {
  const q = String(question).toLowerCase();
  // "Table" first: "On Motion to Table the Motion to Discharge" sets the discharge aside
  // (the bill stays in committee), the opposite of a discharge vote.
  if (/\btable\b/.test(q)) return "table";
  if (/cloture/.test(q)) return "cloture";
  if (/nomination/.test(q)) return "nomination";
  if (/election of the speaker/.test(q)) return "speaker";
  if (/motion to proceed/.test(q)) return "proceed";
  if (/previous question/.test(q)) return "previous_question";
  if (/\b(re)?commit\b/.test(q)) return "recommit";
  if (/motion to refer\b/.test(q)) return "refer";
  if (/discharge/.test(q)) return "discharge";
  if (/objections of the president|overrid/.test(q)) return "override";
  if (/\bconcur(rence)?\b/.test(q)) return "concur";   // not "concurrent resolution"
  if (/amendment/.test(q)) return "amendment";
  if (/passage|pass the bill|suspend the rules and (pass|agree)|agreeing to the resolution|^on the (joint |concurrent )?resolution|^on the bill/.test(q)) return "passage";
  return "other";
}

export function voteHeadline(v) {
  const ok = v.outcome === "succeeded";
  const ch = v.chamber || "Congress";
  const kind = questionKind(v.question);
  if (!v.bill) {
    const who = String(v.document_title || v.legislation || "a nominee").split(",")[0];
    if (kind === "nomination") return `${ch} ${ok ? "confirmed" : "rejected"} ${who}`;
    if (kind === "speaker") return `${ch} elected the Speaker`;
    if (kind === "cloture" && v.document_title) return `${ch} ${ok ? "voted to end debate" : "voted not to end debate"} on the nomination of ${who}`;
    return `${ch}: ${v.question || "vote"}`;
  }
  const label = officialLabel(v.bill.label || v.bill.id);
  const isResolution = /^[hs](con|j)?res/i.test(String(v.bill.id || v.bill.label || "").replace(/[.\s]/g, ""));
  const title = short(v.bill.title);
  const rule = RULE.exec(v.bill.title || "");
  // A short title ("Major Richard Star Act") reads as a name; a descriptive one ("To amend
  // title 10...", "Condemning ...", "A joint resolution ...") reads better after the label.
  const descriptive = /^(to |an? \w|[a-z]+ing\b)/i.test(title);   // "To amend…", "A bill…", "An executive resolution…", "Condemning…"
  const ruleFor = rule ? officialLabel(rule[1]) : null;
  const subject = rule ? `the rule for ${ruleFor}` : title && !descriptive ? `the ${title}` : label;
  const other = ch === "House" ? "Senate" : "House";
  switch (kind) {
    case "cloture": return `${ch} ${ok ? "voted to end debate" : "voted not to end debate"} on ${subject}`;
    case "proceed": return `${ch} ${ok ? "agreed to take up" : "voted not to take up"} ${subject}`;
    case "previous_question": return `${ch} ${ok ? "voted to end debate" : "voted not to end debate"} on ${subject}`;
    case "recommit": return `${ch} ${ok ? "sent" : "voted not to send"} ${subject} back to committee`;
    // Usually a privileged resolution (censure, impeachment) sent to committee instead of voted on.
    case "refer": return `${ch} ${ok ? "sent" : "voted not to send"} ${subject} to committee`;
    case "discharge": return `${ch} ${ok ? "voted to take" : "voted not to take"} ${subject} out of committee`;
    case "table": {
      // Name what was set aside when the record says: the question in the House; in the
      // Senate the question is always the bare "On the Motion to Table" and what was
      // tabled is in the vote's title ("Motion to Table the Point of Order …").
      const q = `${v.question || ""} ${ch === "Senate" ? v.title || "" : ""}`.toLowerCase();
      const what = /discharge/.test(q) ? `a motion to take ${subject} out of committee`
        : /recommit|\bcommit\b/.test(q) ? `a motion to send ${subject} back to committee`
        : /reconsider/.test(q) ? `a motion to reconsider the vote on ${subject}`
        : /appeal|ruling of the chair/.test(q) ? `an appeal of the chair's ruling on ${subject}`
        : /point of order/.test(q) ? `a point of order on ${subject}`
        : /amendment/.test(q) ? `an amendment to ${subject}`
        // A bare House "On Motion to Table" on a resolution tables the resolution itself.
        : ch === "House" && /^on (the )?motion to table$/.test(String(v.question || "").toLowerCase().trim()) && isResolution ? subject
        : `a motion on ${subject}`;
      return `${ch} ${ok ? "set aside" : "voted not to set aside"} ${what}`;
    }
    case "override": return `${ch} ${ok ? "voted to override" : "failed to override"} the veto of ${subject}`;
    case "concur": return `${ch} ${ok ? "agreed to" : "rejected"} the ${other}'s changes to ${subject}`;
    case "amendment": return `${ch} ${ok ? "adopted" : "rejected"} an amendment to ${subject}`;
    case "passage": break;
    default: return `${ch}: ${v.question || "vote"} (${label})`;
  }
  if (rule) return `${ch} ${ok ? "agreed to" : "rejected"} the terms of debate for ${ruleFor}`;
  // Simple and concurrent resolutions (H.Res., S.Con.Res. ...) are adopted; bills and
  // joint resolutions are passed (as the official result says).
  const isRes = /^[hs](con)?res/i.test(String(v.bill.id || v.bill.label || "").replace(/[.\s]/g, ""));
  // A suspension vote needs two-thirds: a majority that falls short isn't a rejection.
  if (!ok && /suspend the rules/i.test(v.question || "") && v.yea != null && v.yea > v.nay) {
    return `${title && !descriptive ? `The ${title}` : label} fell short of the two-thirds needed in the ${ch}`;
  }
  const verb = isRes ? (ok ? "adopted" : "rejected") : (ok ? "passed" : "rejected");
  if (!title) return `${ch} ${verb} ${label}`;
  if (descriptive) return `${ch} ${verb} ${label}: ${clip(title)}`;
  return `${ch} ${verb} the ${title}`;
}

// Result badge text: Passed / Failed; Confirmed / Rejected for nominations; Agreed to /
// Rejected for House rules (they set the terms of debate, nothing passes).
export const isRule = v => v.kind === "rule" || RULE.test(v.bill?.title || "");
// Steps on the way (cloture, amendments, motions) are "Agreed to" / "Rejected": nothing
// passed. Final votes are Passed / Failed; nominations Confirmed / Rejected.
export function resultWord(v) {
  const ok = v.outcome === "succeeded";
  const kind = questionKind(v.question);
  if (kind === "nomination" && !v.bill) return ok ? "Confirmed" : "Rejected";
  if (kind === "override") return ok ? "Veto overridden" : "Veto sustained";
  if (kind === "speaker") return "Speaker elected";
  if (/call of the house|call by states|quorum/i.test(v.question || "")) return "Quorum call";
  if (kind === "passage" && !(v.bill && isRule(v))) {
    if (!ok && /suspend the rules/i.test(v.question || "") && v.yea != null && v.yea > v.nay) return "Short of two-thirds";
    return ok ? "Passed" : "Failed";
  }
  // Steps and other questions (motions, quorum calls, points of order): nothing passed.
  if (ok) return "Agreed to";
  if (v.outcome === "failed") return "Rejected";
  return String(v.result || "Recorded");
}
// "H.R. 1013" from a rule's title, or null.
export const ruleTarget = v => { const r = RULE.exec(v.bill?.title || "")?.[1]; return r ? officialLabel(r) : null; };

// "Most Democrats and most Republicans voted Yea" / "Most Democrats voted Nay; most Republicans voted Yea".
export function partyWords(p) {
  const side = c => !c || c.yea === c.nay ? null : (c.yea > c.nay ? "Yea" : "Nay");
  const d = side(p?.D), r = side(p?.R);
  if (d && r && d === r) return `Most Democrats and most Republicans voted ${d}`;
  if (d && r) return `Most Democrats voted ${d}; most Republicans voted ${r}`;
  return "";
}

// The week in plain English: sentences filled in from the week's counts (no AI, nothing
// beyond the numbers). w: { votes: { House, Senate }, passed, failed, laws, confirmed, same,
// opposed, closest (a vote item or null) }.
export function weekBrief(w) {
  const n = (x, one, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  const h = w.votes?.House || 0, s = w.votes?.Senate || 0, total = h + s;
  const out = [];
  if (h && s) out.push(`Congress held ${n(total, "recorded vote")}: ${h} in the House and ${s} in the Senate.`);
  else if (total) out.push(`The ${h ? "House" : "Senate"} held ${n(total, "recorded vote")}; the ${h ? "Senate" : "House"} held none.`);
  else out.push("Neither chamber held a recorded vote.");
  const did = [
    w.passed && `${n(w.passed, "bill or resolution", "bills or resolutions")} passed by recorded vote`,
    w.failed && `${w.failed} failed`,
    w.laws && `${n(w.laws, "bill or resolution", "bills or resolutions")} became law`,
    w.confirmed && `the Senate confirmed ${n(w.confirmed, "nominee")}`,
  ].filter(Boolean);
  if (did.length) {
    const list = did.length > 1 ? `${did.slice(0, -1).join(", ")} and ${did.at(-1)}` : did[0];
    out.push(`${list[0].toUpperCase()}${list.slice(1)}.`);
  }
  const sided = (w.same || 0) + (w.opposed || 0);
  if (sided) out.push(`Most Democrats and most Republicans took opposite sides on ${w.opposed || 0} of the ${n(sided, "vote")} where each party had a majority position.`);
  const c = w.closest;
  if (c?.yea != null && c?.nay != null) out.push(`The closest vote: ${voteHeadline(c)}, ${c.yea}–${c.nay}.`);
  return out;
}

// How divided a vote was: glossary keys for its tags, by published rules (How we count).
// Close: the margin is 5% or less of all Yea and Nay votes. Party lines: most of each party
// on opposite sides, with at least 90% of each party on its side. Broad agreement: most of
// each party on the same side, with at least two-thirds of each. Otherwise mixed support.
// Party tags need at least 10 Yea or Nay votes from each party.
export function voteDivision({ yea, nay, parties } = {}) {
  const total = (yea || 0) + (nay || 0);
  if (!total) return [];
  const close = Math.abs(yea - nay) * 20 <= total;
  const side = c => { const n = (c?.yea || 0) + (c?.nay || 0); return n >= 10 && c.yea !== c.nay ? { yea: c.yea > c.nay, top: Math.max(c.yea, c.nay), n } : null; };
  const counted = c => ((c?.yea || 0) + (c?.nay || 0)) >= 10;
  const d = side(parties?.D), r = side(parties?.R);
  let party = null;
  if (d && r && d.yea !== r.yea && d.top * 10 >= d.n * 9 && r.top * 10 >= r.n * 9) party = "party_line";
  else if (d && r && d.yea === r.yea && d.top * 3 >= d.n * 2 && r.top * 3 >= r.n * 2) party = "broad_agreement";
  else if (counted(parties?.D) && counted(parties?.R) && !close) party = "mixed_support";
  return [close && "close_vote", party].filter(Boolean);
}

// 'succeeded' | 'failed' | 'other' from the official result text (same rule as the
// server's voteOutcome in netlify/lib/vote-stats.js; negatives checked first).
export function outcomeOf(result = "") {
  const r = String(result).toLowerCase();
  // On an override vote, "Veto Sustained" means the override failed; "Veto Overridden" that it passed.
  if (/veto sustained/.test(r)) return "failed";
  if (/veto overridden/.test(r)) return "succeeded";
  if (/failed|rejected|defeated|not sustained|not agreed|not well taken/.test(r)) return "failed";
  if (/passed|agreed|confirmed|adopted|sustained|well taken/.test(r)) return "succeeded";
  return "other";
}
