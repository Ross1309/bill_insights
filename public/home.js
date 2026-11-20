// Home page (the first tab): three ways in (your members, this week, issues), key votes
// in plain language with how your members voted, recent laws, and a few numbers. All
// from stats/overview (one read, shared with the Charts page); "your members" positions
// come from their member_votes docs (3 reads, only once an address was given).
// Pure rendering: app.js loads the data and wires the address form.

import { callScriptHtml, contactLinks, escapeHtml as esc, formatDay, officialLabel, ordinal, PARTY_TEXT, STATE_NAMES } from "./util.js";
import { voteHeadline, partyWords, weekBrief } from "./plain.js";
import { voteCardHtml } from "./vote-card.js";
import { ADDRESS_NOTE, addressInputHtml } from "./address.js";
import { weekRange } from "./week.js";
import { missedShort, WHY_NOTE } from "./participation.js";

const day = (ymd, opts = { month: "short", day: "numeric", year: "numeric" }) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, opts);
const num = n => Number(n || 0).toLocaleString();
const PARTY_LETTER = { Democratic: "D", Republican: "R", Independent: "I" };
const sectionHead = (title, link, linkText, note) => `
  <div class="flex flex-wrap items-end justify-between gap-2">
    <div>
      <h2 class="font-serif text-2xl font-bold text-gray-900">${title}</h2>
      ${note ? `<p class="text-sm text-gray-500 mt-0.5">${note}</p>` : ""}
    </div>
    ${link ? `<a href="${link}" class="text-sm font-semibold text-accent hover:underline">${linkText} →</a>` : ""}
  </div>`;
const billChip = b => b?.id ? `<button type="button" data-open="bill" data-id="${esc(b.id)}" class="text-accent hover:underline">${esc(officialLabel(b.label || b.id))}</button>` : "";

// --- Coming up in the House (stats/floor, the House's weekly floor schedule) -------
// The week to show, in Congress's time zone: this Monday on weekdays; on weekends next
// Monday (the House posts the coming week's schedule before it starts). YYYY-MM-DD.
export function floorWeek(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map(x => [x.type, x.value]));
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow));
  return d.toISOString().slice(0, 10);
}
const FLOOR_GROUPS = {
  suspension: ["Fast-track bills (suspension of the rules)", "Debate is short and no amendments are allowed; passing needs two-thirds of those voting. Usually less contested bills."],
  rule: ["Bills under a rule", "The House first votes on a rule setting the terms of debate, then on the bill."],
  other: ["Also listed", ""],
};
const FLOOR_SHOWN = 6;

// Only the current week's schedule (or next week's on a weekend); "" otherwise.
export function upcomingHtml(floor, reps, now = new Date()) {
  if (!floor?.week) return "";
  if (floor.week !== floorWeek(now)) return "";
  const when = `week of ${formatDay(floor.week).replace(/, \d{4}$/, "")}`;
  if (floor.status !== "published" || !floor.categories?.length) {
    return `${sectionHead(`Coming up in the House`, null, null, `The House hasn't posted a floor schedule for the ${esc(when)}, which usually means it isn't in session.`)}`;
  }
  const item = it => `
    <li class="py-1.5">
      ${it.bill_id ? `<button type="button" data-open="bill" data-id="${esc(it.bill_id)}" class="py-0.5 font-semibold text-accent hover:underline">${esc(officialLabel(it.label))}</button>` : `<span class="font-semibold text-gray-700">${esc(it.label || "")}</span>`}
      <span class="text-gray-700">${esc(it.text.length > 160 ? `${it.text.slice(0, 160).replace(/\s+\S*$/, "")}…` : it.text)}</span>${it.amended ? ` <span class="text-xs text-gray-500">(as amended)</span>` : ""}
    </li>`;
  const groups = floor.categories.map(c => {
    const [title, note] = FLOOR_GROUPS[c.kind] || FLOOR_GROUPS.other;
    const rest = c.items.slice(FLOOR_SHOWN);
    return `
      <div class="bg-surface border border-gray-200 rounded-xl p-4">
        <h3 class="text-sm font-bold text-gray-900">${esc(title)} <span class="font-normal text-gray-500">· ${c.items.length}</span></h3>
        ${note ? `<p class="text-xs text-gray-500 mt-0.5">${esc(note)}</p>` : ""}
        <ul class="mt-2 text-sm divide-y divide-gray-200">${c.items.slice(0, FLOOR_SHOWN).map(item).join("")}</ul>
        ${rest.length ? `<details class="text-sm mt-1"><summary class="cursor-pointer text-accent">${rest.length} more</summary><ul class="divide-y divide-gray-200">${rest.map(item).join("")}</ul></details>` : ""}
      </div>`;
  }).join("");
  const rep = reps && !reps.stale ? reps.members?.find(m => m.chamber === "House") : null;
  const contact = rep ? contactLinks(rep.contact) : "";
  return `
    ${sectionHead("Coming up in the House", null, null, `What the House has scheduled for floor consideration, ${esc(when)}. Not every item gets a vote, and items are added during the week.`)}
    ${contact ? `<p class="text-sm mt-3">To share your view before a vote, your representative, ${esc(String(rep.name || "").split(", ").reverse().join(" "))}: ${contact}</p>` : ""}
    <div class="grid gap-4 lg:grid-cols-2 items-start mt-4">${groups}</div>
    <p class="text-[11px] text-gray-500 mt-2">From the House floor schedule (<a href="https://docs.house.gov/floor/" target="_blank" rel="noopener" class="text-accent hover:underline">docs.house.gov</a>)${floor.updated ? `, updated ${esc(formatDay(floor.updated))}` : ""}; refreshed nightly. The Senate doesn't publish a comparable list: its votes appear here once they happen.</p>`;
}

