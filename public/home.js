// Home page (the first tab): three ways in (your members, this week, issues), key votes
// in plain language with how your members voted, recent laws, and a few numbers. All
// from stats/overview (one read, shared with the Charts page); "your members" positions
// come from their member_votes docs (3 reads, only once an address was given).
// Pure rendering: app.js loads the data and wires the address form.

import { escapeHtml as esc, ordinal, PARTY_BADGES, PARTY_TEXT, STATE_NAMES } from "./util.js";
import { explainQuestion } from "./issues.js";
import { voteHeadline, resultWord, partyWords } from "./plain.js";
import { weekRange } from "./week.js";

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
const billChip = b => b?.id ? `<button type="button" data-open="bill" data-id="${esc(b.id)}" class="text-accent hover:underline">${esc(b.label || b.id)}</button>` : "";

// --- Card 1: your members --------------------------------------------------------
function memberRow(m) {
  const role = m.chamber === "Senate" ? "Senator" : (STATE_NAMES[m.state] && ["DC", "PR", "GU", "VI", "AS", "MP"].includes(m.state)) ? "Delegate" : `Representative${m.district ? `, District ${m.district}` : ", at large"}`;
  const p = PARTY_LETTER[m.party] || "";
  return `
    <button type="button" data-open="member" data-id="${esc(m.id)}" class="w-full flex items-center gap-3 text-left rounded-lg hover:bg-gray-100/60 p-1 -m-1">
      ${m.imageUrl ? `<img src="${esc(m.imageUrl)}" alt="" class="w-10 h-12 rounded object-cover bg-gray-200 shrink-0" loading="lazy" />` : `<span class="w-10 h-12 rounded bg-gray-200 shrink-0"></span>`}
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-gray-900 truncate">${esc(String(m.name || "").split(", ").reverse().join(" "))}</span>
        <span class="block text-xs text-gray-500">${esc(role)}${p ? ` · <span class="${PARTY_TEXT[p]} font-semibold">${p}</span>` : ""}</span>
      </span>
    </button>`;
}

