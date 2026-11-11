import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, limit, orderBy } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

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

let allBills = [];
let votesLoaded = false;
let activeCategory = "all";

async function init() {
  populateStateSelect();
  setupTabs();
  setupStateListener();
  setupBillFilters();
  await fetchBills();
}

function setupTabs() {
  navBills.addEventListener("click", () => switchTab("bills"));
  navVotes.addEventListener("click", () => switchTab("votes"));
  navMembers.addEventListener("click", () => {
    switchTab("members");
    fetchMembers(stateSelect ? stateSelect.value : DEFAULT_STATE);
  });
}

function setupStateListener() {
  if (stateSelect) {
    stateSelect.addEventListener("change", (e) => {
      fetchMembers(e.target.value);
    });
  }
}

function switchTab(tabName) {
  [navBills, navVotes, navMembers].forEach(el => {
    el.className = "nav-tab pb-3 font-semibold text-gray-500 hover:text-gray-700 focus:outline-none transition border-b-2 border-transparent";
  });
  [viewBills, viewVotes, viewMembers].forEach(el => el.classList.add("hidden"));

  if (tabName === "bills") {
    navBills.className = "nav-tab pb-3 font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none transition";
    viewBills.classList.remove("hidden");
  } else if (tabName === "votes") {
    navVotes.className = "nav-tab pb-3 font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none transition";
    viewVotes.classList.remove("hidden");
    if (!votesLoaded) fetchVotes();
  } else if (tabName === "members") {
    navMembers.className = "nav-tab pb-3 font-semibold text-blue-600 border-b-2 border-blue-600 focus:outline-none transition";
    viewMembers.classList.remove("hidden");
  }
}

async function fetchBills() {
  try {
    const billsRef = collection(db, "bills");
    const q = query(billsRef, limit(50));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      billsContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No bills found in database.</p>`;
      return;
    }

    allBills = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => billDate(b).localeCompare(billDate(a)));

    applyBillFilters();
  } catch (err) {
    console.error("Error fetching bills:", err);
    billsContainer.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load bills: ${escapeHtml(err.message)}</p>`;
  }
}

// --- Bill field helpers (schema written by netlify/functions/sync-votes.js) ---

function billLabel(bill) {
  if (bill.bill_number) return bill.bill_number;
  if (bill.type || bill.number) return `${bill.type || ''} ${bill.number || ''}`.trim();
  return 'BILL';
}

function billDate(bill) {
  return bill.latestAction?.actionDate || bill.update_date || '';
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

function renderBills(bills) {
  if (bills.length === 0) {
    billsContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No matching bills found.</p>`;
    return;
  }

  billsContainer.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ${bills.map(bill => `
        <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span class="bg-blue-50 text-blue-600 font-semibold px-2 py-0.5 rounded uppercase">${escapeHtml(billLabel(bill))}</span>
              <span>${escapeHtml(String(bill.congress || ''))}${bill.congress ? 'th Congress' : ''}</span>
            </div>
            ${bill.policy_area ? `<p class="text-xs font-medium text-gray-500 mb-2">${escapeHtml(bill.policy_area)}</p>` : ''}
            <h3 class="font-bold text-gray-900 text-lg mb-3">${escapeHtml(bill.title || 'Untitled Bill')}</h3>
            ${renderSummary(bill)}
          </div>
          <div class="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-1">
            ${bill.latestAction?.text ? `<p><strong class="text-gray-700">Latest action${bill.latestAction.actionDate ? ` (${escapeHtml(bill.latestAction.actionDate)})` : ''}:</strong> ${escapeHtml(bill.latestAction.text)}</p>` : ''}
            ${bill.congress_gov_url ? `<a href="${escapeHtml(bill.congress_gov_url)}" target="_blank" rel="noopener" class="inline-block text-blue-600 hover:underline">View on Congress.gov →</a>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// --- Roll-call votes (schema written by netlify/functions/ingest-votes.js) ---

async function fetchVotes() {
  try {
    const q = query(collection(db, "votes"), orderBy("date", "desc"), limit(25));
    const snapshot = await getDocs(q);
    votesLoaded = true;
    renderVotes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
  const bill = allBills.find(b => b.id === vote.bill_id);
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

function renderVotes(votes) {
  if (votes.length === 0) {
    votesContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No roll-call votes have been synced yet.</p>`;
    return;
  }

  votesContainer.innerHTML = `
    <div class="space-y-6">
      ${votes.map(vote => {
        const t = vote.tallies || {};
        const bill = voteBillInfo(vote);
        const parties = partyBreakdown(vote.individual_votes);
        const tally = (label, value, cls) => `
          <div class="${cls} p-3 rounded-lg border text-center">
            <p class="text-xs font-semibold uppercase">${label}</p>
            <p class="text-xl font-bold">${Number.isFinite(value) ? value : "—"}</p>
          </div>`;
        return `
        <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-gray-100">
            <div>
              <span class="text-xs font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700 uppercase">
                ${escapeHtml(vote.chamber || "House")} Roll Call #${escapeHtml(String(vote.roll_call_number ?? "?"))}${vote.session ? ` · Session ${escapeHtml(String(vote.session))}` : ""}
              </span>
              <h3 class="font-bold text-gray-900 text-lg mt-2">${escapeHtml(vote.question || "Question not available")}</h3>
              ${bill ? `
                <p class="text-sm text-gray-600 mt-1">
                  ${bill.url
                    ? `<a href="${escapeHtml(bill.url)}" target="_blank" rel="noopener" class="font-semibold text-blue-600 hover:underline">${escapeHtml(bill.label)}</a>`
                    : `<span class="font-semibold">${escapeHtml(bill.label)}</span>`}
                  ${bill.title ? ` — ${escapeHtml(bill.title)}` : ""}
                </p>` : `<p class="text-sm text-gray-400 mt-1">No bill associated with this vote</p>`}
              ${vote.vote_type ? `<p class="text-xs text-gray-400 mt-1">${escapeHtml(vote.vote_type)}</p>` : ""}
            </div>
            <div class="sm:text-right shrink-0">
              <span class="inline-block px-3 py-1 text-xs font-bold rounded ${resultBadgeClass(vote.result)}">${escapeHtml(vote.result || "Result pending")}</span>
              <p class="text-xs text-gray-400 mt-1">${escapeHtml(formatVoteDate(vote.date))}</p>
            </div>
          </div>
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
            </table>` : `<p class="text-xs text-gray-400">Member-level votes not available.</p>`}
          ${vote.source_url ? `<a href="${escapeHtml(vote.source_url)}" target="_blank" rel="noopener" class="inline-block mt-3 text-xs text-blue-600 hover:underline">Official record (House Clerk) →</a>` : ""}
        </div>`;
      }).join("")}
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