// --- Card 1: your members --------------------------------------------------------
function memberRow(m, participation) {
  const contact = contactLinks(m.contact);
  const role = m.chamber === "Senate" ? "Senator" : (STATE_NAMES[m.state] && ["DC", "PR", "GU", "VI", "AS", "MP"].includes(m.state)) ? "Delegate" : `Representative${m.district ? `, District ${m.district}` : ", at large"}`;
  const p = PARTY_LETTER[m.party] || "";
  return `
    <div>
    <button type="button" data-open="member" data-id="${esc(m.id)}" class="w-full flex items-center gap-3 text-left rounded-lg hover:bg-gray-100/60 p-1 -m-1">
      ${m.imageUrl ? `<img src="${esc(m.imageUrl)}" alt="" class="w-10 h-12 rounded object-cover bg-gray-200 shrink-0" loading="lazy" />` : `<span class="w-10 h-12 rounded bg-gray-200 shrink-0"></span>`}
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-gray-900 truncate">${esc(String(m.name || "").split(", ").reverse().join(" "))}</span>
        <span class="block text-xs text-gray-500">${esc(role)}${p ? ` · <span class="${PARTY_TEXT[p]} font-semibold">${p}</span>` : ""}</span>
        ${missedShort(m, participation)}
      </span>
    </button>
    ${contact ? `<p class="pl-[52px] text-xs">${contact}</p>` : ""}
    </div>`;
}

// Context for the missed-vote lines: the typical member of each chamber, and that the
// record doesn't say why (participation.js).
function typicalLine(p) {
  const h = p?.medians?.House?.missed_share, s = p?.medians?.Senate?.missed_share;
  if (h == null || s == null) return "";
  const f = x => `${(x * 100).toFixed(1)}%`;
  return `<p class="text-[11px] text-gray-500 mt-3">Typical member missed ${f(h)} of House votes and ${f(s)} of Senate votes this Congress. ${esc(WHY_NOTE)}</p>`;
}