function repsCard(reps) {
  const form = `
    <form data-home-find class="mt-3 flex gap-2">
      <label for="home-address" class="sr-only">Your home address</label>
      <input id="home-address" type="text" autocomplete="street-address" maxlength="200" required placeholder="Street address, city, state"
        class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-50 border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
      <button type="submit" class="px-3 py-2 rounded-lg bg-cta text-ink text-sm font-semibold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent">Find</button>
    </form>
    <p class="text-[11px] text-gray-500 mt-2">Sent to the U.S. Census Bureau's geocoder to find your district; not stored by us. Your members are remembered in this browser only.</p>
    <p data-home-find-status class="text-sm mt-2 empty:hidden"></p>`;
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5 flex flex-col" aria-labelledby="home-reps-title">
      <h2 id="home-reps-title" class="text-xs font-semibold uppercase tracking-wide text-pink">Who represents me?</h2>
      ${reps?.members?.length ? `
        <p class="text-sm text-gray-600 mt-1">Your members for ${esc(reps.code)}${reps.state && STATE_NAMES[reps.state] ? ` (${esc(STATE_NAMES[reps.state])}${reps.district ? `'s ${esc(ordinal(reps.district))} district` : ""})` : ""}:</p>
        <div class="mt-3 space-y-3">${reps.members.map(memberRow).join("")}</div>
        <div class="mt-auto pt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="#legislators/${esc(reps.code)}" class="font-semibold text-accent hover:underline">All about them →</a>
          <button type="button" data-home-change class="text-gray-500 hover:text-gray-800 underline">Change address</button>
        </div>
        <div data-home-change-form class="hidden">${form}</div>`
      : `<p class="text-sm text-gray-600 mt-1">Enter your home address to see your two senators and your representative, and how they voted.</p>${form}`}
    </article>`;
}

// --- Card 2: this week -------------------------------------------------------------
function weekCard(tw) {
  if (!tw) return `<article class="bg-surface border border-gray-200 rounded-2xl p-5"><p class="text-sm text-gray-500">The weekly summary isn't available yet.</p></article>`;
  const stat = (n, label) => `<div class="bg-gray-50/60 rounded-lg py-2 text-center"><p class="font-serif text-2xl font-bold text-gray-900 tabular-nums">${num(n)}</p><p class="text-[11px] text-gray-600">${label}</p></div>`;
  const items = (tw.passed_items || []).map(v => ({ ...v, outcome: "succeeded" }));
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5 flex flex-col" aria-labelledby="home-week-title">
      <h2 id="home-week-title" class="text-xs font-semibold uppercase tracking-wide text-pink">This week in Congress · ${esc(weekRange(tw))}</h2>
      <div class="grid grid-cols-3 gap-2 mt-3">${stat(tw.votes.House + tw.votes.Senate, "roll-call votes")}${stat(tw.passed, "passed by roll call")}${stat(tw.law_count, "became law")}</div>
      ${items.length ? `<ul class="mt-4 space-y-2.5 text-sm">${items.map(v => `
        <li><span class="text-gray-900">${esc(voteHeadline(v))}</span>
          <span class="block text-xs text-gray-500">${billChip(v.bill)} · ${v.yea}–${v.nay}${v.parties ? ` · ${esc(partyWords(v.parties))}` : ""}</span></li>`).join("")}</ul>`
        : `<p class="text-sm text-gray-500 mt-4">No bills passed by roll call this week.</p>`}
      <a href="#week/${esc(tw.week)}" class="mt-auto pt-4 text-sm font-semibold text-accent hover:underline">The full week →</a>
    </article>`;
}

// --- Card 3: issues ----------------------------------------------------------------
function issuesCard(topics) {
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5 flex flex-col" aria-labelledby="home-issues-title">
      <h2 id="home-issues-title" class="text-xs font-semibold uppercase tracking-wide text-pink">Issues</h2>
      <p class="text-sm text-gray-600 mt-1">What this Congress has done, topic by topic.</p>
      <div class="mt-3 space-y-2.5">${(topics || []).map(t => `
        <a href="#issues/${esc(t.slug)}" class="block rounded-xl border border-gray-200 bg-gray-50/40 px-3.5 py-3 hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent">
          <span class="flex items-baseline justify-between gap-2"><span class="font-serif text-lg font-bold text-gray-900">${esc(t.label)}</span><span class="text-xs text-gray-500">${num(t.law)} laws · ${num(t.measures)} measures voted on</span></span>
          ${t.watchlists?.length ? `<span class="block text-xs text-gray-500 mt-1">${t.watchlists.map(esc).join(" · ")}</span>` : ""}
        </a>`).join("")}</div>
    </article>`;
}

// --- Key votes -------------------------------------------------------------------------
function partyBar(label, c, cls) {
  const tot = (c?.yea || 0) + (c?.nay || 0) || 1;
  return `
    <div class="flex items-center gap-2 text-xs">
      <span class="w-24 shrink-0"><span class="inline-block px-1.5 py-0.5 rounded ring-1 ring-inset font-semibold ${cls}">${label}</span></span>
      <span class="flex-1 flex h-2.5 rounded-full overflow-hidden bg-gray-100" aria-hidden="true">
        <span style="width:${((c?.yea || 0) / tot) * 100}%;background:#b5e48c"></span><span style="width:${((c?.nay || 0) / tot) * 100}%;background:#f4a07a"></span>
      </span>
      <span class="w-28 shrink-0 text-right tabular-nums text-gray-700 whitespace-nowrap">${c?.yea ?? 0} Yea · ${c?.nay ?? 0} Nay</span>
    </div>`;
}
const posBadge = p => /yea|aye/i.test(p) ? "bg-green-100 text-green-800" : /nay|no/i.test(p) ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700";

