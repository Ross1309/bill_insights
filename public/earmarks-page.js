// The Earmarks page (#earmarks, #earmarks/WA): every earmark in the year's spending laws, by law
// and by state, from the same checked data as the bill and member windows (earmarks.js).
// States and members are listed alphabetically, never by amount: nothing here is a ranking.

import { EARMARK_YEARS, earmarkListHtml, getEarmarkIndex, LIST_STEP, loadEarmarkList, money } from "./earmarks.js";
import { escapeHtml as esc, loadErrorHtml, officialLabel, STATE_NAMES, store } from "./util.js";
import { DEFAULT_STATE, myReps } from "./members.js";
import { replaceTab } from "./router.js";

const FY = EARMARK_YEARS.at(-1);
const container = () => document.getElementById("earmarks-container");
let index = null, state = null, stateDoc = null, stateError = null, text = "", limit = LIST_STEP, request = 0;

const projects = n => `${n.toLocaleString("en-US")} ${n === 1 ? "project" : "projects"}`;
const stateName = st => STATE_NAMES[st] || st;

// For the router: the state in the URL (#earmarks/WA).
export const earmarksArg = () => state || "";
export function applyEarmarksArg(arg) {
  const st = String(arg || "").toUpperCase();
  if (STATE_NAMES[st] && st !== state) { state = st; if (index) loadState(); }
}

function lawsHtml() {
  const laws = new Map();
  for (const t of index.tables.filter(x => x.published)) {
    if (!laws.has(t.bill_id)) laws.set(t.bill_id, { title: (t.law_title || "").replace(/\.$/, ""), law: t.law, parts: [] });
    laws.get(t.bill_id).parts.push(t);
  }
  return [...laws].map(([id, l]) => `
    <article class="bg-surface border border-gray-200 rounded-xl p-4">
      <p class="text-xs text-gray-500">${esc(officialLabel(id))}${l.law ? ` · Public Law ${esc(l.law)}` : ""}</p>
      <h4 class="font-serif text-base font-bold text-gray-900 mt-0.5"><button type="button" data-open="bill" data-id="${esc(id)}" class="text-left hover:underline">${esc(l.title || officialLabel(id))}</button></h4>
      <ul class="mt-2 space-y-1 text-sm">${l.parts.map(t => `
        <li class="flex flex-col sm:flex-row sm:justify-between sm:gap-3"><span class="text-gray-800"><span class="text-xs text-gray-500">Division ${esc(t.division)}</span> ${esc(t.subcommittee)}</span>
          <span class="text-gray-600 whitespace-nowrap">${projects(t.count)} · ${esc(money(t.total))}</span></li>`).join("")}</ul>
      <p class="text-xs mt-2"><button type="button" data-open="bill" data-id="${esc(id)}" class="text-accent hover:underline">Each project, with who asked for it →</button> <span class="text-gray-500">(the law's Contents tab)</span></p>
    </article>`).join("");
}

function yourMembersHtml() {
  const reps = myReps();
  if (!reps?.members?.length || reps.stale) return "";
  const rows = reps.members.map(m => {
    const e = index.by_member?.[m.id];
    const name = String(m.name || "").split(", ").reverse().join(" ");
    return `<li class="flex justify-between gap-3 py-1"><button type="button" data-open="member" data-id="${esc(m.id)}" class="text-accent hover:underline text-left">${esc(name)}</button>
      <span class="text-gray-600 whitespace-nowrap">${e ? `${projects(e[0])} · ${esc(money(e[1]))}` : "none requested"}</span></li>`;
  }).join("");
  return `
    <section class="mt-6 bg-surface border border-gray-200 rounded-xl p-4 max-w-2xl">
      <h3 class="font-serif text-lg font-bold text-gray-900">Your members (${esc(reps.code)})</h3>
      <ul class="mt-2 text-sm">${rows}</ul>
      <p class="text-xs text-gray-500 mt-1">Open a member to see their projects. A project several members asked for counts in full for each.</p>
    </section>`;
}

function stateListHtml() {
  if (stateError) return loadErrorHtml(`the projects for ${stateName(state)}`, stateError, "!py-6");
  if (!stateDoc) return `<p class="text-sm text-gray-500 py-4">Loading ${esc(stateName(state))}…</p>`;
  // The state doc also holds projects elsewhere requested by the state's members: the list
  // shows the projects located in the state; the others are counted below it.
  const here = { ...stateDoc, rows: stateDoc.rows.filter(r => r[4] === state) };
  const away = stateDoc.rows.length - here.rows.length;
  return `
    <input type="search" data-ep-filter value="${esc(text)}" placeholder="Search projects, places or members in ${esc(stateName(state))}"
      class="mt-3 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent" />
    <div data-ep-list>${earmarkListHtml(here, { text, limit, listKey: "page" })}</div>
    ${away ? `<p class="text-xs text-gray-500 mt-2">${esc(stateName(state))}'s members also asked for ${projects(away)} located in other states (projects shared across state lines, or in DC). They're on each member's page.</p>` : ""}`;
}