function repsCard(reps, participation) {
  const form = `
    <form data-home-find class="mt-3 flex gap-2">
      <label for="home-address" class="sr-only">Your home address</label>
      ${addressInputHtml({ id: "home-address", cls: "w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-accent" })}
      <button type="submit" class="px-3 py-2 rounded-lg bg-cta text-ink text-sm font-semibold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent">Find</button>
    </form>
    <p class="text-[11px] text-gray-500 mt-2">${esc(ADDRESS_NOTE)}</p>
    <p data-home-find-status class="text-sm mt-2 empty:hidden"></p>`;
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5 flex flex-col" aria-labelledby="home-reps-title">
      <h2 id="home-reps-title" class="text-xs font-semibold uppercase tracking-wide text-pink">Who represents me?</h2>
      ${reps?.stale ? `
        <p class="text-sm text-gray-600 mt-1">A new Congress began on January 3, and some states' district maps changed. Enter your address again to see your current senators and representative.</p>${form}`
      : reps?.members?.length ? `
        <p class="text-sm text-gray-600 mt-1">Your members for ${esc(reps.code)}${reps.state && STATE_NAMES[reps.state] ? ` (${esc(STATE_NAMES[reps.state])}${reps.district ? `'s ${esc(ordinal(reps.district))} district` : ""})` : ""}:</p>
        <div class="mt-3 space-y-3">${reps.members.map(m => memberRow(m, participation)).join("")}</div>
        ${typicalLine(participation)}
        <div class="mt-2">${callScriptHtml({ code: reps.code })}</div>
        <div class="mt-auto pt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="#my-members" class="font-semibold text-accent hover:underline">What they've done →</a>
          <button type="button" data-home-change class="text-gray-500 hover:text-gray-800 underline">Change address</button>
          <button type="button" data-forget-reps aria-label="Forget your members saved in this browser" class="text-gray-500 hover:text-gray-800 underline">Forget</button>
        </div>
        <div data-home-change-form class="hidden">${form}</div>`
      : `<p class="text-sm text-gray-600 mt-1">Enter your home address or ZIP code to see your two senators and your representative, and how they voted.</p>${form}`}
    </article>`;
}

// --- The week in plain English (template sentences from the week's counts) ------------
export function briefHtml(tw, now = Date.now()) {
  if (!tw) return "";
  const open = now < new Date(`${tw.week_end}T23:59:59-05:00`).getTime();
  const brief = weekBrief({ votes: tw.votes, passed: tw.passed, failed: tw.failed, laws: tw.law_count, confirmed: tw.confirmed, same: tw.same, opposed: tw.opposed, closest: tw.closest });
  return `
    <h2 class="text-xs font-semibold uppercase tracking-wide text-pink">${open ? "This week so far" : "The latest week"} in plain English · ${esc(weekRange(tw))}</h2>
    <p class="text-gray-800 mt-1">${brief.map(esc).join(" ")}</p>`;
}

// --- Card 2: this week -------------------------------------------------------------
// The card shows the latest week with votes or laws; in a recess (or around January 3)
// that's an earlier week, so it isn't called "this week". `monday` is "YYYY-MM-DD".
const isThisWeek = monday => Date.now() - new Date(`${monday}T00:00:00-05:00`).getTime() < 7 * 86400e3;
function weekCard(tw) {
  if (!tw) return `<article class="bg-surface border border-gray-200 rounded-2xl p-5"><p class="text-sm text-gray-500">The weekly summary isn't available yet.</p></article>`;
  const stat = (n, label) => `<div class="bg-gray-50/60 rounded-lg py-2 text-center"><p class="font-serif text-2xl font-bold text-gray-900 tabular-nums">${num(n)}</p><p class="text-[11px] text-gray-600">${label}</p></div>`;
  // Passage votes that succeeded (older stats docs lack the question: it was a passage).
  const items = (tw.passed_items || []).map(v => ({ ...v, question: v.question || "On Passage", outcome: "succeeded" }));
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5 flex flex-col" aria-labelledby="home-week-title">
      <h2 id="home-week-title" class="text-xs font-semibold uppercase tracking-wide text-pink">${isThisWeek(tw.week) ? "This week" : "Latest week"} in Congress · ${esc(weekRange(tw))}</h2>
      <div class="grid grid-cols-3 gap-2 mt-3">${stat(tw.votes.House + tw.votes.Senate, "recorded votes")}${stat(tw.passed, "passed by recorded vote")}${stat(tw.law_count, "became law")}</div>
      ${items.length ? `<ul class="mt-4 space-y-2.5 text-sm">${items.map(v => `
        <li><span class="text-gray-900">${esc(voteHeadline(v))}</span>
          <span class="block text-xs text-gray-500">${billChip(v.bill)} · ${v.yea}–${v.nay}${v.parties ? ` · ${esc(partyWords(v.parties))}` : ""}</span></li>`).join("")}</ul>
      ${tw.passed > items.length ? `<p class="text-xs text-gray-500 mt-2">The latest ${items.length} of ${tw.passed}; all of them are on the week page.</p>` : ""}`
        : `<p class="text-sm text-gray-500 mt-4">No bills passed by recorded vote this week.</p>`}
      <a href="#week/${esc(tw.week)}" class="mt-auto pt-4 text-sm font-semibold text-accent hover:underline">The full week →</a>
    </article>`;
}

// --- Card 3: issues ----------------------------------------------------------------
// Desktop: the third hero card. Phones: a compact list further down (#home-issues), so
// the first screens show your members, the week and the key votes.
function issuesCard(topics) {
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5 hidden lg:flex flex-col" aria-labelledby="home-issues-title">
      <h2 id="home-issues-title" class="text-xs font-semibold uppercase tracking-wide text-pink">Issues</h2>
      <p class="text-sm text-gray-600 mt-1">What this Congress has done, topic by topic.</p>
      <div class="mt-3 space-y-2.5">${(topics || []).map(t => `
        <a href="#issues/${esc(t.slug)}" class="block rounded-xl border border-gray-200 bg-gray-50/40 px-3.5 py-3 hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent">
          <span class="flex items-baseline justify-between gap-2"><span class="font-serif text-lg font-bold text-gray-900">${esc(t.label)}</span><span class="text-xs text-gray-500">${num(t.law)} laws · ${num(t.measures)} bills and resolutions</span></span>
          ${t.watchlists?.length ? `<span class="block text-xs text-gray-500 mt-1">${t.watchlists.map(esc).join(" · ")}</span>` : ""}
        </a>`).join("")}</div>
    </article>`;
}