async function fetchMembers(stateCode) {
  const request = ++membersRequest;
  const stateName = STATE_NAMES[stateCode] || stateCode;
  try {
    membersContainer.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4"></div>
        <p class="text-gray-500">Loading members for ${escapeHtml(stateName)}...</p>
      </div>
    `;

    const q = query(collection(db, "members"), where("state", "==", stateCode), where("current", "==", true), limit(100));
    const snapshot = await getDocs(q);
    if (request !== membersRequest) return; // a newer state was selected meanwhile

    if (snapshot.empty) {
      membersContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No current members found for ${escapeHtml(stateName)}.</p>`;
      return;
    }

    const members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort(compareMembers);
    membersContainer.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${members.map(m => `
          <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex items-center gap-4">
            ${memberPhoto(m)}
            <div class="min-w-0">
              ${m.party ? `<span class="text-xs font-semibold px-2 py-0.5 rounded ${PARTY_BADGES[m.party] || "bg-gray-100 text-gray-800"}">${escapeHtml(m.party)}</span>` : ""}
              <h3 class="font-bold text-gray-900 text-base mt-1">${escapeHtml(m.name || "Name not available")}</h3>
              <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(memberRole(m))}</p>
            </div>
          </div>
        `).join("")}
      </div>
      <p class="text-xs text-gray-400 mt-4">${members.length} current member${members.length === 1 ? "" : "s"} · Source: Congress.gov</p>
    `;
  } catch (err) {
    if (request !== membersRequest) return;
    console.error("Error fetching members:", err);
    membersContainer.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load members: ${escapeHtml(err.message)}</p>`;
  }
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
    searchInput.addEventListener("input", applyBillFilters);
  }

  document.querySelectorAll("#category-filters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category;
      document.querySelectorAll("#category-filters .filter-btn").forEach(b => {
        const active = b === btn;
        b.classList.toggle("bg-blue-600", active);
        b.classList.toggle("text-white", active);
        b.classList.toggle("bg-gray-200", !active);
        b.classList.toggle("text-gray-700", !active);
        b.classList.toggle("hover:bg-gray-300", !active);
      });
      applyBillFilters();
    });
  });
}

function applyBillFilters() {
  const term = (searchInput?.value || "").trim().toLowerCase();
  // "HR 1234", "hr1234" and "1234" should all match bill HR 1234
  const compactTerm = term.replace(/[\s.]/g, "");

  const filtered = allBills.filter(bill => {
    if (activeCategory !== "all" && bill.category !== activeCategory) return false;
    if (!term) return true;
    const title = (bill.title || "").toLowerCase();
    const policyArea = (bill.policy_area || "").toLowerCase();
    const label = billLabel(bill).toLowerCase().replace(/[\s.]/g, "");
    return title.includes(term) || policyArea.includes(term) || label.includes(compactTerm);
  });

  renderBills(filtered);
}

init();