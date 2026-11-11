import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, limit } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

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
let activeCategory = "all";

async function init() {
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
    fetchMembers(stateSelect ? stateSelect.value : "WA");
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
    renderVotesFromBills(allBills);
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

function renderVotesFromBills(bills) {
  // Even if specific vote fields are missing, display bill actions/titles as roll-call entries
  if (!bills || bills.length === 0) {
    votesContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No vote or action records found.</p>`;
    return;
  }

  votesContainer.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      ${bills.map(bill => `
        <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span class="bg-purple-50 text-purple-600 font-semibold px-2 py-0.5 rounded uppercase">Action / Vote</span>
              <span>${escapeHtml(billLabel(bill))}</span>
            </div>
            <h3 class="font-bold text-gray-900 text-lg mb-2">${escapeHtml(bill.title || 'Legislative Item')}</h3>
            <p class="text-gray-600 text-sm mb-3"><strong>Latest Action:</strong> ${escapeHtml(bill.latestAction?.text || bill.actionText || 'No action text recorded.')}</p>
            ${bill.latestAction?.actionDate ? `<p class="text-xs text-gray-400">Date: ${escapeHtml(bill.latestAction.actionDate)}</p>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function fetchMembers(stateCode) {
  try {
    membersContainer.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4"></div>
        <p class="text-gray-500">Loading members for ${stateCode}...</p>
      </div>
    `;

    const membersRef = collection(db, "members");
    // Query Firestore filtering by state field
    const q = query(membersRef, where("state", "==", stateCode), limit(50));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      membersContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No members found for ${stateCode}.</p>`;
      return;
    }

    const members = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    membersContainer.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${members.map(m => `
          <div class="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 class="font-bold text-gray-900 text-lg">${escapeHtml(m.name || m.fullName || 'Member')}</h3>
            <p class="text-sm text-gray-500">${escapeHtml(m.state || '')} — <span class="font-medium text-blue-600">${escapeHtml(m.party || '')}</span></p>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
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