function keyVoteCard(v, reps, positions) {
  const ok = v.outcome === "succeeded";
  const mine = (positions?.get(v.id) || []);
  const yours = reps?.members?.length
    ? `<div class="mt-3 pt-3 border-t border-gray-200"><p class="text-xs text-gray-500 mb-1.5">Your members (${esc(reps.code)})</p>
        <div class="flex flex-wrap gap-1.5">${mine.length ? mine.map(m => `<button type="button" data-open="member" data-id="${esc(m.id)}" class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 border border-gray-200 hover:border-accent/60"><span class="text-gray-800">${esc(String(m.name || "").split(",")[0])}</span><span class="font-bold px-1 rounded ${posBadge(m.position)}">${esc(m.position)}</span></button>`).join("")
          : `<span class="text-xs text-gray-500">${positions ? `None of your members voted in the ${esc(v.chamber)} on this.` : "Loading…"}</span>`}</div></div>`
    : `<p class="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">Enter your address above to see how your members voted.</p>`;
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5">
      <div class="flex items-start justify-between gap-3">
        <h3 class="font-serif text-lg font-bold text-gray-900 leading-snug"><button type="button" data-open="vote" data-id="${esc(v.id)}" class="text-left hover:underline">${esc(voteHeadline(v))}</button></h3>
        <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded ${ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}">${resultWord(v)} ${v.yea}–${v.nay}</span>
      </div>
      <p class="text-sm text-gray-600 mt-1">${v.bill ? `${billChip(v.bill)}. ` : ""}${esc(v.bill ? explainQuestion(v.question || "") : (v.document_title || ""))}</p>
      <div class="mt-3 space-y-1.5">${partyBar("Democrats", v.parties?.D, PARTY_BADGES.Democratic)}${partyBar("Republicans", v.parties?.R, PARTY_BADGES.Republican)}</div>
      ${partyWords(v.parties) ? `<p class="text-xs text-gray-500 mt-2">${esc(partyWords(v.parties))}.</p>` : ""}
      ${yours}
    </article>`;
}

// --- Page ------------------------------------------------------------------------------
export function renderHome(stats, { reps = null, positions = null } = {}) {
  const tw = stats.this_week;
  document.getElementById("home-hero").innerHTML = repsCard(reps) + weekCard(tw) + issuesCard(stats.topics_summary);

  const key = tw?.key_votes || [];
  const others = tw ? tw.votes.House + tw.votes.Senate - key.length : 0;
  document.getElementById("home-keyvotes").innerHTML = key.length ? `
    ${sectionHead(`Key votes${tw ? ` · ${esc(weekRange(tw))}` : ""}`, `#week/${esc(tw.week)}`, "All votes that week",
      `The latest final votes on bills and nominations.${others > 0 ? ` ${others} other roll calls that week (procedural steps, amendments, rules) are on the week page.` : ""}`)}
    <div class="grid gap-4 md:grid-cols-2 mt-4">${key.map(v => keyVoteCard(v, reps, positions)).join("")}</div>` : "";

  const laws = stats.recent_laws || [];
  document.getElementById("home-laws").innerHTML = laws.length ? `
    ${sectionHead("Recently became law", "#issues", "Laws by topic")}
    <div class="grid gap-4 md:grid-cols-2 mt-4">${laws.map(l => `
      <article class="bg-surface border border-gray-200 rounded-2xl p-5">
        <p class="text-xs text-gray-500">Signed ${esc(day(l.signed))}${l.law_number ? ` · Public Law ${esc(l.law_number)}` : ""} · ${billChip(l)}</p>
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
    ${sectionHead(`The ${stats.congress ? esc(ordinal(stats.congress)) : ""} Congress by the numbers`, "#charts", "See the charts")}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
      ${tile(num((totals.House || 0) + (totals.Senate || 0)), "roll-call votes", `House ${num(totals.House)} · Senate ${num(totals.Senate)}`)}
      ${stats.laws_total != null ? tile(num(stats.laws_total), "bills became law", "this Congress") : ""}
      ${h != null ? tile(`${h}%`, "of House votes split by party", "most Democrats and most Republicans voted opposite ways") : ""}
      ${s != null ? tile(`${s}%`, "of Senate votes split by party", "same measure; many Senate votes are on nominations") : ""}
    </div>`;
}
