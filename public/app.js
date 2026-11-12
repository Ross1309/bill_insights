// Entry point: startup, tab wiring, Overview and Issues tabs, data freshness.
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { renderIssue } from "./issues.js";
import { renderOverview } from "./overview.js";
import { db, getFirestoreDoc, getOverviewDoc, getVote } from "./data.js";
import { escapeHtml, store } from "./util.js";
import { activeTab, navBills, navIssues, navMembers, navOverview, navVotes, onTabOpen, switchTab } from "./tabs.js";
import { setupBillFilters, startBills } from "./bills.js";
import { fetchVotes, setupVoteFilters, votesLoaded } from "./votes.js";
import { DEFAULT_STATE, applyLegislatorsArg, legislatorsArg, lookupDistrict, myReps, rememberMyReps, repsFor, populateStateSelect, setChipGroup, setMemberFilters, setupMemberFilters, showDirectory } from "./members.js";
import { setupModals } from "./modals.js";
import { renderWeekPage } from "./week.js";
import { renderHome } from "./home.js";
import { setupSearch } from "./search.js";
import { onTabArg, setRouteHandlers, shareUrl, startRouter, tabArg, replaceTab } from "./router.js";

let overviewLoaded = false;

// --- Issues tab: one precomputed doc per topic (stats/topic-<slug>) -------------
const ISSUE_TOPICS = ["economy", "healthcare", "foreign-affairs"];
let currentIssue = ISSUE_TOPICS.includes(store.get("cw-issue", "")) ? store.get("cw-issue", "") : "economy";
let issueLoaded = false;
let issueRequest = 0;
const issueCache = new Map();

async function loadIssue(slug) {
  const container = document.getElementById("issue-container");
  const request = ++issueRequest;
  currentIssue = slug;
  store.set("cw-issue", slug);
  if (activeTab() === "issues") replaceTab("issues");
  setChipGroup("issue-topics", "topic", slug);
  try {
    if (!issueCache.has(slug)) {
      container.innerHTML = `<div class="text-center py-12"><div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-transparent mb-4"></div><p class="text-gray-500">Loading...</p></div>`;
      const snap = await getDoc(doc(db, "stats", `topic-${slug}`));
      if (!snap.exists()) throw new Error("This issue page hasn't been built yet.");
      issueCache.set(slug, snap.data());
    }
    if (request !== issueRequest) return;
    const stats = issueCache.get(slug);
    document.getElementById("issue-title").textContent = stats.label;
    issueLoaded = true;
    renderIssue(container, stats, {
      state: store.get("cw-state", DEFAULT_STATE),
      onStateChange: code => store.set("cw-state", code),
      getVote,
    });
  } catch (err) {
    if (request !== issueRequest) return;
    console.error("Error loading issue:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load this issue: ${escapeHtml(err.message)}</p>`;
  }
}

// Clipboard API, else the older execCommand route (some in-app browsers), else a
// prompt the visitor can copy from. Returns whether it was copied.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the next way */ }
  try {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) return true;
  } catch { /* try the next way */ }
  try { window.prompt("Copy this link:", text); } catch { /* nothing else to try */ }
  return false;
}

// "Report an error": a prefilled GitHub issue (public repo) naming the page shown.
// data-report-error="#bill/…" reports that detail; empty = the current URL.
const ISSUES_URL = "https://github.com/Ross1309/bill_insights/issues/new";

function setupReportError() {
  document.addEventListener("click", ev => {
    const link = ev.target.closest("[data-report-error]");
    if (!link) return;
    ev.preventDefault();
    const page = shareUrl(link.dataset.reportError || location.hash);
    const params = new URLSearchParams({
      title: `Data error: ${page.replace(/^https?:\/\//, "")}`,
      body: `Page: ${page}\n\nWhat looks wrong:\n\n\nWhat it should say (and a source, if you have one):\n\n`,
    });
    window.open(`${ISSUES_URL}?${params}`, "_blank", "noopener");
  });
}

// Copy a shareable link: data-copy-link="#bill/…" (or empty = the page as shown now).
function setupCopyLinks() {
  document.addEventListener("click", async ev => {
    const btn = ev.target.closest("[data-copy-link]");
    if (!btn) return;
    const url = shareUrl(btn.dataset.copyLink || location.hash);
    const label = btn.textContent;
    btn.textContent = await copyText(url) ? "Link copied" : "Copy failed";
    setTimeout(() => { btn.textContent = label; }, 2000);
  });
}

function setupIssues() {
  document.getElementById("issue-topics")?.addEventListener("click", e => {
    const b = e.target.closest("[data-topic]");
    if (b && b.dataset.topic !== currentIssue) loadIssue(b.dataset.topic);
  });
}