function issuesList(topics) {
  if (!topics?.length) return "";
  return `
    ${sectionHead("Issues", "#issues", "All topics", "What this Congress has done, topic by topic.")}
    <ul class="mt-3 bg-surface border border-gray-200 rounded-2xl divide-y divide-gray-200">${topics.map(t => `
      <li><a href="#issues/${esc(t.slug)}" class="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-gray-100/40 focus:outline-none focus:ring-2 focus:ring-accent rounded-2xl">
        <span class="font-serif text-base font-bold text-gray-900">${esc(t.label)}</span>
        <span class="text-xs text-gray-500 text-right">${num(t.law)} laws · ${num(t.measures)} bills and resolutions</span>
      </a></li>`).join("")}</ul>`;
}

// --- Key votes: the shared vote card + "your members" -------------------------------
const posBadge = p => /yea|aye/i.test(p) ? "bg-green-100 text-green-800" : /nay|no/i.test(p) ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700";

// positions: Map vote id -> [{ id, name, position }] (members of yours on that roll call),
// or null for a vote whose record couldn't be read; no Map yet = still loading.
function keyVoteCard(v, reps, positions) {
  const known = positions?.has(v.id);
  const mine = positions?.get(v.id);
  const yours = reps?.members?.length && !reps.stale
    ? `<div class="mt-3 pt-3 border-t border-gray-200"><p class="text-xs text-gray-500 mb-1.5">Your members (${esc(reps.code)})</p>
        <div class="flex flex-wrap gap-1.5">${mine?.length ? mine.map(m => `<button type="button" data-open="member" data-id="${esc(m.id)}" class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 border border-gray-200 hover:border-accent/60"><span class="text-gray-800">${esc(String(m.name || "").split(",")[0])}</span><span class="font-bold px-1 rounded ${posBadge(m.position)}">${esc(m.position)}</span></button>`).join("")
          : `<span class="text-xs text-gray-500">${!positions ? "Loading…" : !known || mine === null ? "How your members voted isn't available right now." : "None of your members were recorded on this vote."}</span>`}</div></div>`
    : `<p class="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">Enter your address above to see how your members voted.</p>`;
  return voteCardHtml(v, { yours, compact: true });
}

// --- Page ------------------------------------------------------------------------------
// keyVotesOnly: only the key votes change (your members' positions arrived), so the rest of
// the page isn't redrawn: an address being typed or a section someone opened stays as it is.
export function renderHome(stats, { reps = null, positions = null, participation = null, keyVotesOnly = false } = {}) {
  const tw = stats.this_week;
  if (!keyVotesOnly) {
    document.getElementById("home-brief").innerHTML = briefHtml(tw);
    document.getElementById("home-hero").innerHTML = repsCard(reps, participation) + weekCard(tw) + issuesCard(stats.topics_summary);
    document.getElementById("home-issues").innerHTML = issuesList(stats.topics_summary);
  }

  // Key vote "Details" someone already opened stay open across the redraw.
  const opened = new Set([...document.querySelectorAll("#home-keyvotes details[open][data-vote]")].map(d => d.dataset.vote));
  const key = tw?.key_votes || [];
  const others = tw ? tw.votes.House + tw.votes.Senate - key.length : 0;
  document.getElementById("home-keyvotes").innerHTML = key.length ? `
    ${sectionHead(`Key votes${tw ? ` · ${esc(weekRange(tw))}` : ""}`, `#week/${esc(tw.week)}`, "All votes that week",
      `The latest final votes on bills and nominations.${others > 0 ? ` ${others} other recorded votes that week (procedural steps, amendments, rules) are on the week page.` : ""}`)}
    <div class="grid gap-4 md:grid-cols-2 mt-4">${key.map(v => keyVoteCard(v, reps, positions)).join("")}</div>` : "";
  document.querySelectorAll("#home-keyvotes details[data-vote]").forEach(d => { if (opened.has(d.dataset.vote)) d.open = true; });
  if (keyVotesOnly) return;

  const laws = stats.recent_laws || [];
  document.getElementById("home-laws").innerHTML = laws.length ? `
    ${sectionHead("Recently became law", "#issues", "Laws by topic")}
    <div class="grid gap-4 md:grid-cols-2 mt-4">${laws.map(l => `
      <article class="bg-surface border border-gray-200 rounded-2xl p-5">
        <p class="text-xs text-gray-500">Signed ${esc(day(l.signed))}${l.law_number ? ` · ${esc(l.law_type || "Public Law")} ${esc(l.law_number)}` : ""} · ${billChip(l)}</p>
        <h3 class="font-serif text-lg font-bold text-gray-900 mt-1 leading-snug">${esc(l.title || "")}</h3>
        ${l.summary ? `<p class="text-sm text-gray-700 mt-2">${esc(l.summary)}</p><p class="text-[11px] text-gray-500 mt-1">AI summary of the official CRS summary · <button type="button" data-open="bill" data-id="${esc(l.id)}" class="text-accent hover:underline">Read more</button></p>`
          : `<p class="text-sm text-gray-500 mt-2">No official CRS summary yet.</p>`}
      </article>`).join("")}</div>` : "";

  const al = stats.alignment_totals || {};
  const splitPct = c => (c && c.same + c.opposed ? Math.round((c.opposed / (c.same + c.opposed)) * 100) : null);
  const tile = (big, label, sub) => `<div class="bg-surface border border-gray-200 rounded-xl p-4"><p class="font-serif text-3xl font-bold text-gray-900 tabular-nums">${big}</p><p class="text-sm text-gray-700 mt-1">${label}</p><p class="text-xs text-gray-500 mt-0.5">${sub}</p></div>`;
  const totals = stats.totals || {};
  const h = splitPct(al.House), s = splitPct(al.Senate);
  document.getElementById("home-numbers").innerHTML = `
    ${sectionHead(`The ${stats.congress ? esc(ordinal(stats.congress)) : ""} Congress by the numbers`, "#congress", "Compared with past Congresses")}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
      ${tile(num((totals.House || 0) + (totals.Senate || 0)), "recorded votes", `House ${num(totals.House)} · Senate ${num(totals.Senate)}`)}
      ${stats.laws_total != null ? tile(num(stats.laws_total), "bills became law", "this Congress") : ""}
      ${h != null ? tile(`${h}%`, "of House votes split by party", "most Democrats and most Republicans voted opposite ways") : ""}
      ${s != null ? tile(`${s}%`, "of Senate votes split by party", "counted the same way; many Senate votes are on nominations") : ""}
    </div>`;
}
