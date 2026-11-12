// "What Congress did this week": the Overview card and the #week/<Monday> page, rendered
// from precomputed stats docs (netlify/lib/digest.js; the rules are printed on the page).
// Pure rendering: app.js loads the data.

import { escapeHtml as esc, ordinal, PARTY_TEXT } from "./util.js";
import { resultBadgeClass } from "./votes.js";

// "2026-11-09" -> "Nov 9" (calendar days; parsed at noon so no time zone shifts the day).
const day = (ymd, opts = { month: "short", day: "numeric" }) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, opts);
export const weekRange = w => {
  const sameMonth = w.week.slice(0, 7) === w.week_end.slice(0, 7);
  return `${day(w.week)} – ${sameMonth ? new Date(`${w.week_end}T12:00:00`).getDate() : day(w.week_end)}, ${w.week_end.slice(0, 4)}`;
};
const when = iso => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const billLink = b => b?.id
  ? `<button type="button" data-open="bill" data-id="${esc(b.id)}" class="font-semibold text-accent hover:underline">${esc(b.label || b.id)}</button>`
  : "";
const partyLine = p => ["D", "R", "I"].filter(k => p?.[k]).map(k =>
  `<span class="${PARTY_TEXT[k]} font-semibold">${k}</span> <span class="tabular-nums">${p[k].yea}–${p[k].nay}</span>`).join(" · ");
const ALIGN = { same: "Most Democrats and most Republicans voted the same way", opposed: "Most Democrats and most Republicans voted opposite ways" };
const alignNote = a => ALIGN[a] ? `<span class="text-gray-500">${ALIGN[a]}.</span>` : "";

// --- #week page -----------------------------------------------------------------
function voteRow(v, { showMargin = false } = {}) {
  const subject = v.bill
    ? `${billLink(v.bill)} <span class="text-gray-800">${esc(v.bill.title || "")}</span>`
    : `<span class="text-gray-800">${esc(v.document_title || v.legislation || "")}</span>`;
  return `
    <li class="py-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0 text-sm">${subject}</div>
        <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded ${resultBadgeClass(v.result)}">${esc(v.result || "")}</span>
      </div>
      <p class="text-xs text-gray-600 mt-1">
        <button type="button" data-open="vote" data-id="${esc(v.id)}" class="text-accent hover:underline">${esc(v.chamber)} · ${esc(v.question || "")}</button>
        · ${esc(when(v.date))} · <span class="tabular-nums text-gray-800">Yea ${v.yea ?? "—"}, Nay ${v.nay ?? "—"}</span>${showMargin && Number.isFinite(v.margin) ? ` · <strong class="text-gray-800">margin ${v.margin}</strong>` : ""}
      </p>
      <p class="text-xs mt-0.5">${partyLine(v.parties)} ${alignNote(v.alignment)}</p>
    </li>`;
}

const section = (title, note, body) => `
  <section>
    <h3 class="font-serif text-2xl font-bold text-gray-900">${title}</h3>
    ${note ? `<p class="text-sm text-gray-500 mt-0.5">${note}</p>` : ""}
    <div class="mt-3">${body}</div>
  </section>`;
const empty = text => `<p class="text-sm text-gray-500">${text}</p>`;

