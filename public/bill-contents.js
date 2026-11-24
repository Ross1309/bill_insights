// "What's in this bill" (bill window, Contents tab), from /api/bill-parts:
// 1. At a glance: a few template sentences from the bill's own headings and sizes (spending
//    bills vs other parts, the biggest parts, what the other parts cover, and what the bill
//    was when first published, when that differs a lot).
// 2. One bar: the parts' shares of the text.
// 3. The parts, one compact row each; tap for what's inside.
// Facts from the text only: nothing says whether a part belongs in the bill.

import { escapeHtml as esc, formatDay, safeHref } from "./util.js";

const KIND = { division: "Division", subdivision: "Subdivision", title: "Title", subtitle: "Subtitle", part: "Part", subpart: "Subpart", chapter: "Chapter", subchapter: "Subchapter" };
// Congress.gov's version names, in plain words.
const VERSION = {
  "Enrolled Bill": "the final text both chambers passed",
  "Introduced in House": "as introduced in the House",
  "Introduced in Senate": "as introduced in the Senate",
  "Engrossed in House": "as passed by the House",
  "Engrossed in Senate": "as passed by the Senate",
  "Reported in House": "as reported by a House committee",
  "Reported in Senate": "as reported by a Senate committee",
  "Engrossed Amendment House": "the House's changes to the Senate's version",
  "Engrossed Amendment Senate": "the Senate's changes to the House's version",
  "Placed on Calendar Senate": "as placed on the Senate calendar",
  "Received in Senate": "as received in the Senate",
  "Received in House": "as received in the House",
};
const versionLabel = v => v ? `${v.type || "Text"}${VERSION[v.type] ? ` (${VERSION[v.type]})` : ""}` : "Official text";

const n = x => Number(x || 0).toLocaleString("en-US");
// "about 183,000 words": exact counts read as false precision at this size.
const about = w => n(w >= 10000 ? Math.round(w / 1000) * 1000 : w >= 1000 ? Math.round(w / 100) * 100 : w);
const pct = (part, total) => (total ? (100 * part) / total : 0);
const share = (part, total) => {
  const p = pct(part, total);
  return p < 1 ? "under 1%" : `${p < 10 ? p.toFixed(1).replace(/\.0$/, "") : Math.round(p)}%`;
};
const partName = p => `${KIND[p.kind] || p.kind}${p.enum ? ` ${p.enum}` : ""}`;
const plural = (k, count) => `${(KIND[k] || "part").toLowerCase()}${count === 1 ? "" : "s"}`;
const list = (xs, max) => {
  const shown = xs.slice(0, max), more = xs.length - shown.length;
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown.join("");
};

// A part that is a regular spending bill: its own heading says so ("... Appropriations Act,
// 2024"). Stopgaps ("Continuing Appropriations Act") and emergency money ("Supplemental
// Appropriations Act") aren't regular spending bills: they're listed with the other parts.
const isSpending = p => /\bappropriations act\b/i.test(p.heading || "") && !/\b(continuing|supplemental)\b/i.test(p.heading || "");
// In the rows, a spending bill's heading without the "Appropriations Act, 2024" every one of
// them ends with (the color and the summary say it): "Department of Defense". The full
// official heading stays in the row's tooltip.
const shortHeading = p => (isSpending(p) ? (p.heading || "").replace(/,?\s*appropriations act,?\s*(of\s*)?\d{4}\s*$/i, "").trim() || p.heading : p.heading);
const fiscalYear = p => /(\d{4})\s*$/.exec(p.heading || "")?.[1] || null;

