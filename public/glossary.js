// Plain-language glossary of congressional terms, and "tap to explain": official text
// (vote questions, bill actions) gets its terms marked, and tapping one shows what it
// means. Our own words, neutral; the How we count page lists them all.
//
//   termize(escapedText)  -> the same HTML with known terms wrapped in <button data-term>
//   setupGlossary()       -> one document listener: tap / Enter opens the explanation,
//                            Escape / tapping elsewhere closes it

import { escapeHtml as esc } from "./util.js";

// key: [term as shown in the popover, definition, phrases that mark it in official text]
export const TERMS = {
  ceremonial: ["Ceremonial", "This bill or resolution names a post office or other federal building, awards a Congressional Gold Medal or commemorative coin, or marks a day, week or month. It doesn't set policy on the issue it honors.", ["ceremonial"]],
  close_vote: ["Close vote", "The difference between Yea and Nay was 5% or less of all Yea and Nay votes.", ["close vote"]],
  party_line: ["Split along party lines", "Most Democrats and most Republicans voted on opposite sides, with at least 90% of each party on its side.", ["split along party lines"]],
  broad_agreement: ["Broad agreement", "Most Democrats and most Republicans voted the same way, with at least two-thirds of each party on that side.", ["broad agreement"]],
  mixed_support: ["Mixed support", "The vote wasn't close, and it didn't meet our rules for broad agreement or a split along party lines: at least one party was noticeably divided.", ["mixed support"]],
  cloture: ["Cloture", "A Senate vote to end debate so a final vote can happen. Most legislation needs 60 of 100 senators; nominations need a simple majority.", ["cloture"]],
  suspension: ["Suspension of the rules", "A House fast track for less controversial bills: 40 minutes of debate, no amendments, and two-thirds of those voting needed to pass.", ["suspend the rules", "suspension of the rules"]],
  recommit: ["Motion to recommit", "A motion, usually offered by the minority party, to send a bill back to committee instead of passing it now. It's the last vote before final passage.", ["motion to recommit", "recommit"]],
  table: ["Motion to table", "A vote to set a question aside without deciding it directly. Adopting it usually ends that bill, resolution or motion.", ["motion to table", "to table"]],
  previous_question: ["Previous question", "A House vote to end debate and block amendments, usually on a rule. Adopting it moves straight to the vote; defeating it would let the minority offer an alternative.", ["previous question"]],
  proceed: ["Motion to proceed", "A Senate vote to start debating a bill or resolution. It doesn't decide whether it passes.", ["motion to proceed"]],
  discharge: ["Motion to discharge", "A vote to take a bill or resolution away from a committee so the full chamber can consider it.", ["motion to discharge", "discharged"]],
  concur: ["Concur", "Agreeing to the other chamber's version or amendment, which settles the differences between the House and Senate texts.", ["concur in", "motion to concur", "concurrence"]],
  rule: ["Rule (House)", "A House resolution that sets the terms of debate for a bill: how long, and which amendments may be offered. It's adopted before the bill itself is debated.", ["providing for consideration"]],
  nomination: ["Nomination", "The President's choice for a post that needs Senate approval, such as a judge, cabinet secretary or ambassador. A simple majority of senators confirms.", ["nomination", "confirmation"]],
  roll_call: ["Recorded vote (roll call)", "A vote where each member's position is recorded. The House votes electronically; the Senate calls the roll. Also called a roll-call or yea-and-nay vote.", ["roll call", "roll-call", "recorded vote", "yea-and-nay", "yeas and nays", "record vote"]],
  voice_vote: ["Voice vote", "Members call out their votes together and the presiding officer judges the result. No one's individual position is recorded.", ["voice vote"]],
  unanimous_consent: ["Unanimous consent", "Agreeing to something without a vote because no member present objects. Any single member can block it by objecting.", ["unanimous consent", "without objection"]],
  quorum: ["Quorum call", "A check that enough members (a majority) are present to do business. It's often used to pause the floor.", ["quorum"]],
  present: ["Present", "A member answered the roll but took no side. It isn't counted as Yea or Nay.", []],
  veto: ["Veto", "The President's rejection of a bill. Congress can override it with a two-thirds vote in both chambers.", ["veto", "vetoed", "objections of the president"]],
  committee: ["Committee", "Bills are sent to committees by subject. Committees hold hearings, change bills and decide which ones go to the floor; most bills never leave committee.", ["committee"]],
  reported: ["Reported", "A committee approved the bill (often with changes) and sent it to the full chamber.", ["ordered to be reported", "reported by", "reported with an amendment", "reported without amendment"]],
  markup: ["Markup", "A committee meeting where members change a bill's text line by line and vote on whether to send it to the full chamber.", ["mark-up", "markup"]],
  calendar: ["Calendar", "A chamber's list of bills and resolutions that are eligible for floor action. In the House, the Union Calendar holds bills that raise or spend money and the House Calendar the rest.", ["union calendar", "house calendar", "legislative calendar", "general orders"]],
  desk: ["Held at the desk", "The bill is kept at the presiding officer's desk instead of going to committee, so it can be taken up quickly.", ["held at the desk", "at the desk"]],
  read_twice: ["Read twice", "A Senate formality: a bill is \"read\" (by title) twice before it's sent to committee.", ["read twice"]],
  engrossed: ["Engrossed", "The official copy of a bill as passed by one chamber, sent to the other.", ["engrossed"]],
  enrolled: ["Enrolled", "The final copy of a bill passed by both chambers in identical form, signed by their leaders and sent to the President.", ["enrolled"]],
  presented: ["Presented to the President", "The President has 10 days (Sundays excepted) to sign or veto. Unsigned bills become law, unless Congress has adjourned (a \"pocket veto\").", ["presented to president", "presented to the president"]],
  public_law: ["Public law", "A bill that has become law and applies generally. A private law applies to specific people, such as relief in one immigration case.", ["public law", "private law"]],
  resolution: ["Resolution", "Simple resolutions (H.Res./S.Res.) involve one chamber; concurrent resolutions need both but don't go to the President; joint resolutions work like bills and can become law.", ["joint resolution", "concurrent resolution", "resolution"]],
  appropriations: ["Appropriations", "Bills that provide the money. Authorization bills set policy and allow spending; appropriations bills fund it. A continuing resolution keeps funding going temporarily.", ["appropriations", "continuing resolution", "continuing appropriations"]],
  two_thirds: ["Two-thirds / three-fifths", "Some votes need more than a simple majority: two-thirds to suspend the rules, override a veto or propose a constitutional amendment; three-fifths (60 senators) for most cloture votes.", ["2/3", "two-thirds", "3/5", "three-fifths"]],
  crs: ["CRS summary", "The Congressional Research Service is Congress's nonpartisan research agency. It writes the official summary of each bill.", ["congressional research service"]],
  amendment: ["Amendment", "A proposed change to a bill's text. Each is voted on separately before the vote on the bill.", ["amendment"]],
};

