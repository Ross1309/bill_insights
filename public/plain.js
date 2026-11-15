// Plain-language wording for votes, from the official record (no judgment calls):
//  - a House "rule" (H.Res. "Providing for consideration of the bill (H.R. X)...") sets
//    the terms of debate for another bill
//  - bills pass or are rejected; resolutions are adopted or rejected; nominees are
//    confirmed or rejected
// Official terms stay: Yea / Nay.

import { officialLabel } from "./util.js";

const RULE = /^Providing for consideration of the bills? \(([^)]+)\)/i;
const short = title => String(title || "").replace(/ of \d{4}$/, "");

// What kind of question a vote was, from its official wording (most specific first).
// Only "passage" decides a measure; the rest are steps on the way, and their headlines
// say so (a cloture vote on a bill is not the bill passing).
export function questionKind(question = "") {
  const q = String(question).toLowerCase();
  if (/cloture/.test(q)) return "cloture";
  if (/nomination/.test(q)) return "nomination";
  if (/motion to proceed/.test(q)) return "proceed";
  if (/previous question/.test(q)) return "previous_question";
  if (/\b(re)?commit\b/.test(q)) return "recommit";
  if (/discharge/.test(q)) return "discharge";
  if (/\btable\b/.test(q)) return "table";
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
    if (kind === "cloture" && v.document_title) return `${ch} ${ok ? "voted to end debate" : "voted not to end debate"} on the nomination of ${who}`;
    return `${ch}: ${v.question || "vote"}`;
  }
  const label = officialLabel(v.bill.label || v.bill.id);
  const title = short(v.bill.title);
  const rule = RULE.exec(v.bill.title || "");
  // A short title ("Major Richard Star Act") reads as a name; a descriptive one ("To amend
  // title 10...", "Condemning ...", "A joint resolution ...") reads better after the label.
  const descriptive = /^(to |an? (act|bill|joint|concurrent|resolution)\b|[a-z]+ing\b)/i.test(title);
  const subject = rule ? `the rule for ${rule[1]}` : title && !descriptive ? `the ${title}` : label;
  const other = ch === "House" ? "Senate" : "House";
  switch (kind) {
    case "cloture": return `${ch} ${ok ? "voted to end debate" : "voted not to end debate"} on ${subject}`;
    case "proceed": return `${ch} ${ok ? "agreed to take up" : "voted not to take up"} ${subject}`;
    case "previous_question": return `${ch} ${ok ? "voted to end debate" : "voted not to end debate"} on ${subject}`;
    case "recommit": return `${ch} ${ok ? "sent" : "voted not to send"} ${subject} back to committee`;
    case "discharge": return `${ch} ${ok ? "voted to take" : "voted not to take"} ${subject} out of committee`;
    case "table": return `${ch} ${ok ? "voted to table" : "voted not to table"} a motion on ${subject}`;
    case "override": return `${ch} ${ok ? "voted to override" : "failed to override"} the veto of ${subject}`;
    case "concur": return `${ch} ${ok ? "agreed to" : "rejected"} the ${other}'s changes to ${subject}`;
    case "amendment": return `${ch} ${ok ? "adopted" : "rejected"} an amendment to ${subject}`;
    case "passage": break;
    default: return `${ch}: ${v.question || "vote"} (${label})`;
  }
  if (rule) return `${ch} ${ok ? "agreed to" : "rejected"} the terms of debate for ${rule[1]}`;
  // Resolutions (H.Res., S.J.Res., H.Con.Res. ...) are adopted; bills are passed.
  const isRes = /^[hs](con|j)?res/i.test(String(v.bill.id || v.bill.label || "").replace(/[.\s]/g, ""));
  const verb = isRes ? (ok ? "adopted" : "rejected") : (ok ? "passed" : "rejected");
  if (!title) return `${ch} ${verb} ${label}`;
  if (descriptive) return `${ch} ${verb} ${label}: ${title}`;
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
  if ((v.bill && isRule(v)) || (kind !== "passage" && kind !== "other")) return ok ? "Agreed to" : "Rejected";
  return ok ? "Passed" : "Failed";
}
// "H.R. 1013" from a rule's title, or null.
export const ruleTarget = v => RULE.exec(v.bill?.title || "")?.[1] || null;

// "Most Democrats and most Republicans voted Yea" / "Most Democrats voted Nay; most Republicans voted Yea".
export function partyWords(p) {
  const side = c => !c || c.yea === c.nay ? null : (c.yea > c.nay ? "Yea" : "Nay");
  const d = side(p?.D), r = side(p?.R);
  if (d && r && d === r) return `Most Democrats and most Republicans voted ${d}`;
  if (d && r) return `Most Democrats voted ${d}; most Republicans voted ${r}`;
  return "";
}

// 'succeeded' | 'failed' | 'other' from the official result text (same rule as the
// server's voteOutcome in netlify/lib/vote-stats.js; negatives checked first).
export function outcomeOf(result = "") {
  const r = String(result).toLowerCase();
  if (/failed|rejected|defeated|not sustained|not agreed|not well taken/.test(r)) return "failed";
  if (/passed|agreed|confirmed|adopted|sustained|well taken/.test(r)) return "succeeded";
  return "other";
}
