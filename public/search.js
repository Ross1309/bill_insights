// Header search: members (by name or state, from the directory doc), a bill by number
// ("HR 2102", "H.R. 2102", "S 5"), topics and watchlists (from stats/overview), and a
// fallback that runs the Bills tab's own search. Arrow keys / Enter / Escape work; the
// directory (one read) loads the first time someone types.

import { escapeHtml as esc, STATE_NAMES } from "./util.js";
import { getOverviewDoc } from "./data.js";
import { loadDirectory } from "./members.js";
import { switchTab } from "./tabs.js";

const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const BILL = /^(h\.?\s*r\.?|s\.?|h\.?\s*res\.?|s\.?\s*res\.?|h\.?\s*j\.?\s*res\.?|s\.?\s*j\.?\s*res\.?|h\.?\s*con\.?\s*res\.?|s\.?\s*con\.?\s*res\.?)\s*(\d{1,5})$/i;
const BILL_LABEL = { HR: "H.R.", S: "S.", HRES: "H.Res.", SRES: "S.Res.", HJRES: "H.J.Res.", SJRES: "S.J.Res.", HCONRES: "H.Con.Res.", SCONRES: "S.Con.Res." };
const MAX_MEMBERS = 6;

let results = [];   // [{ html, act() }]
let active = -1;

async function compute(term) {
  const out = [];
  const t = fold(term);
  const stats = (await getOverviewDoc().catch(() => null))?.data?.() || {};

  const b = BILL.exec(term.trim());
  if (b && stats.congress) {
    const type = b[1].replace(/[.\s]/g, "").toUpperCase();
    const id = `${type.toLowerCase()}${b[2]}-${stats.congress}`;
    out.push({ kind: "Bill", text: `${BILL_LABEL[type] || type} ${b[2]}`, sub: `${stats.congress}th Congress`, attrs: `data-open="bill" data-id="${esc(id)}"` });
  }

  try {
    const { members } = await loadDirectory();
    const state = Object.entries(STATE_NAMES).find(([code, name]) => fold(code) === t || fold(name) === t)?.[0];
    const hits = members.filter(m => state ? m.state === state
      : fold(m.name).split(/[\s,]+/).some(w => w.startsWith(t)) || fold(m.name).includes(t));
    for (const m of hits.slice(0, MAX_MEMBERS)) {
      const role = m.chamber === "Senate" ? "Senator" : m.district ? `Rep., District ${m.district}` : "House, at large";
      out.push({ kind: "Member", text: String(m.name || "").split(", ").reverse().join(" "), sub: `${role} · ${m.state}`, attrs: `data-open="member" data-id="${esc(m.id)}"` });
    }
    if (state && hits.length > MAX_MEMBERS) out.push({ kind: "Members", text: `All ${hits.length} members from ${STATE_NAMES[state]}`, sub: "", href: `#legislators/${state}` });
  } catch { /* directory unavailable: other results still show */ }

  for (const tp of stats.topics_summary || []) {
    if (fold(tp.label).includes(t)) out.push({ kind: "Topic", text: tp.label, sub: `${tp.law} laws this Congress`, href: `#issues/${tp.slug}` });
    for (const w of tp.watchlists || []) if (fold(w).includes(t)) out.push({ kind: "Topic", text: w, sub: `in ${tp.label}`, href: `#issues/${tp.slug}` });
  }

  out.push({ kind: "Bills", text: `Search bill titles for “${term.trim()}”`, sub: "", bills: term.trim() });
  return out;
}

function render(box, input) {
  input.setAttribute("aria-expanded", String(results.length > 0));
  box.classList.toggle("hidden", !results.length);
  box.innerHTML = results.map((r, i) => {
    const attrs = r.attrs || (r.href ? `href="${esc(r.href)}"` : `data-search-bills="${esc(r.bills)}"`);
    const tag = r.href ? "a" : "button";
    return `<${tag} ${tag === "button" ? 'type="button"' : ""} ${attrs} role="option" id="site-search-opt-${i}" aria-selected="${i === active}"
      class="w-full flex items-baseline gap-3 px-4 py-2.5 text-left text-sm ${i === active ? "bg-gray-100" : ""} hover:bg-gray-100 border-b border-gray-200 last:border-0">
      <span class="w-16 shrink-0 text-[11px] uppercase tracking-wide text-gray-500">${esc(r.kind)}</span>
      <span class="min-w-0"><span class="text-gray-900">${esc(r.text)}</span>${r.sub ? ` <span class="text-xs text-gray-500">${esc(r.sub)}</span>` : ""}</span>
    </${tag}>`;
  }).join("");
  input.setAttribute("aria-activedescendant", active >= 0 ? `site-search-opt-${active}` : "");
}

export function setupSearch() {
  const input = document.getElementById("site-search-input");
  const box = document.getElementById("site-search-results");
  if (!input || !box) return;
  let timer, request = 0;
  const close = () => { results = []; active = -1; render(box, input); };

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const term = input.value;
    if (fold(term).length < 2) return close();
    timer = setTimeout(async () => {
      const r = ++request;
      const out = await compute(term);
      if (r !== request) return;
      results = out; active = -1;
      render(box, input);
    }, 150);
  });
  input.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { close(); return; }
    if (!results.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      active = (active + (ev.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      render(box, input);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      box.querySelectorAll('[role="option"]')[Math.max(0, active)]?.click();
    }
  });
  // Picking a result: detail windows open via the global data-open handler; links
  // navigate; the bills fallback runs the Bills tab search.
  box.addEventListener("click", ev => {
    const bills = ev.target.closest("[data-search-bills]");
    if (bills) {
      switchTab("bills");
      const field = document.getElementById("search-input");
      if (field) { field.value = bills.dataset.searchBills; field.dispatchEvent(new Event("input")); }
    }
    if (ev.target.closest('[role="option"]')) { input.value = ""; setTimeout(close, 0); }
  });
  document.addEventListener("click", ev => { if (!ev.target.closest("#site-search")) close(); });
}
