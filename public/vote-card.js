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
import { voteHeadline, resultWord, partyWords, outcomeOf } from "./plain.js";

const SOURCE = { House: "House Clerk record", Senate: "Senate.gov record" };
// Key votes: final votes on bills/resolutions and nominations (vote_summaries.kind).
export const isKeyVote = v => v.kind === "passage" || v.kind === "nomination";

export function asVote(v) {
  const bill = v.bill !== undefined ? v.bill
    : v.bill_id ? { id: v.bill_id, label: v.legislation || v.bill_id, title: v.bill_title || null } : null;
  return {
    id: v.id || v.vote_id, chamber: v.chamber, date: v.date, question: v.question || "", result: v.result || "",
    outcome: v.outcome || outcomeOf(v.result), yea: v.yea ?? v.tallies?.yea ?? null, nay: v.nay ?? v.tallies?.nay ?? null,
    parties: v.parties || v.party_breakdown || {}, bill, document_title: v.document_title || null, legislation: v.legislation || null,
    roll: v.roll_call_number ?? v.roll ?? null, source_url: v.source_url || null, kind: v.kind || null,
    members: v.member_count || v.individual_votes?.length || null,
  };
}

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

// yours: optional HTML for the "your members" footer (home page).
export function voteCardHtml(raw, { yours = "", margin = null } = {}) {
  const v = asVote(raw);
  const ok = v.outcome === "succeeded";
  const label = v.bill ? officialLabel(v.bill.label || v.bill.id) : v.legislation ? officialLabel(v.legislation) : "";
  const meaning = v.bill || !/nomination/i.test(v.question) ? explainQuestion(v.question) : "";
  const independents = v.parties?.I ? `<p class="text-xs text-gray-500">Independents: ${v.parties.I.yea} Yea · ${v.parties.I.nay} Nay</p>` : "";
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
      <p class="text-sm text-gray-600 mt-1"><span class="text-gray-500">${esc(v.question)}.</span>${meaning ? ` ${esc(meaning)}` : ""}</p>
      <div class="mt-3 space-y-1.5">${partyBar("Democrats", v.parties?.D, PARTY_BADGES.Democratic)}${partyBar("Republicans", v.parties?.R, PARTY_BADGES.Republican)}</div>
      ${independents}
      ${partyWords(v.parties) ? `<p class="text-xs text-gray-500 mt-2">${esc(partyWords(v.parties))}.</p>` : ""}
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
        <button type="button" data-open="vote" data-id="${esc(v.id)}" class="font-semibold text-accent hover:underline">How each member voted →</button>
        ${safeHref(v.source_url) ? `<a href="${safeHref(v.source_url)}" target="_blank" rel="noopener" class="text-accent hover:underline">${esc(SOURCE[v.chamber] || "Official record")} →</a>` : ""}
      </div>
      ${yours}
    </article>`;
}