export function renderWeekPage(el, w, list) {
  const i = list.findIndex(e => e.week === w.week);
  const prev = i > 0 ? list[i - 1] : null;
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  const navBtn = (e, label) => e
    ? `<a href="#week/${esc(e.week)}" class="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-200 text-gray-800 hover:bg-gray-300">${label}</a>`
    : `<span class="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-400">${label}</span>`;
  const c = w.counts;
  const votes = c.votes.House + c.votes.Senate;
  const passed = w.passage.filter(p => p.outcome === "succeeded");
  const failed = w.passage.filter(p => p.outcome === "failed");

  const lawCards = w.laws.map(l => `
    <article class="bg-surface border border-gray-200 rounded-xl p-4">
      <p class="text-xs text-gray-500">Public Law ${esc(l.law_number || "")} · signed ${esc(day(l.signed, { month: "short", day: "numeric", year: "numeric" }))}${l.sponsor?.name ? ` · sponsor ${l.sponsor.bioguideId ? `<button type="button" data-open="member" data-id="${esc(l.sponsor.bioguideId)}" class="text-accent hover:underline">${esc(l.sponsor.name)}</button>` : esc(l.sponsor.name)}${l.sponsor.party ? ` (${esc(l.sponsor.party)}-${esc(l.sponsor.state || "")})` : ""}` : ""}</p>
      <p class="mt-1 text-sm">${billLink(l)} <span class="text-gray-900 font-semibold">${esc(l.title || "")}</span></p>
      ${l.summary?.length
        ? `<ul class="list-disc pl-5 mt-2 text-sm text-gray-700 space-y-1">${l.summary.map(b => `<li>${esc(b)}</li>`).join("")}</ul><p class="text-[11px] text-gray-400 mt-1">AI summary of the official CRS summary</p>`
        : `<p class="text-xs text-gray-500 mt-1">No official CRS summary yet.</p>`}
    </article>`).join("");

  el.innerHTML = `
    <div class="space-y-10">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="font-serif text-3xl font-bold text-gray-900">What Congress did</h2>
          <p class="text-lg text-gray-700 mt-1">${esc(weekRange(w))}${w.congress ? ` · ${esc(ordinal(w.congress))} Congress` : ""}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          ${navBtn(prev, "← Earlier week")}${navBtn(next, "Later week →")}
          <button type="button" data-copy-link="" class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-accent border border-accent/40 hover:bg-accent/10">Copy link</button>
        </div>
      </div>

      <p class="text-base sm:text-lg text-gray-800 max-w-3xl">
        The House held <strong>${c.votes.House}</strong> and the Senate <strong>${c.votes.Senate}</strong> roll-call votes.
        ${c.passed || c.failed ? `<strong>${c.passed}</strong> ${c.passed === 1 ? "bill or resolution" : "bills and resolutions"} passed a chamber by roll call${c.failed ? ` and <strong>${c.failed}</strong> failed` : ""}.` : ""}
        ${c.laws ? `<strong>${plural(c.laws, "law")}</strong> ${c.laws === 1 ? "was" : "were"} signed.` : "No new laws were signed."}
        ${c.nominations ? `The Senate confirmed <strong>${c.confirmed}</strong> of ${plural(c.nominations, "nominee")} it voted on.` : ""}
        ${c.same + c.opposed ? `On the ${votes} votes, most Democrats and most Republicans voted the same way <strong>${c.same}</strong> times and opposite ways <strong>${c.opposed}</strong> times.` : ""}
      </p>

      ${section("Became law", "Bills signed into law this week (Public Law date).", w.laws.length ? `<div class="grid gap-3 md:grid-cols-2">${lawCards}</div>` : empty("No bills became law this week."))}
      ${section("Passed by roll call", "Passage votes that succeeded, in order. Bills passed by voice vote or unanimous consent have no roll call; they appear here when they become law.",
        passed.length ? `<ul class="divide-y divide-gray-200">${passed.map(v => voteRow(v)).join("")}</ul>` : empty("No bills or resolutions passed a chamber by roll call this week."))}
      ${failed.length ? section("Failed", "Passage votes that failed.", `<ul class="divide-y divide-gray-200">${failed.map(v => voteRow(v)).join("")}</ul>`) : ""}
      ${section("Closest votes", "The smallest Yea–Nay margins among passage, cloture, nomination and amendment votes (procedural motions left out).",
        w.closest.length ? `<ul class="divide-y divide-gray-200">${w.closest.map(v => voteRow(v, { showMargin: true })).join("")}</ul>` : empty("No such votes this week."))}
      ${c.nominations ? section("Nominations", "Senate votes on nominations (nominee as named in the vote record).",
        `<ul class="divide-y divide-gray-200">${w.nominations.map(v => voteRow(v)).join("")}</ul>`) : ""}

      <p class="text-xs text-gray-500 border-t border-gray-200 pt-4">Weeks run Monday to Sunday, Eastern time. Built from roll-call votes (House Clerk, senate.gov) and Congress.gov bill records. Party numbers are Yea–Nay. <a href="#methodology" class="text-accent hover:underline">How we count</a></p>
    </div>`;
}
