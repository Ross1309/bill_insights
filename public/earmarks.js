// Earmarks ("Community Project Funding" in the House, "Congressionally Directed Spending" in the
// Senate): projects members ask for by name, with a recipient and an amount, listed in the
// explanatory statement of each spending law. Built by scripts/build-earmarks.js into public
// stats docs; each table is published only after its checks pass (netlify/lib/earmark-sources.js).
//
// Shown in the bill window (Contents tab: "Earmarks in this law") and the member window
// (Overview: "Earmarks they requested"), each member on their own record, never ranked.

import { getFirestoreDoc } from "./data.js";
import { escapeHtml as esc } from "./util.js";

export const EARMARK_YEARS = [2026];
const LIST_STEP = 50;

const cache = new Map();
const statsDoc = id => {
  if (!cache.has(id)) cache.set(id, getFirestoreDoc("stats", id).catch(err => { cache.delete(id); throw err; }));
  return cache.get(id);
};
const TABLE_NAMES = {};   // table key -> subcommittee, for the member list's rows
const earmarkIndex = fy => statsDoc(`earmarks-${fy}`).then(ix => {
  for (const t of ix?.tables || []) TABLE_NAMES[t.key] = t.subcommittee;
  return ix;
});

// "$930.7 million", "$1.39 billion", "$722,000"
export function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2).replace(/\.?0+$/, "")} billion`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
const projects = n => `${n.toLocaleString("en-US")} ${n === 1 ? "project" : "projects"}`;

// The published tables of a bill: [{ fy, key, subcommittee, division, count, total, checks, ... }]
export async function billEarmarks(billId) {
  const out = [];
  for (const fy of EARMARK_YEARS) {
    const ix = await earmarkIndex(fy).catch(() => null);
    for (const t of ix?.tables || []) if (t.bill_id === billId && t.published) out.push({ fy, ...t });
  }
  return out;
}

// A member's totals per year: [{ fy, count, total }]
export async function memberEarmarks(id) {
  const out = [];
  for (const fy of EARMARK_YEARS) {
    const ix = await earmarkIndex(fy).catch(() => null);
    const m = ix?.by_member?.[id];
    if (m) out.push({ fy, count: m[0], total: m[1] });
  }
  return out;
}

// What a "Show the projects" button loads: "2026:thud" (a bill's table) or "2026:state:WA" (a
// member's state, then filtered to them).
export function loadEarmarkList(key) {
  const [fy, a, b] = key.split(":");
  return a === "state" ? statsDoc(`earmarks-${fy}-state-${b}`) : statsDoc(`earmarks-${fy}-${a}`);
}

const CHECK_WORDS = {
  law: "the amounts the law itself provides",
  statement: "the amounts the explanatory statement gives",
  reference: "an official count or total published elsewhere",
  parts: "the statement's per-section tables",
};
function checksHtml(t) {
  const kinds = [...new Set(t.checks.filter(c => c.ok).map(c => CHECK_WORDS[c.kind]).filter(Boolean))];
  const notes = t.checks.map(c => c.note).filter(Boolean);
  return `
    <p class="text-[11px] text-gray-500 mt-1">Read from the official table and checked against ${esc(kinds.join("; "))}.${t.amount_note ? ` ${esc(t.amount_note)}` : ""}</p>
    ${notes.map(x => `<p class="text-[11px] text-gray-500 mt-0.5">Note: ${esc(x)}</p>`).join("")}`;
}

// Who asked: linked when matched to a member; the printed name otherwise.
function requesters(ids, people) {
  return ids.map(id => {
    if (id.startsWith("~")) return esc(id.slice(1));
    const [name, party, state] = people?.[id] || [id, "", ""];
    return `<button type="button" data-open="member" data-id="${esc(id)}" class="text-accent hover:underline">${esc(name)}</button>${party ? ` <span class="text-gray-500">(${esc(party)}-${esc(state)})</span>` : ""}`;
  }).join(", ");
}

// The rows of a loaded doc that match the filter (and, for a member, that they requested).
function matchingRows(doc, { text = "", member = null } = {}) {
  const q = text.trim().toLowerCase();
  return (doc?.rows || []).filter(r => {
    if (member && !r[6].includes(member) && !r[7].includes(member)) return false;
    if (!q) return true;
    const who = [...r[6], ...r[7]].map(id => (id.startsWith("~") ? id.slice(1) : doc.people?.[id]?.[0] || "")).join(" ");
    const [agency, account] = doc.accounts[r[0]] || [];
    return `${r[1]} ${r[2]} ${r[3]} ${r[4]} ${agency} ${account} ${who}`.toLowerCase().includes(q);
  });
}

// The list of projects, for a loaded doc. `opts`: { text, member, limit, listKey }
export function earmarkListHtml(doc, opts = {}) {
  const rows = matchingRows(doc, opts);
  const limit = opts.limit || LIST_STEP;
  if (!rows.length) return `<p class="text-sm text-gray-500 py-3">${opts.text ? "No projects match." : "No projects."}</p>`;
  const total = rows.reduce((a, r) => a + r[5], 0);
  return `
    <p class="text-xs text-gray-500 mt-2">${projects(rows.length)}, ${money(total)}${opts.text ? " matching" : ""}.</p>
    <ul class="mt-1">${rows.slice(0, limit).map(r => {
      const [agency, account] = doc.accounts[r[0]] || [];
      const where = [r[3] || r[4] || ""].filter(x => x && x !== r[1])[0] || "";
      const from = r[9] ? TABLE_NAMES[r[9]] : null;
      return `
        <li class="py-2 border-b border-gray-200">
          <p class="flex justify-between gap-3 text-sm"><span class="text-gray-900">${esc(r[2] || r[1])}</span><span class="font-semibold text-gray-900 whitespace-nowrap">${esc(money(r[5]))}</span></p>
          <p class="text-xs text-gray-600">${r[1] && r[1] !== r[2] ? `${esc(r[1])} · ` : ""}${esc(where)}${agency || account ? ` · ${esc([agency, account].filter(Boolean).join(", "))}` : ""}${from ? ` · ${esc(from)}` : ""}</p>
          <p class="text-xs text-gray-500">Requested by ${requesters([...r[6], ...r[7]], doc.people) || "not listed"}</p>
        </li>`;
    }).join("")}</ul>
    ${rows.length > limit ? `<button type="button" data-earmark-more="${esc(opts.listKey || "")}" class="mt-2 text-sm text-accent hover:underline">Show ${Math.min(LIST_STEP, rows.length - limit)} more of ${(rows.length - limit).toLocaleString("en-US")}</button>` : ""}`;
}

// A list block: the "Show the projects" button, or the search box and the list once loaded.
function listBlockHtml(e, key, { member = null, label = "Show the projects" } = {}) {
  const doc = e.data[`em:${key}`];
  if (e.errors[`em:${key}`]) return `<p class="text-sm text-red-600 mt-2">Couldn't load the projects: ${esc(e.errors[`em:${key}`])}</p>`;
  if (doc === undefined && !e.filter[`emOpen:${key}`]) {
    return `<button type="button" data-earmark-show="${esc(key)}" class="mt-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-accent border border-accent/40 hover:bg-accent/10">${esc(label)}</button>`;
  }
  if (doc === undefined) return `<p class="text-sm text-gray-500 mt-2">Loading the projects…</p>`;
  return `
    <input type="search" data-earmark-filter="${esc(key)}" value="${esc(e.filter[`emText:${key}`] || "")}" placeholder="Search projects, places or members"
      class="mt-2 w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
    <div data-earmark-list="${esc(key)}">${earmarkListHtml(doc, { text: e.filter[`emText:${key}`], member, limit: e.filter[`emLimit:${key}`], listKey: key })}</div>`;
}

