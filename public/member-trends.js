// A member's own trends, month by month (member window, Voting Record tab): how many
// votes they missed and how often they voted with their party's majority. Compared only
// with themselves: no other members, no ranking. From member_votes.monthly
// ({ "2025-03": [roll calls, missed, with party, party-comparable] }).

import { escapeHtml as esc } from "./util.js";

// "Mar ’25" / "March 2025", built by hand: Intl's short form differs between engines
// ("Mar 25" in Node 24, "Mar ’25" in Node 26 and some browsers).
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym, style = "short") => {
  const [y, m] = ym.split("-").map(Number);
  return style === "short" ? `${SHORT[m - 1]} ’${String(y).slice(2)}` : `${LONG[m - 1]} ${y}`;
};
const pct = (a, b) => (b ? Math.round(a / b * 100) : null);

// Every month from the first to the last with votes (recess months stay as gaps).
export function months(monthly) {
  const keys = Object.keys(monthly).sort();
  if (!keys.length) return [];
  const out = [];
  for (let d = new Date(`${keys[0]}-15T12:00:00Z`); ; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const k = d.toISOString().slice(0, 7);
    out.push(k);
    if (k >= keys.at(-1)) break;
  }
  return out;
}

// Bars of a share per month. The bars are a stretchable SVG; the axis labels are plain
// text around it, so they stay readable at any width. The scale is labeled, so small
// values aren't exaggerated: 0-100% for party votes, 0 to a round ceiling for missed votes.
export function bars(keys, valueOf, { max, title, label, unit = "%" }) {
  const n = keys.length, step = Math.max(1, Math.ceil(n / 8));
  const y = v => 100 - Math.min(v, max) / max * 100;
  return `
    <div class="relative pl-10 mt-1">
      ${[max, max / 2, 0].map(v => `<span class="absolute left-0 w-8 text-right text-[11px] leading-none text-gray-500" style="top:calc(${y(v)}% * 7 / 8 - 5px)">${v}${unit}</span>`).join("")}
      <svg viewBox="0 0 ${n} 100" preserveAspectRatio="none" class="block w-full h-28" role="img" aria-label="${esc(title)}">
        ${[0, 50, 100].map(v => `<line x1="0" x2="${n}" y1="${v}" y2="${v}" stroke="#444" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join("")}
        ${keys.map((k, i) => {
          const v = valueOf(k);
          if (v == null) return "";
          const h = Math.max(v > 0 ? 1.5 : 0, 100 - y(v));
          return `<rect x="${i + 0.12}" y="${100 - h}" width="0.76" height="${h}" fill="#13a5b2"><title>${esc(label(k))}</title></rect>`;
        }).join("")}
      </svg>
      <div class="relative h-4 mt-1 text-[11px] text-gray-500">${keys.map((k, i) => (i % step === 0 ? `<span class="absolute -translate-x-1/2 whitespace-nowrap" style="left:${(i + 0.5) / n * 100}%">${monthName(k)}</span>` : "")).join("")}</div>
    </div>`;
}

export function memberTrendsHtml(record) {
  const m = record?.monthly || {}, t = record?.totals || {};
  // Only when the history covers every counted vote (records from before it was kept don't).
  const sum = Object.values(m).reduce((s, r) => s + r[0], 0);
  if (!sum || sum !== t.votes) return "";
  const keys = months(m);
  if (keys.length < 3) return "";
  const row = k => m[k] || null;

  const missed = k => (row(k) ? pct(row(k)[1], row(k)[0]) : null);
  // The month with the most votes missed (a count; the bars show each month's share).
  const peak = keys.filter(k => row(k)?.[1]).sort((a, b) => row(b)[1] - row(a)[1] || a.localeCompare(b))[0];
  const missedMax = Math.max(10, Math.ceil(Math.max(...keys.map(k => missed(k) ?? 0)) / 10) * 10);
  const missedNote = !t.not_voting ? "They haven't missed a vote this Congress."
    : `They missed the most votes in ${monthName(peak, "long")}: ${row(peak)[1]} of ${row(peak)[0]}. Bars show the share missed each month.`;

  const party = k => (row(k)?.[3] >= 5 ? pct(row(k)[2], row(k)[3]) : null);   // months with too few comparable votes are left out
  const partyVals = keys.map(party).filter(v => v != null);
  const partyNote = partyVals.length ? `In months with at least 5 votes to compare, they voted with their party's majority between ${Math.min(...partyVals)}% and ${Math.max(...partyVals)}% of the time.` : "";

  return `
    <section class="mt-5" aria-labelledby="trend-title">
      <h3 id="trend-title" class="text-sm font-bold text-gray-900">Month by month</h3>
      <p class="text-xs text-gray-500">Compared only with themselves. Hover over a bar for its numbers, or view them as a table; months without bars had no votes.</p>
      <div class="mt-3">
        <p class="text-sm font-semibold text-gray-800">Votes missed</p>
        <p class="text-xs text-gray-600">${esc(missedNote)}</p>
        ${bars(keys, missed, { max: missedMax, title: `Share of votes missed each month, ${monthName(keys[0], "long")} to ${monthName(keys.at(-1), "long")}`,
          label: k => (row(k) ? `${monthName(k, "long")}: missed ${row(k)[1]} of ${row(k)[0]} votes` : `${monthName(k, "long")}: no votes`) })}
      </div>
      ${partyVals.length ? `<div class="mt-3">
        <p class="text-sm font-semibold text-gray-800">Voted with their party's majority</p>
        <p class="text-xs text-gray-600">${esc(partyNote)}</p>
        ${bars(keys, party, { max: 100, title: "Share of Yea or Nay votes that matched their party's majority, each month",
          label: k => (row(k)?.[3] >= 5 ? `${monthName(k, "long")}: with their party on ${row(k)[2]} of ${row(k)[3]} votes` : `${monthName(k, "long")}: too few votes to compare`) })}
      </div>` : ""}
      <details class="mt-2 text-sm"><summary class="cursor-pointer text-accent">View as table</summary>
        <div class="overflow-x-auto mt-2"><table class="text-xs tabular-nums"><thead class="text-gray-500"><tr><th class="text-left pr-4 py-1">Month</th><th class="text-right pr-4">Roll calls</th><th class="text-right pr-4">Missed</th><th class="text-right">With party</th></tr></thead>
        <tbody>${keys.filter(row).map(k => `<tr class="border-t border-gray-200"><td class="pr-4 py-1">${monthName(k, "long")}</td><td class="text-right pr-4">${row(k)[0]}</td><td class="text-right pr-4">${row(k)[1]}</td><td class="text-right">${row(k)[3] ? `${row(k)[2]} of ${row(k)[3]}` : "—"}</td></tr>`).join("")}</tbody></table></div>
      </details>
    </section>`;
}