// Phrases longest first so "motion to table" wins over "table".
const PHRASES = Object.entries(TERMS).flatMap(([key, [, , phrases]]) => phrases.map(p => [p, key])).sort((a, b) => b[0].length - a[0].length);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const MATCH = new RegExp(`\\b(${PHRASES.map(([p]) => escRe(esc(p))).join("|")})\\b`, "gi");
const KEY = new Map(PHRASES.map(([p, k]) => [esc(p).toLowerCase(), k]));

// `escaped`: text already HTML-escaped (no tags). Marks the first mention of each term.
// skip: term keys not to mark (e.g. the one a card already explains).
export function termize(escaped, { skip = [] } = {}) {
  const seen = new Set(skip);
  return String(escaped ?? "").replace(MATCH, m => {
    const key = KEY.get(m.toLowerCase());
    if (!key || seen.has(key)) return m;
    seen.add(key);
    return termButton(key, m);
  });
}
export const termButton = (key, label) =>
  `<button type="button" data-term="${key}" aria-expanded="false" class="underline decoration-dotted decoration-accent/70 underline-offset-2 hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm">${label}</button>`;

// The glossary as a list (How we count page).
export function glossaryHtml() {
  return `<dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">${Object.values(TERMS).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([term, def]) => `<div><dt class="font-semibold text-gray-900">${esc(term)}</dt><dd class="text-gray-600">${esc(def)}</dd></div>`).join("")}</dl>`;
}

let pop = null, opener = null;
function close() {
  if (!pop || pop.classList.contains("hidden")) return;
  pop.classList.add("hidden");
  opener?.setAttribute("aria-expanded", "false");
  opener?.removeAttribute("aria-describedby");
  opener = null;
}
function open(btn) {
  const t = TERMS[btn.dataset.term];
  if (!t) return;
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "term-popover";
    pop.setAttribute("role", "tooltip");
    pop.className = "hidden fixed z-[70] max-w-xs bg-surface-deep border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-800 shadow-xl";
    document.body.appendChild(pop);
  }
  if (opener && opener !== btn) close();
  pop.innerHTML = `<p class="font-semibold text-gray-900">${esc(t[0])}</p><p class="mt-1 text-gray-700">${esc(t[1])}</p>`;
  pop.classList.remove("hidden");
  const r = btn.getBoundingClientRect(), w = Math.min(320, innerWidth - 24);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
  const below = r.bottom + 8, h = pop.offsetHeight;
  pop.style.top = `${below + h > innerHeight - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below}px`;
  opener = btn;
  btn.setAttribute("aria-expanded", "true");
  btn.setAttribute("aria-describedby", "term-popover");
}

export function setupGlossary() {
  document.addEventListener("click", ev => {
    const btn = ev.target.closest("[data-term]");
    if (btn) {
      ev.preventDefault();
      ev.stopPropagation();   // a term inside a clickable card shouldn't also open it
      if (opener === btn) close(); else open(btn);
      return;
    }
    if (!ev.target.closest("#term-popover")) close();
  }, true);
  document.addEventListener("keydown", ev => { if (ev.key === "Escape" && opener) { const b = opener; close(); b.focus(); ev.stopPropagation(); } }, true);
  addEventListener("scroll", close, { passive: true, capture: true });
  addEventListener("resize", close);
}
