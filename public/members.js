// Legislators tab (directory doc + filters) and the header count cards.
import { DELEGATE_JURISDICTIONS, STATES } from "./states.js";
import { collection, doc, getCountFromServer, getDoc, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { db, getOverviewDoc, memberById } from "./data.js";
import { PARTY_ABBR, PARTY_BADGES, STATE_NAMES, escapeHtml, isDelegate } from "./util.js";
import { activeTab, switchTab } from "./tabs.js";
import { replaceTab } from "./router.js";

const membersContainer = document.getElementById("members-container");
const stateSelect = document.getElementById("state-select");

// --- Members (schema written by netlify/functions/ingest-votes.js) ---

export const DEFAULT_STATE = "WA";

export function populateStateSelect() {
  if (!stateSelect) return;
  const options = list => list.map(([code, name]) =>
    `<option value="${code}"${code === DEFAULT_STATE ? " selected" : ""}>${escapeHtml(name)} (${code})</option>`).join("");
  stateSelect.innerHTML = `
    <option value="">All states and territories</option>
    <optgroup label="States">${options(STATES)}</optgroup>
    <optgroup label="Non-voting delegates">${options(DELEGATE_JURISDICTIONS)}</optgroup>
  `;
}

// Senators first, then representatives by district.
function memberSortKey(m) {
  return [m.chamber === "Senate" ? 0 : 1, Number(m.district) || 0, m.name || ""];
}

function compareMembers(a, b) {
  const ka = memberSortKey(a), kb = memberSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

export function memberRole(m) {
  if (m.chamber === "Senate") return "Senator";
  if (m.chamber === "House") {
    if (DELEGATE_JURISDICTIONS.some(([code]) => code === m.state)) {
      return m.state === "PR" ? "Resident Commissioner" : "Delegate";
    }
    // Congress.gov leaves district empty (or 0) for at-large seats.
    return m.district ? `Representative, District ${m.district}` : "Representative, At-large";
  }
  return m.chamber || "Chamber not available";
}

export function memberPhoto(m) {
  if (!m.imageUrl) {
    return `<div class="w-16 h-20 rounded-lg bg-gray-100 border flex items-center justify-center text-xs text-gray-400 shrink-0">No photo</div>`;
  }
  return `<img src="${escapeHtml(m.imageUrl)}" alt="${escapeHtml(m.name || "")}" loading="lazy"
    class="w-16 h-20 object-cover rounded-lg bg-gray-100 border shrink-0"
    onerror="this.replaceWith(Object.assign(document.createElement('div'), {className: 'w-16 h-20 rounded-lg bg-gray-100 border shrink-0'}))" />`;
}

// --- Directory: all current members from one `directory/members` doc ----------
// (written by ingest-votes.js; ~100 KB, so search + filters run client-side with a
// single read). If that doc can't be read, fall back to a per-state query.

const MEMBERS_PAGE = 48;
const memberFilters = { text: "", state: DEFAULT_STATE, party: "", chamber: "" };
let membersShown = MEMBERS_PAGE;
let directoryPromise = null;
let directoryFallbackRequest = 0;

function loadDirectory() {
  directoryPromise ??= getDoc(doc(db, "directory", "members")).then(snap => {
    if (!snap.exists()) throw new Error("Directory has not been built yet.");
    const data = snap.data();
    for (const m of data.members || []) if (!memberById.has(m.id)) memberById.set(m.id, m);
    return { members: data.members || [], updatedAt: data.updatedAt?.toDate?.() || null };
  }).catch(err => { directoryPromise = null; throw err; });
  return directoryPromise;
}
const fold = str => String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// "WA-7", "wa 7", "WA-AL" -> { state: "WA", district: 7 | 0 }
function parseDistrictTerm(term) {
  const m = /^([a-z]{2})[\s-]*(\d{1,2}|al)$/i.exec(term.trim());
  if (!m || !STATE_NAMES[m[1].toUpperCase()]) return null;
  return { state: m[1].toUpperCase(), district: /al/i.test(m[2]) ? 0 : Number(m[2]) };
}

function filterMembers(members) {
  const f = memberFilters;
  const term = fold(f.text.trim());
  const district = parseDistrictTerm(f.text);
  return members.filter(m => {
    if (f.state && m.state !== f.state) return false;
    if (f.party && m.party !== f.party) return false;
    // "House" = voting representatives; "Delegates" = DC, PR and territories.
    if (f.chamber === "Senate" && m.chamber !== "Senate") return false;
    if (f.chamber === "House" && (m.chamber !== "House" || isDelegate(m))) return false;
    if (f.chamber === "Delegates" && !isDelegate(m)) return false;
    if (!term) return true;
    if (district) return m.chamber === "House" && m.state === district.state && (Number(m.district) || 0) === district.district;
    return fold(m.name).includes(term) || fold(STATE_NAMES[m.state]) === term || fold(m.state) === term;
  });
}

function sortForView(members) {
  if (memberFilters.state) return [...members].sort(compareMembers);
  return [...members].sort((a, b) =>
    (a.state || "").localeCompare(b.state || "") || compareMembers(a, b));
}

function membersSummary(shownCount, list) {
  const senators = list.filter(m => m.chamber === "Senate").length;
  const delegates = list.filter(m => m.chamber === "House" && isDelegate(m)).length;
  const reps = list.length - senators - delegates;
  const byParty = {};
  for (const m of list) if (m.party) byParty[m.party] = (byParty[m.party] || 0) + 1;
  const parts = [
    senators && `${senators} senator${senators === 1 ? "" : "s"}`,
    reps && `${reps} representative${reps === 1 ? "" : "s"}`,
    delegates && `${delegates} delegate${delegates === 1 ? "" : "s"}`,
  ].filter(Boolean).join(", ");
  const parties = Object.entries(byParty).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(" · ");
  return `Showing ${shownCount} of ${list.length} member${list.length === 1 ? "" : "s"}${parts ? ` — ${parts}` : ""}${parties ? ` · ${parties}` : ""}`;
}

function memberCard(m) {
  return `
    <button type="button" data-open="member" data-id="${escapeHtml(m.id)}" aria-label="View profile of ${escapeHtml(m.name || "member")}"
      class="member-card text-left bg-surface border border-gray-200 rounded-xl p-5 shadow-sm flex items-center gap-4 hover:shadow-md hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent transition">
      ${memberPhoto(m)}
      <div class="min-w-0">
        ${m.party ? `<span class="text-xs font-semibold px-2 py-0.5 rounded ${PARTY_BADGES[m.party] || "bg-gray-100 text-gray-800"}">${escapeHtml(m.party)}</span>` : ""}
        <h3 class="font-bold text-gray-900 text-base mt-1">${escapeHtml(m.name || "Name not available")}</h3>
        <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(memberRole(m))}${memberFilters.state ? "" : ` · ${escapeHtml(m.state || "")}`}</p>
        <p class="text-xs text-accent mt-1">View profile →</p>
      </div>
    </button>`;
}

function renderMemberList(members) {
  const summary = document.getElementById("members-summary");
  const more = document.getElementById("members-more");
  const list = sortForView(filterMembers(members));
  const shown = list.slice(0, membersShown);

  summary.textContent = list.length ? membersSummary(shown.length, list) : "";
  if (!list.length) {
    const scoped = memberFilters.state && memberFilters.text.trim();
    membersContainer.innerHTML = `
      <div class="text-center py-12">
        <p class="text-gray-500">No current members match these filters.</p>
        ${scoped ? `<button type="button" data-member-action="all-states" class="mt-3 text-sm font-semibold text-accent hover:underline">Search all states instead</button>` : ""}
      </div>`;
    more.innerHTML = "";
    return;
  }
  membersContainer.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${shown.map(memberCard).join("")}</div>`;
  more.innerHTML = list.length > shown.length
    ? `<button type="button" data-member-action="more" class="px-4 py-2 text-sm font-semibold rounded-lg bg-surface border border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm">Show ${Math.min(MEMBERS_PAGE, list.length - shown.length)} more</button>`
    : `<p class="text-xs text-gray-400">Source: Congress.gov</p>`;
}

export async function showDirectory() {
  try {
    const { members } = await loadDirectory();
    renderMemberList(members);
  } catch (err) {
    console.warn("Directory unavailable, falling back to per-state query:", err.message);
    await showStateFallback();
  }
}

// Fallback: query `members` for the selected state only (party/chamber/name
// filters still apply to that state's results).
async function showStateFallback() {
  const request = ++directoryFallbackRequest;
  const summary = document.getElementById("members-summary");
  if (!memberFilters.state) {
    membersContainer.innerHTML = `<p class="text-center text-gray-500 py-12">Nationwide search isn't available right now. Pick a state to browse its members.</p>`;
    summary.textContent = "";
    document.getElementById("members-more").innerHTML = "";
    return;
  }
  try {
    const snapshot = await getDocs(query(collection(db, "members"),
      where("state", "==", memberFilters.state), where("current", "==", true), limit(100)));
    if (request !== directoryFallbackRequest) return;
    const members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    members.forEach(m => memberById.set(m.id, m));
    renderMemberList(members);
  } catch (err) {
    if (request !== directoryFallbackRequest) return;
    console.error("Error fetching members:", err);
    membersContainer.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load members: ${escapeHtml(err.message)}</p>`;
  }
}

export function setChipGroup(groupId, attr, value) {
  document.querySelectorAll(`#${groupId} [data-${attr}]`).forEach(b => {
    const active = b.dataset[attr] === value;
    b.setAttribute("aria-pressed", String(active));
    b.className = `filter-chip px-3 py-1.5 text-xs font-semibold rounded-full transition ${active ? "bg-cta text-ink" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`;
  });
}