// --- Weekly digest: #week/<Monday> (stats/weeks + stats/week-<Monday>) ----------
let currentWeek = "";            // "" = the latest week with activity
let weeksPromise = null;
const weekDocs = new Map();
let weekRequest = 0;


async function loadWeek(monday) {
  const container = document.getElementById("week-container");
  const request = ++weekRequest;
  container.innerHTML = `<div class="text-center py-12"><div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-transparent mb-4"></div><p class="text-gray-500">Loading the week…</p></div>`;
  try {
    weeksPromise ??= getDoc(doc(db, "stats", "weeks")).then(s => s.data()?.weeks || []).catch(err => { weeksPromise = null; throw err; });
    const list = await weeksPromise;
    if (!list.length) throw new Error("The weekly digest hasn't been built yet.");
    const target = monday || list.at(-1).week;
    if (!weekDocs.has(target)) {
      const snap = await getDoc(doc(db, "stats", `week-${target}`));
      weekDocs.set(target, snap.exists() ? snap.data() : null);
    }
    if (request !== weekRequest) return;
    const w = weekDocs.get(target);
    if (!w) {
      container.innerHTML = `<p class="text-center text-gray-500 py-12">No roll-call votes or new laws are recorded for the week of ${escapeHtml(target)}. <a href="#week/latest" class="text-accent hover:underline">Go to the latest week</a></p>`;
      return;
    }
    if (!monday) { currentWeek = target; replaceTab("week"); }   // #week -> #week/<that Monday>
    renderWeekPage(container, w, list);
  } catch (err) {
    if (request !== weekRequest) return;
    console.error("Error loading the week:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load this week: ${escapeHtml(err.message)}</p>`;
  }
}

// --- Overview tab: one small precomputed doc (stats/overview) ------------------
// --- Home (first tab) and Charts (#charts), both from stats/overview ------------------
let homeLoading = false;
async function loadHome() {
  if (homeLoading) return;   // clicking Home during the first load
  homeLoading = true;
  const hero = document.getElementById("home-hero");
  try {
    const snap = await getOverviewDoc();
    if (!snap.exists()) {
      hero.innerHTML = `<p class="lg:col-span-3 text-center text-gray-500 py-12">The home page data hasn't been built yet.</p>`;
      return;
    }
    overviewLoaded = true;
    await showHome(snap.data());
  } catch (err) {
    console.error("Error loading home:", err);
    hero.innerHTML = `<p class="lg:col-span-3 text-center text-red-500 py-12">Failed to load: ${escapeHtml(err.message)}</p>`;
  } finally {
    homeLoading = false;
  }
}

// Render, then fill in how "your members" voted on the key votes (their member_votes
// docs: one read each, only once an address was given).
let positionsRequest = 0;
async function showHome(stats) {
  const reps = myReps();
  renderHome(stats, { reps });
  if (!reps?.members?.length || !stats.this_week?.key_votes?.length) return;
  const request = ++positionsRequest;
  const keyIds = new Set(stats.this_week.key_votes.map(v => v.id));
  const positions = new Map();
  await Promise.all(reps.members.map(async m => {
    const rec = await getFirestoreDoc("member_votes", m.id).catch(() => null);
    for (const e of rec?.recent || []) {
      if (!keyIds.has(e.id)) continue;
      if (!positions.has(e.id)) positions.set(e.id, []);
      positions.get(e.id).push({ id: m.id, name: m.name, position: e.position || "Not recorded" });
    }
  }));
  if (request === positionsRequest) renderHome(stats, { reps, positions });
}

// The home page's address form (find your members) and "Change address".
function setupHome() {
  const hero = document.getElementById("home-hero");
  hero.addEventListener("submit", async ev => {
    const form = ev.target.closest("[data-home-find]");
    if (!form) return;
    ev.preventDefault();
    const address = form.querySelector("input").value.trim();
    const status = hero.querySelector("[data-home-find-status]");
    if (!address) return;
    status.className = "text-sm mt-2 text-gray-500";
    status.textContent = "Looking up your district…";
    try {
      const { state, district } = await lookupDistrict(address);
      rememberMyReps(state, district, await repsFor(state, district));
      await showHome((await getOverviewDoc()).data());
    } catch (err) {
      status.className = "text-sm mt-2 text-red-600";
      status.textContent = err.message;
    }
  });
  hero.addEventListener("click", ev => {
    if (!ev.target.closest("[data-home-change]")) return;
    const box = hero.querySelector("[data-home-change-form]");
    box?.classList.toggle("hidden");
    box?.querySelector("input")?.focus();
  });
}

let chartsLoaded = false;
async function loadCharts() {
  const container = document.getElementById("overview-container");
  try {
    const snap = await getOverviewDoc();
    if (!snap.exists()) { container.innerHTML = `<p class="text-center text-gray-500 py-12">The charts haven't been built yet.</p>`; return; }
    chartsLoaded = true;
    renderOverview(container, snap.data(), {
      // State tile -> that state's members in the directory.
      onState: code => {
        switchTab("members");
        setMemberFilters({ state: code, party: "", chamber: "", text: "" });
      },
    });
  } catch (err) {
    console.error("Error loading charts:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load the charts: ${escapeHtml(err.message)}</p>`;
  }
}

// --- Data freshness: stats/health, written by both nightly syncs ---------------
const STALE_AFTER_MS = 36 * 3600 * 1000;   // syncs run daily; allow one missed-by-hours run

async function loadHealth() {
  try {
    const snap = await getDoc(doc(db, "stats", "health"));
    if (!snap.exists()) return;
    const h = snap.data();
    const fmt = iso => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const votesAt = h.ingest_votes?.last_success;
    const billsAt = h.sync_bills?.last_success;
    const parts = [votesAt && `votes and members ${fmt(votesAt)}`, billsAt && `bills ${fmt(billsAt)}`].filter(Boolean);
    if (parts.length) document.getElementById("data-asof").textContent = `Data last updated: ${parts.join("; ")}.`;

    // A sync with no record yet (never ran on this code) shows nothing; one that has
    // run but not succeeded within STALE_AFTER_MS gets the notice.
    const stale = [["Votes and members", h.ingest_votes, votesAt], ["Bills", h.sync_bills, billsAt]]
      .filter(([, run, at]) => run && (!at || Date.now() - Date.parse(at) > STALE_AFTER_MS))
      .map(([label, , at]) => [label, at]);
    if (stale.length) {
      const el = document.getElementById("data-stale");
      el.textContent = `${stale.map(([label, at]) => `${label}: ${at ? `last updated ${fmt(at)}` : "not updated recently"}`).join(". ")}. `
        + "Our nightly update didn't complete, so the newest activity may be missing.";
      el.classList.remove("hidden");
    }
  } catch (err) {
    console.warn("Data freshness unavailable:", err.message);
  }
}

async function init() {
  onTabOpen.overview = () => { if (!overviewLoaded) loadHome(); };   // loadHome guards double calls
  onTabOpen.charts = () => { if (!chartsLoaded) loadCharts(); };
  onTabOpen.issues = () => { if (!issueLoaded) loadIssue(currentIssue); };
  onTabOpen.bills = startBills;
  onTabOpen.votes = () => { if (!votesLoaded) fetchVotes(); };
  onTabOpen.members = showDirectory;
  // URL arguments (see router.js): Issues topic, Legislators state / district.
  tabArg.issues = () => currentIssue;
  // Before the first load starts, just choose the topic (the tab's loader loads it).
  // After that, load whenever the URL's topic differs from the one shown or being
  // loaded (currentIssue is set as soon as a load starts), e.g. Back during a load.
  onTabArg.issues = slug => {
    if (!ISSUE_TOPICS.includes(slug)) return;
    if (!issueRequest) currentIssue = slug;
    else if (slug !== currentIssue) loadIssue(slug);
  };
  tabArg.members = legislatorsArg;
  onTabArg.members = applyLegislatorsArg;
  onTabOpen.week = () => loadWeek(currentWeek);
  tabArg.week = () => currentWeek;
  onTabArg.week = arg => {
    if (arg === "latest") arg = "";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) return;
    const changed = arg !== currentWeek;
    currentWeek = arg;
    if (changed && activeTab() === "week") loadWeek(arg);   // Earlier/Later links on the page
  };
  setRouteHandlers({ showTab: tab => switchTab(tab, { push: false }) });
  populateStateSelect();
  setupTabs();
  setupMemberFilters();
  setupVoteFilters();
  setupBillFilters();
  setupModals();
  setupIssues();
  setupHome();
  setupSearch();
  setupCopyLinks();
  setupReportError();
  loadHealth();
  // Shows the tab / detail in the URL (Overview if none). Bills load when their tab
  // is first opened.
  startRouter();
}

function setupTabs() {
  navOverview.addEventListener("click", () => switchTab("overview"));
  navIssues.addEventListener("click", () => switchTab("issues"));
  navBills.addEventListener("click", () => switchTab("bills"));
  navVotes.addEventListener("click", () => switchTab("votes"));
  navMembers.addEventListener("click", () => switchTab("members"));
}

init();