const WHAT = `Earmarks are projects members of Congress ask for by name, with a specific recipient and amount ("Community Project Funding" in the House, "Congressionally Directed Spending" in the Senate). Each one is published with the names of the members who asked for it.`;

// Bill window, Contents tab.
export function billEarmarksHtml(e) {
  const list = e.data.earmarks;
  if (!list?.length) return "";
  const count = list.reduce((a, t) => a + t.count, 0), total = list.reduce((a, t) => a + t.total, 0);
  return `
    <section class="mt-5 border border-gray-200 rounded-xl p-4">
      <h3 class="text-sm font-bold text-gray-900">Earmarks in this law <span class="font-normal text-gray-500">· ${projects(count)}, ${money(total)}</span></h3>
      <p class="text-xs text-gray-600 mt-1">${esc(WHAT)}</p>
      ${list.map(t => `
        <div class="mt-4">
          <p class="text-sm"><span class="text-xs font-semibold text-gray-500">Division ${esc(t.division)}</span> <span class="font-medium text-gray-900">${esc(t.subcommittee)}</span>
            <span class="text-gray-600">· ${projects(t.count)}, ${esc(money(t.total))}</span></p>
          ${checksHtml(t)}
          ${listBlockHtml(e, `${t.fy}:${t.key}`)}
        </div>`).join("")}
    </section>`;
}

// One line for the Summary tab.
export function billEarmarksLineHtml(e) {
  const list = e.data.earmarks;
  if (!list?.length) return "";
  const count = list.reduce((a, t) => a + t.count, 0), total = list.reduce((a, t) => a + t.total, 0);
  return `<p class="text-sm text-gray-700 mt-2"><span class="font-bold text-gray-900">Earmarks:</span> ${projects(count)} requested by members of Congress, ${esc(money(total))}.
    <button type="button" data-tab="contents" class="text-accent hover:underline">See them →</button></p>`;
}

// Member window, Overview.
export function memberEarmarksHtml(e) {
  const list = e.data.earmarks, m = e.data.member;
  if (!list?.length || !m?.state) return "";
  return `
    <section class="mt-4 border border-gray-200 rounded-lg p-3">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">Earmarks they requested</h3>
      ${list.map(y => `
        <p class="text-sm text-gray-800 mt-1">Fiscal year ${y.fy}: <strong>${projects(y.count)}</strong> in spending laws, ${esc(money(y.total))}.</p>
        ${listBlockHtml(e, `${y.fy}:state:${m.state}`, { member: e.id, label: "Show their projects" })}`).join("")}
      <p class="text-[11px] text-gray-500 mt-2">${esc(WHAT)} A project two members asked for counts in full for each. <a href="#methodology" class="text-accent hover:underline">How we count</a></p>
    </section>`;
}

// The list's own re-render (search, "Show more") without redrawing the window.
export function earmarkListRefresh(e, key, root) {
  const doc = e.data[`em:${key}`];
  const el = root.querySelector(`[data-earmark-list="${CSS.escape(key)}"]`);
  if (!doc || !el) return;
  const member = key.includes(":state:") ? e.id : null;
  el.innerHTML = earmarkListHtml(doc, { text: e.filter[`emText:${key}`], member, limit: e.filter[`emLimit:${key}`], listKey: key });
}
export { LIST_STEP };
