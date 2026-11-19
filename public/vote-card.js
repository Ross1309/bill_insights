// One vote card for the whole site (Home key votes, Votes tab, week pages, a bill's Votes
// tab): plain headline, result + Yea-Nay, official label / question / date, what the vote
// type means, Democratic and Republican Yea/Nay bars, links to the member-by-member result
// and the official record, and optionally "your members".
//
// Takes either shape: a vote_summaries doc ({ question, result, tallies, party_breakdown,
// bill_id, bill_title, legislation, document_title, ... }) or a digest item ({ yea, nay,
// parties, outcome, bill: { id, label, title } }).

import { escapeHtml as esc, formatVoteDate, officialLabel, PARTY_BADGES, safeHref } from "./util.js";
import { explainQuestion } from "./issues.js";
import { voteHeadline, resultWord, partyWords, outcomeOf, isRule, voteDivision } from "./plain.js";
import { termize, termButton, TERMS } from "./glossary.js";
import { ceremonialTag } from "./stage.js";

const SOURCE = { House: "House Clerk record", Senate: "Senate.gov record" };
// Key votes: final votes on bills/resolutions and nominations (vote_summaries.kind).
export const isKeyVote = v => v.kind === "passage" || v.kind === "nomination";

export function asVote(v) {
  const bill = v.bill !== undefined ? v.bill
    : v.bill_id ? { id: v.bill_id, label: v.legislation || v.bill_id, title: v.bill_title || null, summary: v.bill_summary || null, ceremonial: Boolean(v.bill_ceremonial) } : null;
  return {
    id: v.id || v.vote_id, chamber: v.chamber, date: v.date, question: v.question || "", result: v.result || "", title: v.title || null,
    outcome: v.outcome || outcomeOf(v.result), yea: v.yea ?? v.tallies?.yea ?? null, nay: v.nay ?? v.tallies?.nay ?? null,
    parties: v.parties || v.party_breakdown || {}, bill, document_title: v.document_title || null, legislation: v.legislation || null,
    roll: v.roll_call_number ?? v.roll ?? null, source_url: v.source_url || null, kind: v.kind || null,
    members: v.member_count || v.individual_votes?.length || null,
    tie_breaker: v.tie_breaker || null,
  };
}

// "The Vice President broke the 50–50 tie, voting Yea." (Senate; senators' tallies stay as recorded)
export const tieLine = v => (v.tie_breaker?.by && v.tie_breaker.vote
  ? `<p class="text-xs text-gray-700 mt-1">The ${esc(v.tie_breaker.by)} broke the ${v.yea ?? "?"}–${v.nay ?? "?"} tie, voting ${esc(v.tie_breaker.vote)}.</p>` : "");