// What a part covers, in its own headings: its sub-parts' headings, or, for catch-all
// headings ("Other Matters", "Extensions"), the sections inside. Routine sections (short
// title, definitions, budgetary effects, ...) are left out.
const ROUTINE = /^(short title|table of contents|definitions?|findings|budgetary effects?|effective dates?|rules? of construction|purposes?|severability|sense of congress|emergency designation|general provisions|references?)\b/i;
const CATCHALL = /\b(other matters|miscellaneous|extensions|general provisions|technical (and conforming )?amendments)\b/i;
export function topics(p) {
  const out = [];
  const sections = node => (node.items || []).filter(it => it.kind === "section" && !ROUTINE.test(it.heading)).map(it => it.heading);
  if (p.parts?.length) {
    for (const c of p.parts) {
      if (ROUTINE.test(c.heading || "")) continue;
      if (!c.heading || CATCHALL.test(c.heading)) out.push(...sections(c), ...c.parts.filter(x => x.heading && !ROUTINE.test(x.heading)).map(x => x.heading));
      else out.push(c.heading);
    }
  }
  out.push(...sections(p));
  return [...new Set(out)];
}

// The template sentences (HTML, escaped) for the top of the tab; the first one also goes on
// the Summary tab.
export function glance(c, versions) {
  const parts = c.parts || [], total = c.words, out = [];
  const spend = parts.filter(isSpending), other = parts.filter(p => !isSpending(p));
  const sum = xs => xs.reduce((a, p) => a + p.words, 0);
  if (spend.length && parts.length > 1) {
    const years = [...new Set(spend.map(fiscalYear).filter(Boolean))].sort();
    const fy = years.length ? ` for fiscal year${years.length > 1 ? "s" : ""} ${list(years, 3)}` : "";
    const spendLine = `${spend.length} regular spending ${spend.length === 1 ? "bill" : "bills"} (appropriations)${fy}, ${share(sum(spend), total)} of the text`;
    if (!other.length) out.push(`${parts.length} ${plural(parts[0].kind, parts.length)}, all ${spendLine}.`);
    else if (other.length === 1) out.push(`${spendLine}, plus ${esc(partName(other[0]))}, <q>${esc(other[0].heading || "untitled")}</q> (${share(other[0].words, total)}).`.replace(/^./, s => s.toUpperCase()));
    else out.push(`${spendLine}, plus ${other.length} other parts (${share(sum(other), total)}).`.replace(/^./, s => s.toUpperCase()));
    for (const o of other.slice(0, 3)) {
      const t = topics(o);
      if (t.length) out.push(`${esc(partName(o))} covers ${esc(list(t, 6))}.`);
    }
  } else if (parts.length > 1) {
    const top = [...parts].sort((a, b) => b.words - a.words).slice(0, 3);
    const kinds = new Set(parts.map(p => p.kind));
    out.push(`${parts.length} ${kinds.size === 1 ? plural(parts[0].kind, parts.length) : "parts"}. The largest: ${top.map(p => `${esc(partName(p))}, <q>${esc(p.heading || "untitled")}</q> (${share(p.words, total)})`).join("; ")}.`);
  } else {
    out.push(`${n(c.sections)} ${c.sections === 1 ? "section" : "sections"}${parts.length === 1 ? ` in one ${(KIND[parts[0].kind] || "part").toLowerCase()}` : ""}.`);
  }
  // What the bill was when first published, when that's very different: a much shorter text or
  // another official title (big packages often pass under an existing bill's number).
  const f = c.first;
  if (f && versions?.first && f.version !== c.version) {
    const titleChanged = f.official_title && c.official_title && f.official_title !== c.official_title;
    if (titleChanged || f.words < total / 3) {
      const when = versions.first.date ? `, ${formatDay(versions.first.date)}` : "";
      out.push(`When first published (${esc(versions.first.type || "first version")}${esc(when)}), it was ${n(f.words)} words long${titleChanged ? `, titled <q>${esc(f.official_title.replace(/\.$/, ""))}</q>` : ""}.`);
    }
  }
  return out;
}

