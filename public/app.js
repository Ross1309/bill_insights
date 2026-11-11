import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, getCountFromServer, query, where, limit, orderBy, startAfter } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { STATES, DELEGATE_JURISDICTIONS } from "./states.js";

const firebaseConfig = {
    apiKey: "AIzaSyB53n86BTG9co1S8Ek0Acvx4onbzvXQD8Y",
    authDomain: "congress-watcher-b0dd3.firebaseapp.com",
    projectId: "congress-watcher-b0dd3",
    storageBucket: "congress-watcher-b0dd3.firebasestorage.app",
    messagingSenderId: "775303136240",
    appId: "1:775303136240:web:ab13bd736700a29cfe5335"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// DOM Elements
const billsContainer = document.getElementById("bills-container");
const billsMore = document.getElementById("bills-more");
const votesContainer = document.getElementById("votes-container");
const membersContainer = document.getElementById("members-container");
const searchInput = document.getElementById("search-input");
const stateSelect = document.getElementById("state-select");

// Tab Navigation Elements
const navBills = document.getElementById("nav-bills");
const navVotes = document.getElementById("nav-votes");
const navMembers = document.getElementById("nav-members");

const viewBills = document.getElementById("view-bills");
const viewVotes = document.getElementById("view-votes");
const viewMembers = document.getElementById("view-members");

// Bills loaded for the active category, newest update first (one or more pages).
let allBills = [];
// Every bill seen this session, by id (used to label votes with bill titles).
const billCache = new Map();
let votesLoaded = false;
let activeCategory = "all";

async function init() {
  populateStateSelect();
  setupTabs();
  switchTab("bills");
  setupMemberFilters();
  setupBillFilters();
  setupModals();
  loadHeadlineStats();
  await loadBills({ reset: true });
}

function setupTabs() {
  navBills.addEventListener("click", () => switchTab("bills"));
  navVotes.addEventListener("click", () => switchTab("votes"));
  navMembers.addEventListener("click", () => {
    switchTab("members");
    showDirectory();
  });
}

const TAB_BASE = "nav-tab py-3.5 text-sm sm:text-base font-semibold whitespace-nowrap border-b-2 focus:outline-none focus-visible:text-brand-900";
const TAB_ACTIVE = `${TAB_BASE} text-brand-900 border-gold-500`;
const TAB_IDLE = `${TAB_BASE} text-gray-500 border-transparent hover:text-gray-800`;

function switchTab(tabName) {
  const tabs = { bills: [navBills, viewBills], votes: [navVotes, viewVotes], members: [navMembers, viewMembers] };
  for (const [name, [nav, view]] of Object.entries(tabs)) {
    const active = name === tabName;
    nav.className = active ? TAB_ACTIVE : TAB_IDLE;
    nav.setAttribute("aria-selected", String(active));
    view.classList.toggle("hidden", !active);
  }
  if (tabName === "votes" && !votesLoaded) fetchVotes();
  // If the sticky tab bar is pinned (scrolled past the header), start the new tab
  // at its top instead of mid-way down.
  // (The bar sits right under the header, so the header's height is where it pins.)
  const barTop = document.querySelector("body > header")?.offsetHeight || 0;
  if (window.scrollY > barTop) window.scrollTo({ top: barTop });
}

// --- Bills: server-side ordering + cursor pagination ---

const BILLS_PAGE_SIZE = 12;
let billsCursor = null;     // last doc of the most recent page
let billsExhausted = false;
let billsLoading = false;
let billsGeneration = 0;    // bumps on category change so stale pages are dropped
let billsError = null;      // message shown instead of bills until the next reset

function rememberBills(bills) {
  for (const bill of bills) billCache.set(bill.id, bill);
}

async function loadBills({ reset = false } = {}) {
  if (reset) {
    billsGeneration++;
    allBills = [];
    billsCursor = null;
    billsExhausted = false;
    billsLoading = false;
    billsError = null;
    billsContainer.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-brand-600 border-t-transparent mb-4"></div>
        <p class="text-gray-500">Loading bills...</p>
      </div>`;
    billsMore.innerHTML = "";
  }
  if (billsLoading || billsExhausted) return;

  const generation = billsGeneration;
  billsLoading = true;
  renderLoadMore();

  try {
    // Category filtering happens in the query so every page is full; this
    // needs the (category ASC, update_date DESC) index in firestore.indexes.json.
    const constraints = [];
    if (activeCategory !== "all") constraints.push(where("category", "==", activeCategory));
    constraints.push(orderBy("update_date", "desc"));
    if (billsCursor) constraints.push(startAfter(billsCursor));
    constraints.push(limit(BILLS_PAGE_SIZE));

    const snapshot = await getDocs(query(collection(db, "bills"), ...constraints));
    if (generation !== billsGeneration) return;

    const page = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    rememberBills(page);
    allBills.push(...page);
    billsCursor = snapshot.docs.at(-1) || billsCursor;
    billsExhausted = snapshot.docs.length < BILLS_PAGE_SIZE;
    billsLoading = false;
    applyBillFilters();
  } catch (err) {
    if (generation !== billsGeneration) return;
    billsLoading = false;
    console.error("Error fetching bills:", err);
    billsError = err.code === "failed-precondition" && activeCategory !== "all"
      ? "Category filtering isn't available yet: the Firestore index in firestore.indexes.json hasn't been created."
      : `Failed to load bills: ${err.message}`;
    applyBillFilters();
  }
}

function renderLoadMore() {
  if (billsExhausted && !billsLoading) {
    billsMore.innerHTML = allBills.length
      ? `<p class="text-xs text-gray-400">All ${allBills.length} bills loaded.</p>`
      : "";
    return;
  }
  billsMore.innerHTML = `
    <button id="bills-load-more" ${billsLoading ? "disabled" : ""}
      class="px-4 py-2 text-sm font-semibold rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 shadow-sm">
      ${billsLoading ? "Loading…" : "Load more bills"}
    </button>`;
  document.getElementById("bills-load-more").addEventListener("click", () => loadBills());
}

// --- Bill field helpers (schema written by netlify/functions/sync-votes.js) ---

function billLabel(bill) {
  if (bill.bill_number) return bill.bill_number;
  if (bill.type || bill.number) return `${bill.type || ''} ${bill.number || ''}`.trim();
  return 'BILL';
}

const SUMMARY_SOURCE_LABELS = {
  crs_summary: 'AI summary of the official CRS summary',
  title_only: 'AI summary from the title only — no official summary yet',
};

function renderSummary(bill) {
  const points = bill.ai_summary?.bullet_points;
  if (!points || points.length === 0) {
    return `<p class="text-gray-500 text-sm italic">Summary pending.</p>`;
  }
  const label = SUMMARY_SOURCE_LABELS[bill.ai_summary.source] || 'AI-generated summary';
  return `
    <ul class="list-disc pl-5 space-y-1 text-gray-600 text-sm">
      ${points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
    </ul>
    <p class="text-[11px] text-gray-400 mt-2">${escapeHtml(label)}</p>
  `;
}

function renderBills(bills, term = "") {
  const scopeNote = term && !billsExhausted
    ? `<p class="text-xs text-gray-400 mb-4">Searching the ${allBills.length} bills loaded so far (bill numbers are searched across all bills). Load more to search further.</p>`
    : "";
  if (bills.length === 0) {
    billsContainer.innerHTML = scopeNote + `<p class="text-center text-gray-500 py-12">${allBills.length ? "No matching bills found." : "No bills found."}</p>`;
    return;
  }

  billsContainer.innerHTML = scopeNote + `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ${bills.map(bill => `
        <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span class="bg-brand-50 text-brand-700 font-semibold ring-1 ring-brand-100 px-2 py-0.5 rounded uppercase">${escapeHtml(billLabel(bill))}</span>
              <span>${escapeHtml(String(bill.congress || ''))}${bill.congress ? 'th Congress' : ''}</span>
            </div>
            ${bill.policy_area ? `<p class="text-xs font-medium text-gray-500 mb-2">${escapeHtml(bill.policy_area)}</p>` : ''}
            <h3 class="font-serif font-bold text-gray-900 text-xl leading-snug mb-3"><button type="button" data-open="bill" data-id="${escapeHtml(bill.id)}" class="text-left hover:text-brand-900 hover:underline">${escapeHtml(bill.title || 'Untitled Bill')}</button></h3>
            ${renderSummary(bill)}
          </div>
          <div class="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-1">
            ${bill.latestAction?.text ? `<p><strong class="text-gray-700">Latest action${bill.latestAction.actionDate ? ` (${escapeHtml(bill.latestAction.actionDate)})` : ''}:</strong> ${escapeHtml(bill.latestAction.text)}</p>` : ''}
            <div class="flex flex-wrap gap-4 pt-1">
              <button type="button" data-open="bill" data-id="${escapeHtml(bill.id)}" class="font-semibold text-brand-700 hover:underline">Details, actions &amp; votes →</button>
              ${bill.congress_gov_url ? `<a href="${escapeHtml(bill.congress_gov_url)}" target="_blank" rel="noopener" class="text-brand-700 hover:underline">Congress.gov →</a>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// --- Roll-call votes (schema written by netlify/functions/ingest-votes.js) ---

// Most recent synced roll-call votes, shared by the Votes tab and member profiles.
const RECENT_VOTES_LIMIT = 50;
let recentVotesPromise = null;

function getRecentVotes() {
  recentVotesPromise ??= getDocs(query(collection(db, "votes"), orderBy("date", "desc"), limit(RECENT_VOTES_LIMIT)))
    .then(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    .catch(err => { recentVotesPromise = null; throw err; });
  return recentVotesPromise;
}

async function fetchVotes() {
  try {
    const votes = await getRecentVotes();
    votesLoaded = true;
    renderVotes(votes);
  } catch (err) {
    console.error("Error fetching votes:", err);
    votesContainer.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load votes: ${escapeHtml(err.message)}</p>`;
  }
}

const BILL_TYPE_SLUGS = {
  hr: "house-bill", s: "senate-bill", hres: "house-resolution", sres: "senate-resolution",
  hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution",
};

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

// Link a vote to its bill: our own bill card data when we have it,
// otherwise straight to Congress.gov.
function voteBillInfo(vote) {
  if (!vote.bill_id) return null;
  const bill = billCache.get(vote.bill_id);
  const m = /^([a-z]+)(\d+)-(\d+)$/.exec(vote.bill_id);
  const fallbackUrl = m && BILL_TYPE_SLUGS[m[1]]
    ? `https://www.congress.gov/bill/${ordinal(Number(m[3]))}-congress/${BILL_TYPE_SLUGS[m[1]]}/${m[2]}`
    : null;
  return {
    label: bill ? billLabel(bill) : (vote.legislation || vote.bill_id),
    title: bill?.title || null,
    url: bill?.congress_gov_url || fallbackUrl,
  };
}

const POSITION_GROUPS = { yea: "yea", aye: "yea", nay: "nay", no: "nay", present: "present", "not voting": "not_voting" };
const PARTY_NAMES = { R: "Republican", D: "Democratic", I: "Independent" };

function partyBreakdown(individualVotes = []) {
  const byParty = {};
  for (const v of individualVotes) {
    const party = v.party || "?";
    const group = POSITION_GROUPS[(v.position || "").toLowerCase()] || "other";
    byParty[party] ??= { yea: 0, nay: 0, present: 0, not_voting: 0, other: 0 };
    byParty[party][group]++;
  }
  // Largest caucus first
  return Object.entries(byParty).sort((a, b) =>
    Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0));
}

function formatVoteDate(iso) {
  if (!iso) return "Date not available";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function resultBadgeClass(result) {
  const r = (result || "").toLowerCase();
  if (/(passed|agreed|adopted)/.test(r)) return "bg-green-100 text-green-800";
  if (/(failed|rejected|not agreed)/.test(r)) return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-700";
}

function voteTalliesHtml(vote) {
  const t = vote.tallies || {};
  const parties = partyBreakdown(vote.individual_votes);
  const tally = (label, value, cls) => `
    <div class="${cls} p-3 rounded-lg border text-center">
      <p class="text-xs font-semibold uppercase">${label}</p>
      <p class="text-xl font-bold">${Number.isFinite(value) ? value : "—"}</p>
    </div>`;
  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
      ${tally("Yea", t.yea, "bg-green-50 border-green-100 text-green-700")}
      ${tally("Nay", t.nay, "bg-red-50 border-red-100 text-red-700")}
      ${tally("Present", t.present, "bg-gray-50 border-gray-200 text-gray-700")}
      ${tally("Not voting", t.not_voting, "bg-gray-50 border-gray-200 text-gray-700")}
    </div>
    ${parties.length ? `
      <table class="w-full text-sm text-left">
        <thead class="text-xs text-gray-500 uppercase">
          <tr><th class="py-1 font-semibold">Party</th><th class="py-1 font-semibold text-right">Yea</th><th class="py-1 font-semibold text-right">Nay</th><th class="py-1 font-semibold text-right">Present</th><th class="py-1 font-semibold text-right">Not voting</th></tr>
        </thead>
        <tbody class="text-gray-700">
          ${parties.map(([party, c]) => `
            <tr class="border-t border-gray-100">
              <td class="py-1">${escapeHtml(PARTY_NAMES[party] || party)}</td>
              <td class="py-1 text-right">${c.yea}</td><td class="py-1 text-right">${c.nay}</td>
              <td class="py-1 text-right">${c.present}</td><td class="py-1 text-right">${c.not_voting}</td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p class="text-xs text-gray-400">Member-level votes not available.</p>`}`;
}

// Bill reference for a vote: opens the bill modal (which also links out).
function voteBillLine(vote) {
  const bill = voteBillInfo(vote);
  if (!bill) return `<p class="text-sm text-gray-400 mt-1">No bill associated with this vote</p>`;
  return `
    <p class="text-sm text-gray-600 mt-1">
      <button type="button" data-open="bill" data-id="${escapeHtml(vote.bill_id)}" class="font-semibold text-brand-700 hover:underline">${escapeHtml(bill.label)}</button>
      ${bill.title ? ` — ${escapeHtml(bill.title)}` : ""}
    </p>`;
}

function voteHeadingBadge(vote) {
  return `${escapeHtml(vote.chamber || "House")} Roll Call #${escapeHtml(String(vote.roll_call_number ?? "?"))}${vote.session ? ` · Session ${escapeHtml(String(vote.session))}` : ""}`;
}

function renderVotes(votes) {
  if (votes.length === 0) {
    votesContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No roll-call votes have been synced yet.</p>`;
    return;
  }

  votesContainer.innerHTML = `
    <div class="space-y-6">
      ${votes.map(vote => `
        <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-gray-100">
            <div>
              <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gold-50 text-gold-800 ring-1 ring-gold-200 uppercase">${voteHeadingBadge(vote)}</span>
              <h3 class="font-serif font-bold text-gray-900 text-xl mt-2">${escapeHtml(vote.question || "Question not available")}</h3>
              ${voteBillLine(vote)}
              ${vote.vote_type ? `<p class="text-xs text-gray-400 mt-1">${escapeHtml(vote.vote_type)}</p>` : ""}
            </div>
            <div class="sm:text-right shrink-0">
              <span class="inline-block px-3 py-1 text-xs font-bold rounded ${resultBadgeClass(vote.result)}">${escapeHtml(vote.result || "Result pending")}</span>
              <p class="text-xs text-gray-400 mt-1">${escapeHtml(formatVoteDate(vote.date))}</p>
            </div>
          </div>
          ${voteTalliesHtml(vote)}
          <div class="flex flex-wrap items-center gap-4 mt-3 text-xs">
            ${vote.individual_votes?.length ? `<button type="button" data-open="vote" data-id="${escapeHtml(vote.id)}" class="font-semibold text-brand-700 hover:underline">How each member voted →</button>` : ""}
            ${vote.source_url ? `<a href="${escapeHtml(vote.source_url)}" target="_blank" rel="noopener" class="text-brand-700 hover:underline">Official record (House Clerk) →</a>` : ""}
          </div>
        </div>`).join("")}
    </div>
  `;
}

// --- Members (schema written by netlify/functions/ingest-votes.js) ---

const DEFAULT_STATE = "WA";
const STATE_NAMES = Object.fromEntries([...STATES, ...DELEGATE_JURISDICTIONS]);
let membersRequest = 0;

function populateStateSelect() {
  if (!stateSelect) return;
  const options = list => list.map(([code, name]) =>
    `<option value="${code}"${code === DEFAULT_STATE ? " selected" : ""}>${escapeHtml(name)} (${code})</option>`).join("");
  stateSelect.innerHTML = `
    <option value="">All states and territories</option>
    <optgroup label="States">${options(STATES)}</optgroup>
    <optgroup label="Non-voting delegates">${options(DELEGATE_JURISDICTIONS)}</optgroup>
  `;
}

const PARTY_BADGES = {
  Democratic: "bg-blue-100 text-blue-800",
  Republican: "bg-red-100 text-red-800",
};

// Senators first, then representatives by district.
function memberSortKey(m) {
  return [m.chamber === "Senate" ? 0 : 1, Number(m.district) || 0, m.name || ""];
}

function compareMembers(a, b) {
  const ka = memberSortKey(a), kb = memberSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

function memberRole(m) {
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

function memberPhoto(m) {
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
const PARTY_ABBR = { Democratic: "D", Republican: "R", Independent: "I" };

function loadDirectory() {
  directoryPromise ??= getDoc(doc(db, "directory", "members")).then(snap => {
    if (!snap.exists()) throw new Error("Directory has not been built yet.");
    const data = snap.data();
    for (const m of data.members || []) if (!memberById.has(m.id)) memberById.set(m.id, m);
    return { members: data.members || [], updatedAt: data.updatedAt?.toDate?.() || null };
  }).catch(err => { directoryPromise = null; throw err; });
  return directoryPromise;
}

const isDelegate = m => DELEGATE_JURISDICTIONS.some(([code]) => code === m.state);
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
      class="member-card text-left bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex items-center gap-4 hover:shadow-md hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500 transition">
      ${memberPhoto(m)}
      <div class="min-w-0">
        ${m.party ? `<span class="text-xs font-semibold px-2 py-0.5 rounded ${PARTY_BADGES[m.party] || "bg-gray-100 text-gray-800"}">${escapeHtml(m.party)}</span>` : ""}
        <h3 class="font-bold text-gray-900 text-base mt-1">${escapeHtml(m.name || "Name not available")}</h3>
        <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(memberRole(m))}${memberFilters.state ? "" : ` · ${escapeHtml(m.state || "")}`}</p>
        <p class="text-xs text-brand-700 mt-1">View profile →</p>
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
        ${scoped ? `<button type="button" data-member-action="all-states" class="mt-3 text-sm font-semibold text-brand-700 hover:underline">Search all states instead</button>` : ""}
      </div>`;
    more.innerHTML = "";
    return;
  }
  membersContainer.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">${shown.map(memberCard).join("")}</div>`;
  more.innerHTML = list.length > shown.length
    ? `<button type="button" data-member-action="more" class="px-4 py-2 text-sm font-semibold rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 shadow-sm">Show ${Math.min(MEMBERS_PAGE, list.length - shown.length)} more</button>`
    : `<p class="text-xs text-gray-400">Source: Congress.gov</p>`;
}

async function showDirectory() {
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

function setChipGroup(groupId, attr, value) {
  document.querySelectorAll(`#${groupId} [data-${attr}]`).forEach(b => {
    const active = b.dataset[attr] === value;
    b.setAttribute("aria-pressed", String(active));
    b.className = `filter-chip px-3 py-1.5 text-xs font-semibold rounded-full transition ${active ? "bg-brand-800 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`;
  });
}

function setMemberFilters(changes) {
  Object.assign(memberFilters, changes);
  membersShown = MEMBERS_PAGE;
  if (stateSelect) stateSelect.value = memberFilters.state;
  const search = document.getElementById("member-search");
  if (search && search.value !== memberFilters.text) search.value = memberFilters.text;
  setChipGroup("party-filters", "party", memberFilters.party);
  setChipGroup("chamber-filters", "chamber", memberFilters.chamber);
  showDirectory();
}

function setupMemberFilters() {
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

async function loadHeadlineStats() {
  const el = document.getElementById("headline-stats");
  if (!el) return;
  const [dir, bills, votes] = await Promise.allSettled([
    loadDirectory(),
    getCountFromServer(collection(db, "bills")),
    getCountFromServer(collection(db, "votes")),
  ]);

  const split = list => {
    const c = {};
    for (const m of list) c[PARTY_ABBR[m.party] || m.party || "?"] = (c[PARTY_ABBR[m.party] || m.party || "?"] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${n} ${p}`).join(" · ");
  };
  const card = (value, label, detail, action) => `
    <${action ? `button type="button" data-headline="${action}"` : "div"}
      class="flex flex-col items-start justify-start text-left bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3${action ? " hover:bg-white/10 hover:border-gold-400/60 focus:outline-none focus:ring-2 focus:ring-gold-400 transition" : ""}">
      <p class="font-serif text-xl sm:text-3xl font-bold text-white tabular-nums">${escapeHtml(String(value))}</p>
      <p class="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gold-300 leading-tight">${escapeHtml(label)}</p>
      ${detail ? `<p class="hidden sm:block text-xs text-brand-200 mt-1">${escapeHtml(detail)}</p>` : ""}
    </${action ? "button" : "div"}>`;

  const cards = [];
  if (dir.status === "fulfilled") {
    const all = dir.value.members;
    const senate = all.filter(m => m.chamber === "Senate");
    const house = all.filter(m => m.chamber === "House" && !isDelegate(m));
    const delegates = all.filter(m => m.chamber === "House" && isDelegate(m));
    cards.push(card(senate.length, "Senators", split(senate), "Senate"));
    cards.push(card(house.length, "Representatives", `${house.length < 435 ? `${435 - house.length} of 435 seats vacant · ` : ""}${split(house)}`, "House"));
    cards.push(card(delegates.length, "Delegates", "Non-voting: DC, PR and territories", "Delegates"));
  }
  if (bills.status === "fulfilled") cards.push(card(bills.value.data().count, "Bills tracked", "Synced from Congress.gov"));
  if (votes.status === "fulfilled") cards.push(card(votes.value.data().count, "Roll-call votes", "House votes synced"));
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

// --- Detail modals: member / bill / vote -------------------------------------
// One modal shell with a stack, so you can go vote -> member -> bill and back.
// Anything with data-open="member|bill|vote" data-id="…" opens one.
// Server data (Congress.gov via Netlify functions) is optional: if it fails, the
// modal still shows what's in Firestore plus a Retry button.

const memberById = new Map();
const modalRoot = document.getElementById("modal-root");
const POSITION_BADGES = {
  yea: "bg-green-100 text-green-800", nay: "bg-red-100 text-red-800",
  present: "bg-gray-100 text-gray-700", not_voting: "bg-yellow-50 text-yellow-800",
};
const functionCache = new Map();
let modalStack = []; // entries: { kind, id, tab, data: {}, errors: {}, filter: {} }
let lastFocused = null;

function fetchFunction(name, id) {
  const key = `${name}:${id}`;
  if (!functionCache.has(key)) {
    functionCache.set(key, fetch(`/.netlify/functions/${name}?id=${encodeURIComponent(id)}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body;
      })
      .catch(err => { functionCache.delete(key); throw err; }));
  }
  return functionCache.get(key);
}

async function getFirestoreDoc(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function getMember(id) {
  if (memberById.has(id)) return memberById.get(id);
  const m = await getFirestoreDoc("members", id);
  if (m) memberById.set(id, m);
  return m;
}

async function getBill(id) {
  if (billCache.has(id)) return billCache.get(id);
  const b = await getFirestoreDoc("bills", id);
  if (b) billCache.set(id, b);
  return b;
}

async function getVote(id) {
  const recent = await getRecentVotes().catch(() => []);
  return recent.find(v => v.id === id) || getFirestoreDoc("votes", id);
}

async function getVotesForBill(billId) {
  const snap = await getDocs(query(collection(db, "votes"), where("bill_id", "==", billId), limit(50)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

// Vote doc id for an action's recorded House vote, matching ingest-votes.js.
function houseVoteId(rv) {
  if (rv.chamber !== "House" || !rv.congress || !rv.session || !rv.rollNumber) return null;
  return `${rv.congress}-${rv.session}-house-vote-${rv.rollNumber}`;
}

// --- shared bits

function spinner(text) {
  return `<div class="text-center py-10"><div class="inline-block animate-spin rounded-full h-6 w-6 border-4 border-brand-600 border-t-transparent mb-3"></div><p class="text-sm text-gray-500">${escapeHtml(text)}</p></div>`;
}

function errorBlock(message, lead = "Couldn't load this from Congress.gov right now.") {
  return `
    <div class="text-center py-8">
      <p class="text-sm text-red-600">${escapeHtml(lead)}</p>
      <p class="text-xs text-gray-400 mt-1">${escapeHtml(message)}</p>
      <button type="button" data-retry class="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-800 text-white hover:bg-brand-900">Retry</button>
    </div>`;
}

function factList(facts) {
  return `<dl>${facts.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v, raw]) =>
    `<div class="flex gap-3 py-1.5 border-b border-gray-100 text-sm"><dt class="w-36 shrink-0 text-gray-500">${escapeHtml(k)}</dt><dd class="text-gray-900 min-w-0">${raw ? v : escapeHtml(String(v))}</dd></div>`).join("")}</dl>`;
}

function memberLink(id, label) {
  return id
    ? `<button type="button" data-open="member" data-id="${escapeHtml(id)}" class="text-brand-700 hover:underline text-left">${escapeHtml(label)}</button>`
    : escapeHtml(label);
}

function externalLink(url, label) {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-brand-700 hover:underline">${escapeHtml(label)} →</a>` : "";
}

// --- member

// For each synced vote this member took part in: their position, and whether
// it matched the majority of their party's Yea/Nay votes on that roll call.
function memberVotingRecord(bioguideId, votes) {
  const rows = [];
  const counts = { yea: 0, nay: 0, present: 0, not_voting: 0 };
  let withParty = 0, partyComparable = 0;

  for (const vote of votes) {
    const own = (vote.individual_votes || []).find(v => v.bioguideId === bioguideId);
    if (!own) continue;
    const group = POSITION_GROUPS[(own.position || "").toLowerCase()] || null;
    if (group) counts[group]++;

    let partyMajority = null;
    if (own.party && own.party !== "I" && (group === "yea" || group === "nay")) {
      let y = 0, n = 0;
      for (const v of vote.individual_votes) {
        if (v.party !== own.party) continue;
        const g = POSITION_GROUPS[(v.position || "").toLowerCase()];
        if (g === "yea") y++; else if (g === "nay") n++;
      }
      if (y !== n) {
        partyMajority = y > n ? "yea" : "nay";
        partyComparable++;
        if (partyMajority === group) withParty++;
      }
    }
    rows.push({ vote, position: own.position || null, group, partyMajority });
  }
  return { rows, counts, withParty, partyComparable };
}

// --- campaign finance (FEC) helpers

const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const usdExact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = v => (typeof v === "number" ? usdCompact.format(v) : "—");
const moneyExact = v => (typeof v === "number" ? usdExact.format(v) : "not reported");
const SIZE_LABELS = { 0: "$200 and under", 200: "$200.01 – $499.99", 500: "$500 – $999.99", 1000: "$1,000 – $1,999.99", 2000: "$2,000 and over" };

function formatDay(iso) {
  if (!iso) return "?";
  const d = new Date(`${iso}T12:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

// One-hue horizontal bars, each a share of `total`; amounts as text, exact on hover.
function shareBars(rows, total) {
  return rows.map(({ label, value }) => {
    const pct = total > 0 && value > 0 ? (value / total) * 100 : 0;
    const pctText = pct >= 1 || pct === 0 ? `${Math.round(pct)}%` : "<1%";
    return `
      <div class="py-1.5" title="${escapeHtml(`${label}: ${moneyExact(value)}`)}">
        <div class="flex justify-between gap-3 text-sm">
          <span class="text-gray-700">${escapeHtml(label)}</span>
          <span class="text-gray-900 font-semibold tabular-nums whitespace-nowrap">${money(value)} <span class="text-gray-500 font-normal">${escapeHtml(pctText)}</span></span>
        </div>
        <div class="mt-1 h-2 rounded-full bg-gray-100" aria-hidden="true"><div class="h-2 rounded-full bg-brand-800" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  }).join("");
}

function renderFinanceTab(e) {
  if (!e.financeRequested) {
    e.financeRequested = true; // only call the FEC when this tab is opened
    loadInto(e, "finance", fetchFunction("member-finance", e.id));
  }
  if (e.errors.finance) return errorBlock(e.errors.finance, "Couldn't load campaign finance data from the FEC right now.");
  const f = e.data.finance;
  if (!f) return spinner("Loading FEC filings…");
  if (!f.available) return `<p class="text-sm text-gray-500 py-8 text-center">${escapeHtml(f.reason || "Campaign finance data isn't available for this member.")}</p>`;

  const t = f.totals;
  const tile = (label, value) => `
    <div class="bg-gray-50 border border-gray-200 rounded-lg p-3" title="${escapeHtml(moneyExact(value))}">
      <p class="text-xs text-gray-500 uppercase font-semibold">${label}</p>
      <p class="text-xl font-bold text-gray-900 tabular-nums">${money(value)}</p>
    </div>`;

  const self = (t.candidateSelf || 0) + (t.candidateLoans || 0);
  const sources = [
    { label: "Individuals, unitemized ($200 or less)", value: t.individualUnitemized },
    { label: "Individuals, itemized (over $200)", value: t.individualItemized },
    { label: "PACs and other committees", value: t.pacs },
    { label: "Party committees", value: t.partyCommittees },
    { label: "Candidate's own money (incl. loans)", value: self },
    { label: "Transfers from other authorized committees (e.g. joint fundraising)", value: t.transfersIn },
    { label: "Other receipts (dividends, interest, etc.)", value: t.otherReceipts },
    { label: "Offsets to operating expenditures", value: t.offsets },
  ];
  // Anything the FEC totals include that isn't itemized above (e.g. other loans).
  const known = sources.reduce((sum, r) => sum + (r.value || 0), 0);
  const other = (t.receipts || 0) - known;
  if (t.receipts && other / t.receipts > 0.005) sources.push({ label: "Other (loans, etc.)", value: other });
  const sourceRows = sources.filter(r => typeof r.value === "number" && r.value > 0);

  const sizes = (f.bySize || []).filter(r => typeof r.total === "number" && r.total > 0)
    .sort((a, b) => a.size - b.size);
  const sizeTotal = sizes.reduce((sum, r) => sum + r.total, 0);

  const st = f.byState;
  const home = STATE_NAMES[st?.homeState] || st?.homeState;
  const inPct = st?.itemizedTotal ? Math.round((st.inState / st.itemizedTotal) * 100) : null;

  return `
    <p class="text-xs text-gray-500">
      FEC election cycle ending ${escapeHtml(String(f.candidate.electionYear))} · reported ${escapeHtml(formatDay(f.period.start))} – ${escapeHtml(formatDay(f.period.end))}
      · ${externalLink(f.sourceUrl, "FEC filings")}
    </p>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
      ${tile("Raised", t.receipts)}
      ${tile("Spent", t.disbursements)}
      ${tile("Cash on hand", t.cashOnHand)}
      ${tile("Debts", t.debts)}
    </div>

    ${sourceRows.length ? `
      <section class="mt-5">
        <h3 class="text-sm font-bold text-gray-900">Where the money came from</h3>
        <p class="text-xs text-gray-500">Share of ${escapeHtml(money(t.receipts))} total receipts.</p>
        <div class="mt-2">${shareBars(sourceRows, t.receipts)}</div>
      </section>` : ""}

    ${sizes.length ? `
      <section class="mt-5">
        <h3 class="text-sm font-bold text-gray-900">Individual contributions by size</h3>
        <p class="text-xs text-gray-500">Grouped by each donor's total to the campaign, as the FEC aggregates them.</p>
        <div class="mt-2">${shareBars(sizes.map(r => ({ label: SIZE_LABELS[r.size] || `${r.size}+`, value: r.total })), sizeTotal)}</div>
      </section>` : ""}

    ${st && st.itemizedTotal ? `
      <section class="mt-5">
        <h3 class="text-sm font-bold text-gray-900">Itemized contributions by state</h3>
        <p class="text-xs text-gray-500">The FEC records a donor's state only for itemized contributions (over $200).</p>
        <p class="text-sm text-gray-800 mt-2"><strong>${inPct}%</strong> from ${escapeHtml(home || "the home state")}, ${100 - inPct}% from elsewhere.</p>
        <div class="mt-1">${shareBars(st.top.map(r => ({ label: STATE_NAMES[r.state] || r.name, value: r.total })), st.itemizedTotal)}</div>
      </section>` : ""}

    <p class="text-[11px] text-gray-400 mt-5">
      Figures are as reported to the FEC by the candidate's campaign committee. They don't include
      outside spending such as super PACs. Amounts are rounded; hover for exact figures.
    </p>`;
}

const memberModal = {
  load(e) {
    loadInto(e, "member", getMember(e.id));
    loadInto(e, "profile", fetchFunction("member-profile", e.id));
    loadInto(e, "votes", getRecentVotes());
    if (e.financeRequested) loadInto(e, "finance", fetchFunction("member-finance", e.id)); // Retry
  },
  header(e) {
    const m = e.data.member, p = e.data.profile;
    const name = p?.name || m?.name || (e.errors.member || m === null ? "Member" : "Loading…");
    const shown = m || (p ? { name, party: p.party, imageUrl: p.imageUrl } : { name });
    return `
      ${memberPhoto(shown)}
      <div class="min-w-0 flex-1">
        ${shown.party ? `<span class="text-xs font-semibold px-2 py-0.5 rounded ${PARTY_BADGES[shown.party] || "bg-gray-100 text-gray-800"}">${escapeHtml(shown.party)}</span>` : ""}
        <h2 id="modal-title" class="font-serif text-2xl font-bold text-gray-900 mt-1">${escapeHtml(name)}</h2>
        ${m ? `<p class="text-sm text-gray-500">${escapeHtml(memberRole(m))} · ${escapeHtml(STATE_NAMES[m.state] || m.state || "")}</p>` : ""}
      </div>`;
  },
  tabs: [
    ["overview", "Overview", e => {
      const m = e.data.member, p = e.data.profile;
      if (!m && !p) {
        if (e.errors.member && e.errors.profile) return errorBlock(e.errors.profile);
        if (e.data.member === null && e.errors.profile) return errorBlock(e.errors.profile);
        return spinner("Loading member…");
      }
      const facts = [];
      if (p?.leadership?.length) facts.push(["Leadership", p.leadership.join(", ")]);
      if (m) facts.push(["Role", memberRole(m)], ["State", STATE_NAMES[m.state] || m.state], ["Party", m.party]);
      if (p) facts.push(["First took office", p.firstTermStart], ["Born", p.birthYear], ["Office", p.office?.address], ["Phone", p.office?.phone]);
      if (m && m.current === false) facts.push(["Status", "No longer serving"]);
      return `
        ${factList(facts)}
        ${p ? `
          <div class="grid grid-cols-2 gap-3 mt-4">
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center"><p class="text-xs text-gray-500 uppercase font-semibold">Bills sponsored</p><p class="text-xl font-bold text-gray-900">${p.sponsoredCount ?? "—"}</p></div>
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center"><p class="text-xs text-gray-500 uppercase font-semibold">Bills cosponsored</p><p class="text-xl font-bold text-gray-900">${p.cosponsoredCount ?? "—"}</p></div>
          </div>
          <p class="text-[11px] text-gray-400 mt-1">Career totals, including amendments, per Congress.gov.</p>
          <div class="flex flex-wrap gap-4 mt-4 text-sm">${externalLink(p.website, "Official website")} ${externalLink(p.bioguideUrl, "Congressional biography")}</div>`
        : e.errors.profile ? errorBlock(e.errors.profile) : spinner("Loading details from Congress.gov…")}`;
    }],
    ["votes", "Voting Record", e => {
      const m = e.data.member;
      if (m?.chamber === "Senate") {
        return `<p class="text-sm text-gray-500 py-8 text-center">Senate roll-call votes aren't tracked yet. Only House votes are synced so far.</p>`;
      }
      if (e.errors.votes) return `<p class="text-sm text-red-600 py-8 text-center">Failed to load votes: ${escapeHtml(e.errors.votes)}</p>`;
      if (!e.data.votes) return spinner("Loading votes…");

      const votes = e.data.votes;
      const rec = memberVotingRecord(e.id, votes);
      if (!rec.rows.length) {
        return `<p class="text-sm text-gray-500 py-8 text-center">No record of this member in the ${votes.length} most recent synced House votes.</p>`;
      }
      const c = rec.counts;
      const stat = (label, value, cls) => `<div class="${cls} border rounded-lg p-2 text-center"><p class="text-[11px] font-semibold uppercase">${label}</p><p class="text-lg font-bold">${value}</p></div>`;
      return `
        <p class="text-xs text-gray-500 mb-3">Based on the ${votes.length} most recent House roll-call votes synced from the House Clerk.</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          ${stat("Yea", c.yea, "bg-green-50 border-green-100 text-green-700")}
          ${stat("Nay", c.nay, "bg-red-50 border-red-100 text-red-700")}
          ${stat("Present", c.present, "bg-gray-50 border-gray-200 text-gray-700")}
          ${stat("Not voting", c.not_voting, "bg-yellow-50 border-yellow-100 text-yellow-800")}
        </div>
        ${rec.partyComparable ? `<p class="text-sm text-gray-700 mt-3">Voted with the majority of their party on <strong>${rec.withParty} of ${rec.partyComparable}</strong> votes where they voted Yea or Nay.</p>` : ""}
        <ul class="mt-4 divide-y divide-gray-100">
          ${rec.rows.map(({ vote, position, group, partyMajority }) => {
            const bill = voteBillInfo(vote);
            return `
            <li class="py-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <button type="button" data-open="vote" data-id="${escapeHtml(vote.id)}" class="text-sm font-semibold text-gray-900 hover:text-brand-900 hover:underline text-left">${escapeHtml(vote.question || "Question not available")}</button>
                <p class="text-xs text-gray-500 mt-0.5">
                  Roll call #${escapeHtml(String(vote.roll_call_number ?? "?"))} · ${escapeHtml(formatVoteDate(vote.date))}
                  ${bill ? ` · <button type="button" data-open="bill" data-id="${escapeHtml(vote.bill_id)}" class="text-brand-700 hover:underline">${escapeHtml(bill.label)}</button>` : ""}
                  · ${escapeHtml(vote.result || "Result pending")}
                </p>
                ${partyMajority && group !== partyMajority ? `<p class="text-[11px] text-gray-500 mt-0.5">Voted differently from most of their party</p>` : ""}
              </div>
              <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded ${POSITION_BADGES[group] || "bg-gray-100 text-gray-700"}">${escapeHtml(position || "Not recorded")}</span>
            </li>`;
          }).join("")}
        </ul>`;
    }],
    ["legislation", "Legislation", e => {
      const p = e.data.profile;
      if (e.errors.profile) return errorBlock(e.errors.profile);
      if (!p) return spinner("Loading sponsored legislation…");
      if (!p.sponsored) return errorBlock("Sponsored legislation is unavailable right now.");
      if (!p.sponsored.length) return `<p class="text-sm text-gray-500 py-8 text-center">No sponsored legislation found.</p>`;
      return `
        <p class="text-xs text-gray-500 mb-3">${p.sponsored.length} most recent of ${p.sponsoredCount ?? "?"} sponsored bills and amendments, from Congress.gov.</p>
        <ul class="divide-y divide-gray-100">
          ${p.sponsored.map(item => `
            <li class="py-3">
              <div class="flex flex-wrap items-center gap-2 text-xs">
                ${item.kind === "bill" && item.bill_id
                  ? `<button type="button" data-open="bill" data-id="${escapeHtml(item.bill_id)}" class="font-semibold text-brand-700 hover:underline">${escapeHtml(item.label)}</button>`
                  : item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="font-semibold text-brand-700 hover:underline">${escapeHtml(item.label)}</a>`
                  : `<span class="font-semibold">${escapeHtml(item.label)}</span>`}
                ${item.introducedDate ? `<span class="text-gray-400">Introduced ${escapeHtml(item.introducedDate)}</span>` : ""}
                ${item.policyArea ? `<span class="text-gray-500">· ${escapeHtml(item.policyArea)}</span>` : ""}
              </div>
              ${item.title ? `<p class="text-sm text-gray-900 mt-1">${escapeHtml(item.title)}</p>` : ""}
              ${item.latestAction?.text ? `<p class="text-xs text-gray-500 mt-1"><strong class="text-gray-600">Latest action${item.latestAction.actionDate ? ` (${escapeHtml(item.latestAction.actionDate)})` : ""}:</strong> ${escapeHtml(item.latestAction.text)}</p>` : ""}
            </li>`).join("")}
        </ul>`;
    }],
    ["money", "Campaign Finance", renderFinanceTab],
  ],
};

// --- bill

const billModal = {
  load(e) {
    loadInto(e, "bill", getBill(e.id));
    loadInto(e, "detail", fetchFunction("bill-detail", e.id));
    loadInto(e, "votes", getVotesForBill(e.id));
  },
  header(e) {
    const b = e.data.bill, d = e.data.detail;
    const label = b ? billLabel(b) : d?.bill_number || e.id.toUpperCase();
    const title = b?.title || d?.title || (e.errors.detail ? "" : "Loading…");
    const policy = b?.policy_area || d?.policy_area;
    const congress = b?.congress || d?.congress;
    return `
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="bg-brand-50 text-brand-700 font-semibold ring-1 ring-brand-100 px-2 py-0.5 rounded uppercase">${escapeHtml(label)}</span>
          ${congress ? `<span class="text-gray-500">${escapeHtml(ordinal(Number(congress)))} Congress</span>` : ""}
          ${policy ? `<span class="text-gray-500">· ${escapeHtml(policy)}</span>` : ""}
        </div>
        <h2 id="modal-title" class="font-serif text-xl font-bold text-gray-900 mt-1">${escapeHtml(title || label)}</h2>
      </div>`;
  },
  tabs: [
    ["summary", "Summary", e => {
      const b = e.data.bill, d = e.data.detail;
      const bill = b || d;
      if (!bill) return e.errors.detail ? errorBlock(e.errors.detail) : spinner("Loading bill…");
      const sponsor = d?.sponsor;
      const latest = bill.latestAction;
      const facts = [
        ["Sponsor", sponsor ? memberLink(sponsor.bioguideId, sponsor.label || sponsor.name) : null, true],
        ["Cosponsors", d?.cosponsorsCount],
        ["Introduced", bill.introduced_date],
        ["Origin chamber", bill.chamber],
        ["Policy area", bill.policy_area || (d ? "Not yet assigned by CRS" : null)],
        ["Latest action", latest?.text ? `${latest.actionDate ? `${escapeHtml(latest.actionDate)}: ` : ""}${escapeHtml(latest.text)}` : null, true],
      ];
      const ai = b?.ai_summary?.bullet_points?.length ? `
        <section class="mt-5">
          <h3 class="text-sm font-bold text-gray-900">Plain-language summary</h3>
          <ul class="list-disc pl-5 space-y-1 text-gray-700 text-sm mt-2">${b.ai_summary.bullet_points.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
          <p class="text-[11px] text-gray-400 mt-1">${escapeHtml(SUMMARY_SOURCE_LABELS[b.ai_summary.source] || "AI-generated summary")}</p>
        </section>`
        : `<p class="text-xs text-gray-400 mt-5">No plain-language AI summary yet${b ? "" : " (this bill hasn't been synced)"}.</p>`;
      const crs = d?.crsSummary ? `
        <section class="mt-5">
          <h3 class="text-sm font-bold text-gray-900">Official summary <span class="font-normal text-gray-500">(Congressional Research Service${d.crsSummary.version ? `, ${escapeHtml(d.crsSummary.version)}` : ""})</span></h3>
          <details class="mt-2 group">
            <summary class="text-sm text-gray-700 cursor-pointer list-none">
              <span class="group-open:hidden">${escapeHtml(d.crsSummary.text.slice(0, 280))}${d.crsSummary.text.length > 280 ? "… <span class=\"text-brand-700\">Read more</span>" : ""}</span>
              <span class="hidden group-open:inline text-brand-700">Show less</span>
            </summary>
            <p class="text-sm text-gray-700 mt-2 whitespace-pre-line">${escapeHtml(d.crsSummary.text)}</p>
          </details>
        </section>`
        : d ? `<p class="text-xs text-gray-400 mt-3">No official CRS summary yet.</p>`
        : e.errors.detail ? errorBlock(e.errors.detail) : spinner("Loading sponsor and official summary…");
      return `
        ${factList(facts)}
        ${ai}
        ${crs}
        <div class="flex flex-wrap gap-4 mt-5 text-sm">${externalLink(bill.congress_gov_url, "View on Congress.gov")}</div>`;
    }],
    ["actions", "Actions", e => {
      const d = e.data.detail;
      if (e.errors.detail) return errorBlock(e.errors.detail);
      if (!d) return spinner("Loading actions…");
      if (!d.actions) return errorBlock("The action history is unavailable right now.");
      if (!d.actions.length) return `<p class="text-sm text-gray-500 py-8 text-center">No actions recorded yet.</p>`;
      return `
        <p class="text-xs text-gray-500 mb-3">${d.actions.length} actions, newest first, from Congress.gov.</p>
        <ol class="relative border-l border-gray-200 ml-2">
          ${d.actions.map(a => `
            <li class="ml-4 pb-4">
              <span class="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-brand-200 border border-white"></span>
              <p class="text-xs text-gray-500">${escapeHtml(a.actionDate || "")}${a.source ? ` · ${escapeHtml(a.source)}` : ""}</p>
              <p class="text-sm text-gray-800">${escapeHtml(a.text)}</p>
              ${a.recordedVotes.map(rv => {
                const id = houseVoteId(rv);
                return id
                  ? `<button type="button" data-open="vote" data-id="${escapeHtml(id)}" class="text-xs font-semibold text-brand-700 hover:underline mr-3">Roll call #${escapeHtml(String(rv.rollNumber))}: how members voted →</button>`
                  : rv.url ? `<a href="${escapeHtml(rv.url)}" target="_blank" rel="noopener" class="text-xs text-brand-700 hover:underline mr-3">${escapeHtml(rv.chamber || "")} roll call #${escapeHtml(String(rv.rollNumber ?? "?"))} →</a>` : "";
              }).join("")}
            </li>`).join("")}
        </ol>`;
    }],
    ["votes", "Votes", e => {
      if (e.errors.votes) return `<p class="text-sm text-red-600 py-8 text-center">Failed to load votes: ${escapeHtml(e.errors.votes)}</p>`;
      if (!e.data.votes) return spinner("Loading votes…");
      if (!e.data.votes.length) {
        return `<p class="text-sm text-gray-500 py-8 text-center">No roll-call votes on this bill have been synced. Check the Actions tab for recorded votes.</p>`;
      }
      return `
        <ul class="divide-y divide-gray-100">
          ${e.data.votes.map(v => `
            <li class="py-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <button type="button" data-open="vote" data-id="${escapeHtml(v.id)}" class="text-sm font-semibold text-gray-900 hover:text-brand-900 hover:underline text-left">${escapeHtml(v.question || "Question not available")}</button>
                <p class="text-xs text-gray-500 mt-0.5">Roll call #${escapeHtml(String(v.roll_call_number ?? "?"))} · ${escapeHtml(formatVoteDate(v.date))} · Yea ${v.tallies?.yea ?? "—"}, Nay ${v.tallies?.nay ?? "—"}</p>
              </div>
              <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded ${resultBadgeClass(v.result)}">${escapeHtml(v.result || "Result pending")}</span>
            </li>`).join("")}
        </ul>`;
    }],
  ],
};

// --- vote

const POSITION_ORDER = ["yea", "nay", "present", "not_voting", "other"];
const POSITION_HEADINGS = { yea: "Yea", nay: "Nay", present: "Present", not_voting: "Not voting", other: "Other" };

function voteMemberListHtml(e) {
  const vote = e.data.vote;
  const f = e.filter;
  const term = (f.text || "").trim().toLowerCase();
  // A bare state code ("wa") filters by state; anything else matches names.
  const stateCode = STATE_NAMES[term.toUpperCase()] ? term.toUpperCase() : null;
  const rows = (vote.individual_votes || []).filter(v =>
    (!f.party || v.party === f.party) &&
    (!term || (stateCode ? v.state === stateCode : (v.name || "").toLowerCase().includes(term))));
  const groups = {};
  for (const v of rows) {
    const g = POSITION_GROUPS[(v.position || "").toLowerCase()] || "other";
    (groups[g] ??= []).push(v);
  }
  if (!rows.length) return `<p class="text-sm text-gray-500 py-6 text-center">No members match.</p>`;
  return POSITION_ORDER.filter(g => groups[g]).map(g => `
    <section class="mt-4">
      <h3 class="text-xs font-bold uppercase text-gray-500">${POSITION_HEADINGS[g]} <span class="font-normal">(${groups[g].length})</span></h3>
      <ul class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        ${groups[g].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(v => `
          <li class="py-1 text-sm flex items-center justify-between gap-2 border-b border-gray-50">
            ${memberLink(v.bioguideId, v.name || v.bioguideId || "Unknown")}
            <span class="text-xs text-gray-500 shrink-0">${escapeHtml(v.party || "?")}-${escapeHtml(v.state || "?")}</span>
          </li>`).join("")}
      </ul>
    </section>`).join("");
}

const voteModal = {
  load(e) {
    loadInto(e, "vote", getVote(e.id));
  },
  header(e) {
    const v = e.data.vote;
    if (!v) {
      return `<div class="min-w-0 flex-1"><h2 id="modal-title" class="font-serif text-xl font-bold text-gray-900">${e.data.vote === null ? "Vote not synced" : "Loading vote…"}</h2></div>`;
    }
    return `
      <div class="min-w-0 flex-1">
        <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gold-50 text-gold-800 ring-1 ring-gold-200 uppercase">${voteHeadingBadge(v)}</span>
        <h2 id="modal-title" class="font-serif text-xl font-bold text-gray-900 mt-1">${escapeHtml(v.question || "Question not available")}</h2>
        <p class="text-sm text-gray-500 mt-0.5">
          <span class="inline-block px-2 py-0.5 text-xs font-bold rounded ${resultBadgeClass(v.result)}">${escapeHtml(v.result || "Result pending")}</span>
          ${escapeHtml(formatVoteDate(v.date))}
        </p>
      </div>`;
  },
  tabs: [
    ["results", "Results", e => {
      const v = e.data.vote;
      if (e.errors.vote) return `<p class="text-sm text-red-600 py-8 text-center">Failed to load vote: ${escapeHtml(e.errors.vote)}</p>`;
      if (v === undefined) return spinner("Loading vote…");
      if (v === null) return `<p class="text-sm text-gray-500 py-8 text-center">This roll call hasn't been synced yet. Only the most recent House votes are stored so far.</p>`;
      return `
        ${voteBillLine(v)}
        ${v.vote_type ? `<p class="text-xs text-gray-400 mt-1">${escapeHtml(v.vote_type)}</p>` : ""}
        ${voteTalliesHtml(v)}
        <div class="flex flex-wrap gap-4 mt-4 text-sm">${externalLink(v.source_url, "Official record (House Clerk)")}</div>`;
    }],
    ["members", "How members voted", e => {
      const v = e.data.vote;
      if (!v) return voteModal.tabs[0][2](e);
      if (!v.individual_votes?.length) return `<p class="text-sm text-gray-500 py-8 text-center">Member-level votes not available.</p>`;
      const parties = [...new Set(v.individual_votes.map(x => x.party).filter(Boolean))].sort();
      return `
        <div class="flex flex-wrap gap-2">
          <input type="search" data-vote-filter="text" value="${escapeHtml(e.filter.text || "")}" placeholder="Filter by name or state (e.g. WA)"
            class="flex-1 min-w-[12rem] px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
          <select data-vote-filter="party" class="px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white">
            <option value="">All parties</option>
            ${parties.map(p => `<option value="${escapeHtml(p)}"${e.filter.party === p ? " selected" : ""}>${escapeHtml(PARTY_NAMES[p] || p)}</option>`).join("")}
          </select>
        </div>
        <div data-vote-members>${voteMemberListHtml(e)}</div>`;
    }],
  ],
};

// --- modal shell

const MODAL_KINDS = { member: memberModal, bill: billModal, vote: voteModal };

function loadInto(entry, key, promise) {
  delete entry.errors[key];
  Promise.resolve(promise)
    .then(value => { entry.data[key] = value ?? null; })
    .catch(err => { console.error(`Modal load ${entry.kind}/${key}:`, err); entry.errors[key] = err.message; })
    .finally(() => { if (modalStack.at(-1) === entry) renderModal(); });
}

function openModal(kind, id) {
  const def = MODAL_KINDS[kind];
  if (!def || !id) return;
  const top = modalStack.at(-1);
  if (top && top.kind === kind && top.id === id) return;
  if (!modalStack.length) lastFocused = document.activeElement;
  const entry = { kind, id, tab: def.tabs[0][0], data: {}, errors: {}, filter: {} };
  modalStack.push(entry);
  renderModal();
  document.body.classList.add("overflow-hidden");
  modalRoot.querySelector("[data-close]")?.focus();
  def.load(entry);
}

function closeModals() {
  modalStack = [];
  modalRoot.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
  lastFocused?.focus?.();
}

function backModal() {
  modalStack.pop();
  if (!modalStack.length) return closeModals();
  renderModal();
  modalRoot.querySelector("[data-close]")?.focus();
}

function renderModal() {
  const e = modalStack.at(-1);
  if (!e) return;
  const def = MODAL_KINDS[e.kind];
  // Keep scroll when data arrives for the same entry + tab; reset otherwise.
  const panel = modalRoot.querySelector("[data-panel]");
  const sameView = panel && panel.dataset.view === `${modalStack.length}:${e.kind}:${e.id}:${e.tab}`;
  const scrollTop = sameView ? panel.scrollTop : 0;
  const [, , renderTab] = def.tabs.find(([key]) => key === e.tab);

  modalRoot.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-gray-900/50 p-0 sm:p-6" data-backdrop>
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title"
        class="bg-white w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl shadow-xl flex flex-col">
        <div class="shrink-0 flex items-start gap-4 p-5 border-b border-gray-200">
          ${modalStack.length > 1 ? `<button type="button" data-back aria-label="Back" class="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500">←</button>` : ""}
          ${def.header(e)}
          <button type="button" data-close aria-label="Close" class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500">✕</button>
        </div>
        <div role="tablist" class="shrink-0 flex gap-4 px-5 border-b border-gray-200 overflow-x-auto">
          ${def.tabs.map(([key, label]) => `
            <button type="button" role="tab" data-tab="${key}" aria-selected="${key === e.tab}"
              class="py-3 text-sm font-semibold whitespace-nowrap border-b-2 ${key === e.tab ? "text-brand-900 border-gold-500" : "text-gray-500 border-transparent hover:text-gray-700"}">${label}</button>`).join("")}
        </div>
        <div data-panel data-view="${escapeHtml(`${modalStack.length}:${e.kind}:${e.id}:${e.tab}`)}" role="tabpanel" class="p-5 overflow-y-auto flex-1">${renderTab(e)}</div>
      </div>
    </div>`;
  modalRoot.querySelector("[data-panel]").scrollTop = scrollTop;
}

function setupModals() {
  document.addEventListener("click", ev => {
    const opener = ev.target.closest("[data-open]");
    if (opener) {
      ev.preventDefault();
      openModal(opener.dataset.open, opener.dataset.id);
      return;
    }
    if (!modalStack.length) return;
    if (ev.target.matches("[data-backdrop]") || ev.target.closest("[data-close]")) return closeModals();
    if (ev.target.closest("[data-back]")) return backModal();
    const tab = ev.target.closest("[data-tab]");
    if (tab) {
      modalStack.at(-1).tab = tab.dataset.tab;
      renderModal();
      modalRoot.querySelector(`[data-tab="${tab.dataset.tab}"]`)?.focus();
      return;
    }
    if (ev.target.closest("[data-retry]")) {
      const e = modalStack.at(-1);
      e.errors = {};
      MODAL_KINDS[e.kind].load(e);
      renderModal();
    }
  });
  // Vote member filters update only the list, so the input keeps focus.
  const onFilter = ev => {
    const field = ev.target.dataset?.voteFilter;
    const e = modalStack.at(-1);
    if (!field || !e || e.kind !== "vote") return;
    e.filter[field] = ev.target.value;
    modalRoot.querySelector("[data-vote-members]").innerHTML = voteMemberListHtml(e);
  };
  modalRoot.addEventListener("input", onFilter);
  modalRoot.addEventListener("change", onFilter);
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && modalStack.length) closeModals();
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setupBillFilters() {
  if (searchInput) {
    let debounce;
    searchInput.addEventListener("input", () => {
      applyBillFilters();
      clearTimeout(debounce);
      debounce = setTimeout(lookupBillNumber, 300);
    });
  }

  document.querySelectorAll("#category-filters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.category === activeCategory) return;
      activeCategory = btn.dataset.category;
      document.querySelectorAll("#category-filters .filter-btn").forEach(b => {
        const active = b === btn;
        b.classList.toggle("bg-brand-800", active);
        b.classList.toggle("text-white", active);
        b.classList.toggle("bg-gray-200", !active);
        b.classList.toggle("text-gray-700", !active);
        b.classList.toggle("hover:bg-gray-300", !active);
      });
      loadBills({ reset: true });
    });
  });
}

// "HR 1234", "hr1234", "H.R. 1234" or "1234" -> { type: "HR" | null, number: "1234" }
function parseBillNumberTerm(term) {
  const m = /^([a-z.]*)\s*(\d+)$/.exec(term.trim().toLowerCase());
  if (!m) return null;
  const type = m[1].replace(/\./g, "").toUpperCase();
  return { type: type || null, number: String(Number(m[2])) };
}

// Search can only scan loaded pages (Firestore has no text search), but bill
// numbers are exact fields, so look those up directly across the collection.
let numberMatches = [];
let numberLookupTerm = "";

async function lookupBillNumber() {
  const term = (searchInput?.value || "").trim();
  const parsed = parseBillNumberTerm(term);
  numberLookupTerm = term;
  if (!parsed) {
    if (numberMatches.length) { numberMatches = []; applyBillFilters(); }
    return;
  }
  try {
    const constraints = [where("number", "==", parsed.number)];
    if (parsed.type) constraints.push(where("type", "==", parsed.type));
    const snapshot = await getDocs(query(collection(db, "bills"), ...constraints, limit(20)));
    if (numberLookupTerm !== term) return; // input changed meanwhile
    numberMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    rememberBills(numberMatches);
    applyBillFilters();
  } catch (err) {
    console.error("Bill number lookup failed:", err);
  }
}

function applyBillFilters() {
  if (billsError) {
    billsContainer.innerHTML = `<p class="text-center text-red-500 py-12">${escapeHtml(billsError)}</p>`;
    billsMore.innerHTML = "";
    return;
  }
  const term = (searchInput?.value || "").trim().toLowerCase();
  // "HR 1234", "hr1234" and "1234" should all match bill HR 1234
  const compactTerm = term.replace(/[\s.]/g, "");

  const matches = bill => {
    if (activeCategory !== "all" && bill.category !== activeCategory) return false;
    if (!term) return true;
    const title = (bill.title || "").toLowerCase();
    const policyArea = (bill.policy_area || "").toLowerCase();
    const label = billLabel(bill).toLowerCase().replace(/[\s.]/g, "");
    return title.includes(term) || policyArea.includes(term) || label.includes(compactTerm);
  };

  const byId = new Map();
  for (const bill of allBills) if (matches(bill)) byId.set(bill.id, bill);
  if (term && numberLookupTerm.toLowerCase() === term) {
    for (const bill of numberMatches) if (matches(bill)) byId.set(bill.id, bill);
  }
  const filtered = [...byId.values()].sort((a, b) => (b.update_date || "").localeCompare(a.update_date || ""));

  renderBills(filtered, term);
  renderLoadMore();
}

init();