export function partyBar(label, c, cls) {
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

// "Close vote", "Split along party lines"…: neutral tags (not the Yea/Nay or party colors);
// tapping one explains the rule.
export function divisionTags(v) {
  const tags = voteDivision(v).map(k => `<span class="inline-flex items-center text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded px-2 [&>button]:min-h-6">${termButton(k, esc(TERMS[k][0]))}</span>`);
  if (v.bill?.ceremonial) tags.push(ceremonialTag());
  return tags.length ? `<p class="flex flex-wrap gap-1.5 mt-2">${tags.join("")}</p>` : "";
}

// What the measure voted on does: the first point of its AI summary, labeled with its source.
// Not for House rules (they only set the terms of debate; the card says so).
function billDoesHtml(v) {
  if (!v.bill || isRule(v)) return "";
  const what = /^[hs](con|j)?res/i.test(String(v.bill.id || "")) ? "resolution" : "bill";
  return v.bill.summary
    ? `<div class="mt-2 border-l-2 border-accent/40 pl-3"><p class="text-sm text-gray-800"><span class="font-semibold text-gray-900">What the ${what} does:</span> ${esc(v.bill.summary)}</p><p class="text-[11px] text-gray-500 mt-0.5">AI summary of the official CRS summary</p></div>`
    : `<p class="text-xs text-gray-500 mt-2">No plain-language summary here yet.</p>`;
}

// yours: optional HTML for the "your members" footer (home page). billSummary: false where
// the bill is already on screen (a bill's own Votes tab). compact: the party bars, procedure
// and record links fold behind "Details" (Home).
export function voteCardHtml(raw, { yours = "", margin = null, billSummary = true, compact = false } = {}) {
  const v = asVote(raw);
  const ok = v.outcome === "succeeded";
  const label = v.bill ? officialLabel(v.bill.label || v.bill.id) : v.legislation ? officialLabel(v.legislation) : "";
  // A vote on a nominee (PN …, no bill): cloture then needs a simple majority, not 60.
  const onNominee = !v.bill && /^PN/i.test(v.legislation || "");
  const meaning = v.bill || !/nomination/i.test(v.question) ? explainQuestion(v.question, { nomination: onNominee }) : "";
  const independents = v.parties?.I ? `<p class="text-xs text-gray-500">Independents: ${v.parties.I.yea} Yea · ${v.parties.I.nay} Nay</p>` : "";
  const question = `<p class="text-sm text-gray-600 mt-1"><span class="text-gray-500">${termize(esc(v.question))}.</span>${meaning ? ` ${esc(meaning)}` : ""}</p>`;
  const bars = `<div class="mt-3 space-y-1.5">${partyBar("Democrats", v.parties?.D, PARTY_BADGES.Democratic)}${partyBar("Republicans", v.parties?.R, PARTY_BADGES.Republican)}</div>${independents}`;
  const words = partyWords(v.parties) ? `<p class="text-xs text-gray-500 mt-2">${esc(partyWords(v.parties))}.</p>` : "";
  const links = `
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
        <button type="button" data-open="vote" data-id="${esc(v.id)}" class="font-semibold text-accent hover:underline">How each member voted →</button>
        ${safeHref(v.source_url) ? `<a href="${safeHref(v.source_url)}" target="_blank" rel="noopener" class="text-accent hover:underline">${esc(SOURCE[v.chamber] || "Official record")} →</a>` : ""}
      </div>`;
  return `
    <article class="bg-surface border border-gray-200 rounded-2xl p-5">
      <div class="flex items-start justify-between gap-3">
        <h3 class="font-serif text-lg font-bold text-gray-900 leading-snug"><button type="button" data-open="vote" data-id="${esc(v.id)}" class="text-left hover:underline">${esc(voteHeadline(v))}</button></h3>
        <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded ${ok ? "bg-green-100 text-green-800" : v.outcome === "failed" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700"}">${esc(resultWord(v))}${v.yea != null ? ` ${v.yea}–${v.nay}` : ""}</span>
      </div>
      <p class="text-xs text-gray-500 mt-1">
        ${v.bill ? `<button type="button" data-open="bill" data-id="${esc(v.bill.id)}" class="font-semibold text-accent hover:underline">${esc(label)}</button> · ` : label ? `${esc(label)} · ` : ""}${esc(v.chamber || "")}${v.roll != null ? ` roll call #${esc(String(v.roll))}` : ""} · ${esc(formatVoteDate(v.date))}${margin != null ? ` · <strong class="text-gray-800">margin ${margin}</strong>` : ""}
      </p>
      ${!v.bill && v.document_title ? `<p class="text-sm text-gray-700 mt-1">${esc(v.document_title)}</p>` : ""}
      ${billSummary ? billDoesHtml(v) : ""}
      ${compact ? `
      ${tieLine(v)}
      ${divisionTags(v)}
      <details class="mt-2">
        <summary class="cursor-pointer py-1 text-xs font-semibold text-accent">Details: how each party voted</summary>
        ${question}${bars}${words}${links}
      </details>` : `
      ${question}${bars}
      ${tieLine(v)}
      ${divisionTags(v)}
      ${words}${links}`}
      ${yours}
    </article>`;
}