// URL argument for the Legislators tab (router.js): a state code or "all".
export function legislatorsArg() {
  return memberFilters.state || "all";
}

export function applyLegislatorsArg(arg) {
  const code = String(arg).toUpperCase();
  if (code === "ALL") return setMemberFilters({ state: "" });
  if (STATE_NAMES[code]) return setMemberFilters({ state: code });
}

export function setMemberFilters(changes) {
  Object.assign(memberFilters, changes);
  if (activeTab() === "members") replaceTab("members");
  membersShown = MEMBERS_PAGE;
  if (stateSelect) stateSelect.value = memberFilters.state;
  const search = document.getElementById("member-search");
  if (search && search.value !== memberFilters.text) search.value = memberFilters.text;
  setChipGroup("party-filters", "party", memberFilters.party);
  setChipGroup("chamber-filters", "chamber", memberFilters.chamber);
  showDirectory();
}

export function setupMemberFilters() {
  setChipGroup("party-filters", "party", memberFilters.party);
  setChipGroup("chamber-filters", "chamber", memberFilters.chamber);
  stateSelect?.addEventListener("change", e => setMemberFilters({ state: e.target.value }));
  let debounce;
  document.getElementById("member-search")?.addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => setMemberFilters({ text: e.target.value }), 150);
  });
  document.getElementById("party-filters")?.addEventListener("click", e => {
    const b = e.target.closest("[data-party]");
    if (b) setMemberFilters({ party: b.dataset.party });
  });
  document.getElementById("chamber-filters")?.addEventListener("click", e => {
    const b = e.target.closest("[data-chamber]");
    if (b) setMemberFilters({ chamber: b.dataset.chamber });
  });
  document.getElementById("view-members").addEventListener("click", e => {
    const action = e.target.closest("[data-member-action]")?.dataset.memberAction;
    if (action === "more") { membersShown += MEMBERS_PAGE; showDirectory(); }
    if (action === "all-states") setMemberFilters({ state: "" });
  });
}