function render() {
  const el = container();
  if (!index) return;
  const pub = index.tables.filter(t => t.published);
  const st = index.by_state?.[state];
  const states = Object.keys(STATE_NAMES).filter(s => index.by_state?.[s]).sort((a, b) => stateName(a).localeCompare(stateName(b)));
  el.innerHTML = `
    <h2 class="font-serif text-2xl font-bold text-gray-900">Earmarks</h2>
    <p class="text-gray-600 mt-1 max-w-3xl">Projects members of Congress ask for by name, with a specific recipient and amount: "Community Project Funding" in the House, "Congressionally Directed Spending" in the Senate. Each is published with the names of the members who asked for it.</p>
    <p class="mt-4 text-gray-800">Fiscal year ${FY}: <strong>${projects(index.totals.count)}</strong>, ${esc(money(index.totals.total))}, in ${new Set(pub.map(t => t.bill_id)).size} spending laws.</p>

    <h3 class="font-serif text-xl font-bold text-gray-900 mt-8">By spending law</h3>
    <div class="grid gap-3 md:grid-cols-2 mt-3">${lawsHtml()}</div>

    ${yourMembersHtml()}

    <h3 class="font-serif text-xl font-bold text-gray-900 mt-8">By state</h3>
    <div class="mt-2 flex flex-wrap items-center gap-3">
      <label for="ep-state" class="text-sm text-gray-600">Projects located in</label>
      <select id="ep-state" data-ep-state class="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-surface">
        ${states.map(s => `<option value="${esc(s)}"${s === state ? " selected" : ""}>${esc(stateName(s))}</option>`).join("")}
      </select>
      ${st ? `<span class="text-sm text-gray-600">${projects(st[0])} · ${esc(money(st[1]))}</span>` : ""}
    </div>
    <div class="max-w-3xl">${stateListHtml()}</div>

    <p class="text-xs text-gray-500 mt-8 max-w-3xl">From the tables in each spending law's explanatory statement (Congressional Record). Every table is checked against the law's own amounts or other official figures before it's shown; ${index.tables.some(t => !t.published) ? "a table that didn't add up isn't shown. " : ""}<a href="#methodology" class="text-accent hover:underline">How we count</a></p>`;
}

async function loadState() {
  const mine = ++request;
  stateDoc = null; stateError = null; text = ""; limit = LIST_STEP;
  store.set("cw-state", state);
  render();
  try {
    const doc = await loadEarmarkList(`${FY}:state:${state}`);
    if (mine !== request) return;
    stateDoc = doc || { rows: [], accounts: [], people: {} };
  } catch (err) {
    if (mine !== request) return;
    stateError = err;
  }
  render();
}

export async function loadEarmarksPage() {
  const el = container();
  if (!state) state = STATE_NAMES[store.get("cw-state", "")] ? store.get("cw-state", "") : DEFAULT_STATE;
  if (index) { if (!stateDoc && !stateError) loadState(); return; }
  el.innerHTML = `<p class="text-gray-500 py-12 text-center">Loading earmarks…</p>`;
  try {
    index = await getEarmarkIndex(FY);
  } catch (err) {
    el.innerHTML = loadErrorHtml("the earmarks", err);
    return;
  }
  render();
  loadState();
}

export function setupEarmarksPage() {
  const el = container();
  el.addEventListener("change", ev => {
    if (!ev.target.matches("[data-ep-state]")) return;
    state = ev.target.value;
    replaceTab("earmarks");
    loadState();
  });
  el.addEventListener("input", ev => {
    if (!ev.target.matches("[data-ep-filter]")) return;
    text = ev.target.value; limit = LIST_STEP;
    const here = { ...stateDoc, rows: stateDoc.rows.filter(r => r[4] === state) };
    el.querySelector("[data-ep-list]").innerHTML = earmarkListHtml(here, { text, limit, listKey: "page" });
  });
  el.addEventListener("click", ev => {
    if (!ev.target.closest('[data-earmark-more="page"]')) return;
    limit += LIST_STEP;
    const here = { ...stateDoc, rows: stateDoc.rows.filter(r => r[4] === state) };
    el.querySelector("[data-ep-list]").innerHTML = earmarkListHtml(here, { text, limit, listKey: "page" });
  });
}
