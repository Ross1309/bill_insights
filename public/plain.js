// Plain-language wording for votes, from the official record (no judgment calls):
//  - a House "rule" (H.Res. "Providing for consideration of the bill (H.R. X)...") sets
//    the terms of debate for another bill
//  - bills pass or are rejected; resolutions are adopted or rejected; nominees are
//    confirmed or rejected
// Official terms stay: Yea / Nay.

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
  const isRes = /RES\b/i.test(v.bill.label || "");
  const verb = isRes ? (ok ? "adopted" : "rejected") : (ok ? "passed" : "rejected");
  return `${v.chamber} ${verb} the ${short(v.bill.title) || v.bill.label}`;
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