// --- Headline counts (all computed from stored data) --------------------------

export async function loadHeadlineStats() {
  const el = document.getElementById("headline-stats");
  if (!el) return;
  // Normally all from stats/overview `headline` (rebuilt nightly; already read for the
  // Overview tab). Older stats docs without it: directory doc + count queries.
  const h = await getOverviewDoc().then(s => s.data()?.headline).catch(() => null);
  const [dir, bills, votes] = h
    ? [{ status: "rejected" }, { status: "rejected" }, { status: "rejected" }]
    : await Promise.allSettled([
        loadDirectory(),
        getCountFromServer(collection(db, "bills")),
        getCountFromServer(collection(db, "votes")),
      ]);

  const split = counts => Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${n} ${PARTY_ABBR[p] || p}`).join(" · ");
  const seat = list => ({ count: list.length, parties: list.reduce((c, m) => ({ ...c, [m.party || "?"]: (c[m.party || "?"] || 0) + 1 }), {}) });
  let seats = h;
  if (!h && dir.status === "fulfilled") {
    const all = dir.value.members;
    seats = {
      senate: seat(all.filter(m => m.chamber === "Senate")),
      house: seat(all.filter(m => m.chamber === "House" && !isDelegate(m))),
      delegates: seat(all.filter(m => m.chamber === "House" && isDelegate(m))),
    };
  }
  const billCount = h ? h.bills : bills.status === "fulfilled" ? bills.value.data().count : null;
  const voteCount = h ? h.votes : votes.status === "fulfilled" ? votes.value.data().count : null;
  const card = (value, label, detail, action) => `
    <${action ? `button type="button" data-headline="${action}"` : "div"}
      class="flex flex-col items-start justify-start text-left bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3${action ? " hover:bg-white/10 hover:border-pink/60 focus:outline-none focus:ring-2 focus:ring-pink transition" : ""}">
      <p class="font-serif text-xl sm:text-3xl font-bold text-white tabular-nums">${escapeHtml(String(value))}</p>
      <p class="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-pink leading-tight">${escapeHtml(label)}</p>
      ${detail ? `<p class="hidden sm:block text-xs text-gray-600 mt-1">${escapeHtml(detail)}</p>` : ""}
    </${action ? "button" : "div"}>`;

  const cards = [];
  if (seats) {
    const { senate, house, delegates } = seats;
    cards.push(card(senate.count, "Senators", split(senate.parties), "Senate"));
    cards.push(card(house.count, "Representatives", `${house.count < 435 ? `${435 - house.count} of 435 seats vacant · ` : ""}${split(house.parties)}`, "House"));
    cards.push(card(delegates.count, "Delegates", "Non-voting: DC, PR and territories", "Delegates"));
  }
  if (billCount != null) cards.push(card(billCount, "Bills tracked", "Synced from Congress.gov"));
  if (voteCount != null) cards.push(card(voteCount, "Roll-call votes", "House + Senate, synced"));
  el.innerHTML = cards.join("");
  if (!el.dataset.wired) {
    el.dataset.wired = "1";
    el.addEventListener("click", e => {
      const action = e.target.closest("[data-headline]")?.dataset.headline;
      if (!action) return;
      switchTab("members");
      setMemberFilters({ state: "", chamber: action, party: "", text: "" });
    });
  }
}
