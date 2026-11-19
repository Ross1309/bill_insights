// Missed votes, the same words everywhere (member cards, member window, Home): a member's
// own count and share, next to the typical member of their chamber. Never sorted or
// ranked. From stats/participation (netlify/lib/participation.js; loadParticipation in data.js).
// Delegates may vote only on some amendments, so they get an explanation, not a share.
// The official record doesn't say why a vote was missed, and we say so.

import { escapeHtml as esc, isDelegate } from "./util.js";

const pct = x => `${x < 0.1 ? (x * 100).toFixed(1) : Math.round(x * 100)}%`;
const fmt = n => Number(n).toLocaleString("en-US");
export const WHY_NOTE = "The official record doesn't say why a vote was missed (illness, family, travel, campaigning or other duties look the same).";
const DELEGATE_NOTE = "Delegates may vote only on some amendments, so most House recorded votes don't apply to them.";

// m: a member ({ id | bioguideId, chamber, state }); counts: [roll calls, missed] or
// member_votes totals; doc: stats/participation. null when there's nothing to show.
export function missedVotes(m, doc, counts = null) {
  if (!m) return null;
  if (isDelegate(m)) return { delegate: true };
  const c = counts?.votes != null ? [counts.votes, counts.not_voting || 0] : counts || doc?.members?.[m.id || m.bioguideId];
  if (!c || !c[0]) return null;
  const med = doc?.medians?.[m.chamber]?.missed_share;
  return { votes: c[0], missed: c[1], share: c[1] / c[0], median: med ?? null, chamber: m.chamber };
}

// One line for cards (a <span>: cards are buttons): "Missed 12 of 685 votes (1.8%)".
export function missedShort(m, doc) {
  const x = missedVotes(m, doc);
  if (!x) return "";
  if (x.delegate) return `<span class="block text-xs text-gray-500 mt-0.5">Delegate: votes only on some amendments</span>`;
  return `<span class="block text-xs text-gray-600 mt-0.5">Missed ${fmt(x.missed)} of ${fmt(x.votes)} votes (${pct(x.share)})</span>`;
}

// A short statement for the member window and Home, with the chamber's typical share.
export function missedLong(m, doc, counts = null, { note = true } = {}) {
  const x = missedVotes(m, doc, counts);
  if (!x) return "";
  if (x.delegate) return `<p class="text-sm text-gray-600">${esc(DELEGATE_NOTE)}</p>`;
  return `
    <p class="text-sm text-gray-800">Missed <strong>${fmt(x.missed)} of ${fmt(x.votes)}</strong> recorded votes this Congress (${pct(x.share)}).${x.median != null ? ` <span class="text-gray-600">Typical ${esc(x.chamber)} member: ${pct(x.median)}.</span>` : ""}</p>
    ${note ? `<p class="text-xs text-gray-500 mt-1">${esc(WHY_NOTE)} <a href="#methodology" class="text-accent hover:underline">How we count</a></p>` : ""}`;
}
