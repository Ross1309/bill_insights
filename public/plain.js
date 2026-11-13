// Plain-language wording for votes, from the official record (no judgment calls):
//  - a House "rule" (H.Res. "Providing for consideration of the bill (H.R. X)...") sets
//    the terms of debate for another bill
//  - bills pass or are rejected; resolutions are adopted or rejected; nominees are
//    confirmed or rejected
// Official terms stay: Yea / Nay.

import { officialLabel } from "./util.js";

const RULE = /^Providing for consideration of the bills? \(([^)]+)\)/i;
const short = title => String(title || "").replace(/ of \d{4}$/, "");

export function voteHeadline(v) {
  const ok = v.outcome === "succeeded";
  if (!v.bill) {
    const who = String(v.document_title || v.legislation || "a nominee").split(",")[0];
    return /nomination/i.test(v.question || "") ? `${v.chamber} ${ok ? "confirmed" : "rejected"} ${who}` : `${v.chamber}: ${v.question || "vote"}`;
  }
  const rule = RULE.exec(v.bill.title || "");
  if (rule) return `${v.chamber} ${ok ? "agreed to" : "rejected"} the terms of debate for ${rule[1]}`;
  // Resolutions (H.Res., S.J.Res., H.Con.Res. ...) are adopted; bills are passed.
  const isRes = /^[hs](con|j)?res/i.test(String(v.bill.id || v.bill.label || "").replace(/[.\s]/g, ""));
  const verb = isRes ? (ok ? "adopted" : "rejected") : (ok ? "passed" : "rejected");
  const label = officialLabel(v.bill.label || v.bill.id);
  const title = short(v.bill.title);
  // A short title ("Major Richard Star Act") reads as a name; a descriptive one ("To amend
  // title 10...", "Condemning ...", "A joint resolution ...") reads better after the label.
  if (!title) return `${v.chamber} ${verb} ${label}`;
  if (/^(to |an? (act|bill|joint|concurrent|resolution)\b|[a-z]+ing\b)/i.test(title)) return `${v.chamber} ${verb} ${label}: ${title}`;
  return `${v.chamber} ${verb} the ${title}`;
}

// Result badge text: Passed / Failed, Confirmed / Rejected for nominations.
export function resultWord(v) {
  const nom = !v.bill && /nomination/i.test(v.question || "");
  return v.outcome === "succeeded" ? (nom ? "Confirmed" : "Passed") : (nom ? "Rejected" : "Failed");
}

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