// One bar for the whole bill: each part's share, spending bills and other parts in two colors
// (the validated chart pair: teal #13a5b2, violet #8f68cb), with a 2 px gap between parts.
function barHtml(c) {
  const parts = c.parts || [];
  if (parts.length < 2) return "";
  const split = parts.some(isSpending) && parts.some(p => !isSpending(p));
  const color = p => (!split || isSpending(p) ? "bg-[#13a5b2]" : "bg-[#8f68cb]");
  return `
    <div class="flex gap-0.5 h-3 mt-4" role="img" aria-label="${esc(parts.map(p => `${partName(p)} ${share(p.words, c.words)}`).join(", "))}">
      ${parts.map(p => `<span class="${color(p)} first:rounded-l last:rounded-r" style="width:${Math.max(0.6, pct(p.words, c.words)).toFixed(2)}%" title="${esc(`${partName(p)}: ${p.heading || ""} (${share(p.words, c.words)})`)}"></span>`).join("")}
    </div>
    ${split ? `<p class="flex flex-wrap gap-x-4 mt-1.5 text-xs text-gray-600"><span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-[#13a5b2] align-middle mr-1"></span>Spending bills</span><span><span class="inline-block w-2.5 h-2.5 rounded-sm bg-[#8f68cb] align-middle mr-1"></span>Other parts</span></p>` : ""}`;
}

// What a part holds, compactly: agencies with their accounts on one line each; sections as
// "Sec. 101 Heading", the first 8 shown and the rest behind "Show all".
function itemsHtml(node) {
  const rows = [];
  let group = null;
  for (const it of node.items || []) {
    if (it.kind === "agency") { group = { heading: it.heading, accounts: [] }; rows.push(group); }
    else if (it.kind === "account") { if (!group) { group = { heading: "", accounts: [] }; rows.push(group); } group.accounts.push(it.heading); }
    else { group = null; rows.push(it); }
  }
  const html = rows.map(r => (r.kind === "section"
    ? `<li class="py-0.5"><span class="text-gray-500">Sec. ${esc(r.enum)}</span> ${esc(r.heading)}</li>`
    : `<li class="py-0.5">${r.heading ? `<span class="font-semibold text-gray-900">${esc(r.heading)}</span>${r.accounts.length ? ": " : ""}` : ""}${r.accounts.map(esc).join(' <span class="text-gray-400">·</span> ')}</li>`));
  if (node.unheaded) html.push(`<li class="py-0.5 text-gray-500">${n(node.unheaded)} numbered ${node.unheaded === 1 ? "provision" : "provisions"} without a heading</li>`);
  if (!html.length) return "";
  const first = html.slice(0, 8).join(""), rest = html.slice(8);
  return `<ul class="mt-1 text-sm text-gray-700">${first}</ul>${rest.length ? `
    <details class="text-sm"><summary class="cursor-pointer text-accent hover:underline py-1 list-none [&::-webkit-details-marker]:hidden">Show all ${n(html.length)}</summary>
      <ul class="text-gray-700">${rest.join("")}</ul></details>` : ""}`;
}

function rowHead(p, total, { top, split }) {
  const dot = top && split ? `<span class="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle ${isSpending(p) ? "bg-[#13a5b2]" : "bg-[#8f68cb]"}" aria-hidden="true"></span>` : "";
  return `
    <span class="flex items-baseline justify-between gap-3"${p.heading && shortHeading(p) !== p.heading ? ` title="${esc(p.heading)}"` : ""}>
      <span class="min-w-0">${dot}<span class="text-xs font-semibold text-gray-500">${esc(partName(p))}</span>${p.heading ? ` <span class="${top ? "font-medium" : ""} text-gray-900">${esc(top ? shortHeading(p) : p.heading)}</span>` : ""}</span>
      <span class="text-xs text-gray-500 whitespace-nowrap">${share(p.words, total)}</span>
    </span>`;
}

function partHtml(p, total, opts) {
  const top = opts.level === 0;
  const inner = `${(p.parts || []).map(c => partHtml(c, total, { ...opts, level: opts.level + 1 })).join("")}${itemsHtml(p)}`;
  const cls = top ? "py-2.5 border-b border-gray-200" : "py-1";
  if (!inner.trim()) return `<div class="${cls} ${top ? "" : "pl-4"} text-sm">${rowHead(p, total, { ...opts, top })}</div>`;
  return `
    <details class="${cls} ${top ? "" : "text-sm"}">
      <summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex gap-1">
        <span class="part-chev inline-block w-3 shrink-0 text-gray-500 transition-transform" aria-hidden="true">›</span>
        <span class="flex-1 min-w-0">${rowHead(p, total, { ...opts, top })}</span>
      </summary>
      <div class="pl-4 mt-1 ${top ? "" : "border-l border-gray-200 ml-1"}">${inner}</div>
    </details>`;
}

// For the Summary tab: the first at-a-glance sentence, pointing at the Contents tab (only for
// bills in two or more parts).
export function contentsLineHtml(e) {
  const c = e.data.parts;
  if (!c?.parts?.length || c.parts.length < 2) return "";
  return `
    <p class="text-sm text-gray-700 mt-5"><span class="font-bold text-gray-900">What's in this bill:</span> ${glance(c, e.data.detail?.textVersions)[0]}
      <button type="button" data-tab="contents" class="text-accent hover:underline">See what's in it →</button></p>`;
}

export function contentsHtml(e, { spinner, errorBlock }) {
  const d = e.data.detail, c = e.data.parts;
  if (e.errors.detail) return errorBlock(e.errors.detail);
  if (!d) return spinner("Loading the bill's text…");
  // An answer cached from before bill-detail listed text versions (up to an hour after a deploy).
  if (!("textVersions" in d)) return `<p class="text-sm text-gray-500 py-8 text-center">Reload the page to see what's in this bill.</p>`;
  if (!d.textVersions) return `<p class="text-sm text-gray-500 py-8 text-center">Congress.gov hasn't published this bill's text in a form we can read yet.</p>`;
  if (e.errors.parts) return errorBlock(e.errors.parts, "Couldn't load the bill's text from GovInfo right now.");
  if (!c) return spinner("Reading the bill's text…");
  const v = d.textVersions.latest;
  const textLink = d.congress_gov_url ? `${d.congress_gov_url}/text` : null;
  const split = c.parts.some(isSpending) && c.parts.some(p => !isSpending(p));
  const loose = c.parts.length ? itemsHtml({ items: c.items }) : "";
  return `
    <section class="bg-gray-100 border border-gray-200 rounded-xl p-4">
      <h3 class="text-sm font-bold text-gray-900">At a glance <span class="font-normal text-gray-500">· about ${about(c.words)} words</span></h3>
      <ul class="mt-2 space-y-1.5 text-sm text-gray-700">${glance(c, d.textVersions).map(s => `<li>${s}</li>`).join("")}</ul>
      ${barHtml(c)}
    </section>
    ${c.parts.length ? `
      <h3 class="text-sm font-bold text-gray-900 mt-5">The parts <span class="font-normal text-gray-500">· share of the text; tap one to see inside${split ? `; spending bills shown without "Appropriations Act"` : ""}</span></h3>
      <div class="mt-1">${c.parts.map(p => partHtml(p, c.words, { level: 0, split })).join("")}</div>
      ${loose ? `<details class="py-2.5 border-b border-gray-200"><summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex gap-1"><span class="part-chev inline-block w-3 shrink-0 text-gray-500 transition-transform" aria-hidden="true">›</span><span class="text-sm text-gray-700">Sections outside the parts <span class="text-gray-500">(${n(c.items.length)})</span></span></summary><div class="pl-4 mt-1">${loose}</div></details>` : ""}`
    : `<h3 class="text-sm font-bold text-gray-900 mt-5">Sections</h3>${itemsHtml({ items: c.items }) || `<p class="text-sm text-gray-500 mt-1">This text has no section headings.</p>`}`}
    <p class="text-[11px] text-gray-500 mt-4">From the official text: ${esc(versionLabel(v))}${v.date ? `, ${esc(formatDay(v.date))}` : ""}, ${n(c.sections)} sections, published on GovInfo. Shares are by word count, including wording the bill adds to other laws. Headings and topics are the bill's own words; we don't judge what belongs in a bill. <a href="#methodology" class="text-accent hover:underline">How we count</a></p>
    ${safeHref(textLink) ? `<p class="mt-2 text-sm"><a href="${safeHref(textLink)}" target="_blank" rel="noopener" class="text-accent hover:underline">Read the full text on Congress.gov</a></p>` : ""}`;
}
