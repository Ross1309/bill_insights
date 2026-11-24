// "What's in this bill" (bill window, Contents tab): the parts of the bill's official text
// (from /api/bill-parts), each with its heading and its share of the text, and what each part
// contains (sections; in spending bills, the agencies and accounts funded). Facts from the
// text only: the page never says whether a part belongs in the bill.

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
const share = (part, total) => {
  const p = total ? (100 * part) / total : 0;
  return p < 1 ? "under 1%" : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};
const partName = p => `${KIND[p.kind] || p.kind}${p.enum ? ` ${p.enum}` : ""}`;

// What a part holds, in order: sections ("Sec. 101. Heading"), or agencies with their accounts.
function itemsHtml(node, total) {
  const rows = [];
  let inAgency = false;
  for (const it of node.items || []) {
    if (it.kind === "section") {
      inAgency = false;
      rows.push(`<li class="py-0.5"><span class="text-gray-500">Sec. ${esc(it.enum)}.</span> ${esc(it.heading)}</li>`);
    } else if (it.kind === "agency") {
      inAgency = true;
      rows.push(`<li class="pt-2 font-semibold text-gray-900">${esc(it.heading)} <span class="font-normal text-xs text-gray-500">${share(it.words, total)} of the text</span></li>`);
    } else {
      rows.push(`<li class="py-0.5 ${inAgency ? "pl-3" : ""}">${esc(it.heading)} <span class="text-xs text-gray-500">${n(it.words)} words</span></li>`);
    }
  }
  const unheaded = node.unheaded ? `<li class="py-0.5 text-gray-500">${n(node.unheaded)} numbered ${node.unheaded === 1 ? "provision" : "provisions"} without a heading</li>` : "";
  if (!rows.length && !unheaded) return "";
  return `<ul class="mt-1 text-sm text-gray-700">${rows.join("")}${unheaded}</ul>`;
}

function barHtml(part, total) {
  const pct = total ? Math.max(0.5, (100 * part) / total) : 0;
  return `<span class="block h-1.5 mt-1 rounded-full bg-gray-200 overflow-hidden" aria-hidden="true"><span class="block h-full rounded-full bg-accent" style="width:${pct.toFixed(1)}%"></span></span>`;
}

function partHtml(p, total, level = 0) {
  const inner = `${(p.parts || []).map(c => partHtml(c, total, level + 1)).join("")}${itemsHtml(p, total)}`;
  const head = `
    <span class="flex flex-wrap items-baseline justify-between gap-x-3">
      <span>${inner.trim() ? `<span class="part-chev inline-block w-3 text-gray-500 transition-transform" aria-hidden="true">›</span>` : ""}<span class="text-xs font-semibold text-gray-500">${esc(partName(p))}</span>
        ${p.heading ? `<span class="${level ? "text-sm" : "font-semibold"} text-gray-900">${esc(p.heading)}</span>` : ""}</span>
      <span class="text-xs text-gray-500 whitespace-nowrap">${share(p.words, total)} · ${n(p.words)} words</span>
    </span>
    ${barHtml(p.words, total)}`;
  if (!inner.trim()) return `<div class="${level ? "mt-2" : "py-2 border-b border-gray-200"}">${head}</div>`;
  return `
    <details class="${level ? "mt-2 pl-3 border-l border-gray-200" : "py-2 border-b border-gray-200"} group">
      <summary class="cursor-pointer list-none [&::-webkit-details-marker]:hidden">${head}</summary>
      <div class="mt-1">${inner}</div>
    </details>`;
}

function introducedHtml(c, versions) {
  const f = c.first;
  if (!f || !versions?.first || f.version === c.version) return "";
  const titleChanged = f.official_title && c.official_title && f.official_title !== c.official_title;
  return `
    <p class="text-sm text-gray-700 mt-2">Earliest published text, ${esc(versionLabel(versions.first))}: <strong class="text-gray-900">${n(f.words)} words</strong>${f.sections ? `, ${n(f.sections)} ${f.sections === 1 ? "section" : "sections"}` : ""}.
    ${titleChanged ? `Its official title then: <q>${esc(f.official_title)}</q>` : ""}</p>`;
}

// One line for the Summary tab (only for bills with parts), pointing at the Contents tab.
export function contentsLineHtml(e) {
  const c = e.data.parts;
  if (!c?.parts?.length || c.parts.length < 2) return "";
  const kinds = new Set(c.parts.map(p => p.kind));
  const what = kinds.size === 1 ? `${c.parts.length} ${KIND[c.parts[0].kind].toLowerCase()}s` : `${c.parts.length} parts`;
  return `
    <p class="text-sm text-gray-700 mt-5"><span class="font-bold text-gray-900">What's in this bill:</span> ${esc(what)}, about ${n(c.words)} words.
      <button type="button" data-tab="contents" class="text-accent hover:underline">See each part →</button></p>`;
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
  const loose = c.parts.length ? itemsHtml({ items: c.items }, c.words) : "";
  return `
    <p class="text-sm text-gray-700"><strong class="text-gray-900">${esc(versionLabel(v))}</strong>${v.date ? `, ${esc(formatDay(v.date))}` : ""}:
      about ${n(c.words)} words, ${n(c.sections)} ${c.sections === 1 ? "section" : "sections"}${c.parts.length ? `, in ${c.parts.length} ${c.parts.length === 1 ? "part" : "parts"}` : ""}.</p>
    ${introducedHtml(c, d.textVersions)}
    ${c.parts.length ? `
      <div class="mt-4">${c.parts.map(p => partHtml(p, c.words)).join("")}</div>
      ${loose ? `<div class="mt-4"><h3 class="text-sm font-bold text-gray-900">Outside the parts above</h3>${loose}</div>` : ""}`
    : `<div class="mt-4"><h3 class="text-sm font-bold text-gray-900">Sections</h3>${itemsHtml({ items: c.items, unheaded: 0 }, c.words) || `<p class="text-sm text-gray-500 mt-1">This text has no section headings.</p>`}</div>`}
    <p class="text-[11px] text-gray-500 mt-4">From the official text${v.type ? ` (${esc(v.type)})` : ""}, published on GovInfo. Sizes are word counts, including wording the bill adds to other laws; headings are the bill's own. Tap a part to see what's in it. <a href="#methodology" class="text-accent hover:underline">How we count</a></p>
    <div class="flex flex-wrap gap-4 mt-3 text-sm">
      ${safeHref(textLink) ? `<a href="${safeHref(textLink)}" target="_blank" rel="noopener" class="text-accent hover:underline">Read the full text on Congress.gov</a>` : ""}
    </div>`;
}
