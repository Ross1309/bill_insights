// Entry point: startup, tab wiring, Overview and Issues tabs, data freshness.
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { renderIssue } from "./issues.js";
import { renderOverview } from "./overview.js";
import { db, getOverviewDoc, getVote } from "./data.js";
import { escapeHtml, store } from "./util.js";
import { activeTab, navBills, navIssues, navMembers, navOverview, navVotes, onTabOpen, switchTab } from "./tabs.js";
import { setupBillFilters, startBills } from "./bills.js";
import { fetchVotes, setupVoteFilters, votesLoaded } from "./votes.js";
import { DEFAULT_STATE, applyLegislatorsArg, legislatorsArg, loadHeadlineStats, populateStateSelect, setChipGroup, setMemberFilters, setupMemberFilters, showDirectory } from "./members.js";
import { setupModals } from "./modals.js";
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

// --- Overview tab: one small precomputed doc (stats/overview) ------------------
async function loadOverview() {
  const container = document.getElementById("overview-container");
  try {
    const snap = await getOverviewDoc();
    if (!snap.exists()) {
      container.innerHTML = `<p class="text-center text-gray-500 py-12">The overview hasn't been built yet.</p>`;
      return;
    }
    overviewLoaded = true;
    renderOverview(container, snap.data(), {
      // State tile -> that state's members in the directory.
      onState: code => {
        switchTab("members");
        setMemberFilters({ state: code, party: "", chamber: "", text: "" });
      },
    });
  } catch (err) {
    console.error("Error loading overview:", err);
    container.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load the overview: ${escapeHtml(err.message)}</p>`;
  }
}
// --- Data freshness: stats/health, written by both nightly syncs ---------------
const STALE_AFTER_MS = 36 * 3600 * 1000;
 // syncs run daily; allow one missed-by-hours run

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
  onTabOpen.overview = () => { if (!overviewLoaded) loadOverview(); };
  onTabOpen.issues = () => { if (!issueLoaded) loadIssue(currentIssue); };
  onTabOpen.bills = startBills;
  onTabOpen.votes = () => { if (!votesLoaded) fetchVotes(); };
  onTabOpen.members = showDirectory;
  // URL arguments (see router.js): Issues topic, Legislators state / district.
  tabArg.issues = () => currentIssue;
  onTabArg.issues = slug => {
    if (!ISSUE_TOPICS.includes(slug)) return;
    if (issueLoaded && slug !== currentIssue) loadIssue(slug);
    else currentIssue = slug;
  };
  tabArg.members = legislatorsArg;
  onTabArg.members = applyLegislatorsArg;
  setRouteHandlers({ showTab: tab => switchTab(tab, { push: false }) });
  populateStateSelect();
  setupTabs();
  setupMemberFilters();
  setupVoteFilters();
  setupBillFilters();
  setupModals();
  setupIssues();
  setupCopyLinks();
  loadHeadlineStats();
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
