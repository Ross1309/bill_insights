// Bills & Summaries tab: paged query by latest action, category filters, search.
import { collection, getDocs, limit, orderBy, query, startAfter, where } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { billCache, db } from "./data.js";
import { escapeHtml } from "./util.js";

// DOM Elements
const billsContainer = document.getElementById("bills-container");
const billsMore = document.getElementById("bills-more");
const searchInput = document.getElementById("search-input");

// Bills loaded for the active category, newest latest action first (one or more pages).
let allBills = [];

let activeCategory = "all";

// --- Bills: server-side ordering + cursor pagination ---

const BILLS_PAGE_SIZE = 12;
let billsCursor = null;
     // last doc of the most recent page
let billsExhausted = false;
let billsLoading = false;
let billsGeneration = 0;
    // bumps on category change so stale pages are dropped
let billsStarted = false;
   // first page is requested when the Bills tab opens
let categoryIndexReady = true;
 // false once the (category, latest_action_date) index is found missing
let billsError = null;
      // message shown instead of bills until the next reset

// First page of bills, the first time the tab opens (Overview is the default tab).
export function startBills() {
  if (billsStarted) return;
  billsStarted = true;
  loadBills({ reset: true });
}

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
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-transparent mb-4"></div>
        <p class="text-gray-500">Loading bills...</p>
      </div>`;
    billsMore.innerHTML = "";
  }
  if (billsLoading || billsExhausted) return;

  const generation = billsGeneration;
  billsLoading = true;
  renderLoadMore();

  try {
    // Newest latest action first (the date each card shows). Category filtering
    // happens in the query so every page is full; it needs the (category ASC,
    // latest_action_date DESC) index in firestore.indexes.json. Until that index
    // exists, categories fall back to the older (category, update_date) index.
    const constraints = [];
    if (activeCategory !== "all") constraints.push(where("category", "==", activeCategory));
    constraints.push(orderBy(activeCategory !== "all" && !categoryIndexReady ? "update_date" : "latest_action_date", "desc"));
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
    if (err.code === "failed-precondition" && activeCategory !== "all" && categoryIndexReady) {
      categoryIndexReady = false; // retry this page on the older index
      return loadBills({ reset: true });
    }
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
      class="px-4 py-2 text-sm font-semibold rounded-lg bg-surface border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 shadow-sm">
      ${billsLoading ? "Loading…" : "Load more bills"}
    </button>`;
  document.getElementById("bills-load-more").addEventListener("click", () => loadBills());
}

// --- Bill field helpers (schema written by netlify/functions/sync-bills.js) ---

export function billLabel(bill) {
  if (bill.bill_number) return bill.bill_number;
  if (bill.type || bill.number) return `${bill.type || ''} ${bill.number || ''}`.trim();
  return 'BILL';
}

export const SUMMARY_SOURCE_LABELS = {
  crs_summary: 'AI summary of the official CRS summary',
  title_only: 'AI summary from the title only — no official summary yet',
};

// Why a bill has no plain-language summary. Summaries are only written from the
// official CRS summary, never guessed from the title.
export function noSummaryText(bill) {
  if (bill?.crs_summary_available === false) {
    return "No official summary yet. The Congressional Research Service hasn't published one for this bill; a plain-language summary will appear once it does.";
  }
  return "Not summarized yet.";
}

function renderSummary(bill) {
  const points = bill.ai_summary?.bullet_points;
  if (!points || points.length === 0) {
    return `<p class="text-gray-500 text-sm">${escapeHtml(noSummaryText(bill))}</p>`;
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
        <div class="bg-surface border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between text-xs text-gray-500 mb-2">
              <span class="bg-accent/10 text-accent font-semibold ring-1 ring-accent/30 px-2 py-0.5 rounded uppercase">${escapeHtml(billLabel(bill))}</span>
              <span>${escapeHtml(String(bill.congress || ''))}${bill.congress ? 'th Congress' : ''}</span>
            </div>
            ${bill.policy_area ? `<p class="text-xs font-medium text-gray-500 mb-2">${escapeHtml(bill.policy_area)}</p>` : ''}
            <h3 class="font-serif font-bold text-gray-900 text-xl leading-snug mb-3"><button type="button" data-open="bill" data-id="${escapeHtml(bill.id)}" class="text-left hover:text-accent-light hover:underline">${escapeHtml(bill.title || 'Untitled Bill')}</button></h3>
            ${renderSummary(bill)}
          </div>
          <div class="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-1">
            ${bill.latestAction?.text ? `<p><strong class="text-gray-700">Latest action${bill.latestAction.actionDate ? ` (${escapeHtml(bill.latestAction.actionDate)})` : ''}:</strong> ${escapeHtml(bill.latestAction.text)}</p>` : ''}
            <div class="flex flex-wrap gap-4 pt-1">
              <button type="button" data-open="bill" data-id="${escapeHtml(bill.id)}" class="font-semibold text-accent hover:underline">Details, actions &amp; votes →</button>
              ${bill.congress_gov_url ? `<a href="${escapeHtml(bill.congress_gov_url)}" target="_blank" rel="noopener" class="text-accent hover:underline">Congress.gov →</a>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

export function setupBillFilters() {
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
        b.classList.toggle("bg-cta", active);
        b.classList.toggle("text-ink", active);
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
  // Exact bill-number hits ("HR 1" -> HR 1, not HR 10970) first, then newest.
  const parsed = term ? parseBillNumberTerm(term) : null;
  const exact = b => parsed && String(Number(b.number)) === parsed.number && (!parsed.type || b.type === parsed.type);
  const filtered = [...byId.values()].sort((a, b) =>
    (exact(b) ? 1 : 0) - (exact(a) ? 1 : 0) || (b.latest_action_date || "").localeCompare(a.latest_action_date || ""));

  renderBills(filtered, term);
  renderLoadMore();
}
