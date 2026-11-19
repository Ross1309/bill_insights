// Entry point: startup, tab wiring, Overview and Issues tabs, data freshness.
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { renderIssue } from "./issues.js";
import { renderOverview } from "./overview.js";
import { firestore, getBill, getHome, getFirestoreDoc, getMember, getMemberVotes, getOverviewDoc, getVote, loadParticipation } from "./data.js";
import { billBaseline, billChange, followButtonHtml, followCount, isFollowing, LIMITS, loadFollows, memberBaseline, memberChange, setFollow, topicBaseline, topicChange } from "./follow.js";
import { escapeHtml, loadErrorHtml, store } from "./util.js";
import { activeTab, navBills, navCongress, navIssues, navMembers, navOverview, navVotes, onTabOpen, switchTab } from "./tabs.js";
import { renderCongressPage } from "./congress-page.js";
import { glossaryHtml, setupGlossary } from "./glossary.js";
import { setupBillFilters, startBills } from "./bills.js";
import { fetchVotes, setupVoteFilters, votesLoaded } from "./votes.js";
import { DEFAULT_STATE, applyLegislatorsArg, legislatorsArg, forgetMyReps, lookupDistrict, myReps, rememberMyReps, repsFor, withContacts, populateStateSelect, setChipGroup, setMemberFilters, setupMemberFilters, showDirectory } from "./members.js";
import { setupModals } from "./modals.js";
import { renderWeekPage } from "./week.js";
import { loadMine, setupMine } from "./mine.js";
import { renderHome, upcomingHtml } from "./home.js";
import { setupSearch } from "./search.js";
import { onTabArg, setRouteHandlers, shareUrl, startRouter, tabArg, replaceTab } from "./router.js";

let overviewLoaded = false;

// --- Issues tab: one precomputed doc per topic (stats/topic-<slug>) -------------
const ISSUE_TOPICS = ["economy", "healthcare", "foreign-affairs", "immigration", "defense"];
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
      container.innerHTML = `<div class="text-center py-12"><div class="inline-block animate-spin motion-reduce:animate-none rounded-full h-8 w-8 border-4 border-accent border-t-transparent mb-4"></div><p class="text-gray-500">Loading...</p></div>`;
      const snap = await getDoc(doc(firestore(), "stats", `topic-${slug}`));
      if (!snap.exists()) throw new Error("This issue page hasn't been built yet.");
      issueCache.set(slug, snap.data());
    }
    if (request !== issueRequest) return;
    const stats = issueCache.get(slug);
    document.getElementById("issue-title").textContent = stats.label;
    document.getElementById("issue-follow").innerHTML = followButtonHtml("topics", slug);
    issueLoaded = true;
    renderIssue(container, stats, {
      state: store.get("cw-state", DEFAULT_STATE),
      onStateChange: code => store.set("cw-state", code),
      getVote,
    });
  } catch (err) {
    if (request !== issueRequest) return;
    console.error("Error loading issue:", err);
    container.innerHTML = loadErrorHtml("this topic", err);
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
    btn.dataset.label ??= btn.textContent;   // the original, even after a double click
    btn.textContent = await copyText(url) ? "Link copied" : "Copy failed";
    setTimeout(() => { btn.textContent = btn.dataset.label; }, 2000);
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
  container.innerHTML = `<div class="text-center py-12"><div class="inline-block animate-spin motion-reduce:animate-none rounded-full h-8 w-8 border-4 border-accent border-t-transparent mb-4"></div><p class="text-gray-500">Loading the week…</p></div>`;
  try {
    weeksPromise ??= getDoc(doc(firestore(), "stats", "weeks")).then(s => s.data()?.weeks || []).catch(err => { weeksPromise = null; throw err; });
    const list = await weeksPromise;
    if (!list.length) throw new Error("The weekly digest hasn't been built yet.");
    const target = monday || list.at(-1).week;
    if (!weekDocs.has(target)) {
      const snap = await getDoc(doc(firestore(), "stats", `week-${target}`));
      weekDocs.set(target, snap.exists() ? snap.data() : null);
    }
    if (request !== weekRequest) return;
    const w = weekDocs.get(target);
    if (!w) {
      container.innerHTML = `<p class="text-center text-gray-500 py-12">No votes or new laws are recorded for the week of ${escapeHtml(target)}. <a href="#week/latest" class="text-accent hover:underline">Go to the latest week</a></p>`;
      return;
    }
    if (!monday) { currentWeek = target; replaceTab("week"); }   // #week -> #week/<that Monday>
    renderWeekPage(container, w, list);
  } catch (err) {
    if (request !== weekRequest) return;
    console.error("Error loading the week:", err);
    container.innerHTML = loadErrorHtml("this week", err);
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
      hero.innerHTML = `<p class="md:col-span-2 lg:col-span-3 text-center text-gray-500 py-12">The home page data hasn't been built yet.</p>`;
      return;
    }
    overviewLoaded = true;
    await showHome(snap.data());
  } catch (err) {
    console.error("Error loading home:", err);
    hero.innerHTML = loadErrorHtml("the home page", err, "md:col-span-2 lg:col-span-3");
  } finally {
    homeLoading = false;
  }
}

// Render, then fill in how "your members" voted on the key votes: from each key vote's
// own record (every member's position; one read each, cached), only once an address was
// given. Not from member_votes.recent: that holds only the latest 50 votes, so an older
// key vote would wrongly read "none of your members voted". A vote that can't be read
// shows "not available", never "didn't vote".
let positionsRequest = 0;
async function showHome(stats) {
  showFollows(stats);
  const reps = await withContacts(myReps());
  // House floor schedule (stats/floor, one small read), rendered on its own.
  getHome().then(home => home.floor).then(floor => { document.getElementById("home-upcoming").innerHTML = upcomingHtml(floor, reps); })
    .catch(err => console.warn("Floor schedule unavailable:", err.message));
  // Missed votes of "your members" (one small doc), only once an address was given.
  const participation = reps?.members?.length && !reps.stale ? await loadParticipation().catch(() => null) : null;
  renderHome(stats, { reps, participation });
  if (reps?.stale || !reps?.members?.length || !stats.this_week?.key_votes?.length) return;
  const request = ++positionsRequest;
  const mine = new Map(reps.members.map(m => [m.id, m]));
  const positions = new Map();
  await Promise.all(stats.this_week.key_votes.map(async kv => {
    const vote = await getVote(kv.id).catch(() => null);
    if (!vote?.individual_votes) { positions.set(kv.id, null); return; }   // unavailable
    positions.set(kv.id, vote.individual_votes.filter(iv => mine.has(iv.bioguideId))
      .map(iv => ({ id: iv.bioguideId, name: mine.get(iv.bioguideId).name, position: iv.position || "Not recorded" })));
  }));
  if (request === positionsRequest) renderHome(stats, { reps, positions, participation, keyVotesOnly: true });
}

// The home page's address form (find your members) and "Change address".
// --- Follow (follow.js): Home's "Since you last looked" + the Follow buttons -----------
// Current data for every followed item: bills (1 read each, cached), members' voting records
// (1 read each, cached), topics from stats/overview (no extra read).
async function followedNow(stats) {
  const f = loadFollows();
  const topics = new Map((stats.topics_summary || []).map(t => [t.slug, t]));
  const [bills, members] = await Promise.all([
    Promise.all(Object.keys(f.bills).map(id => getBill(id).then(b => [id, b ? { id, ...b } : null]).catch(() => [id, null]))),
    Promise.all(Object.keys(f.members).map(id => getMemberVotes(id).then(r => [id, r]).catch(() => [id, null]))),
  ]);
  return { f, bills: new Map(bills), members: new Map(members), topics };
}

const things = n => `${n} thing${n === 1 ? "" : "s"}`;
let followsRequest = 0;
async function showFollows(stats) {
  const el = document.getElementById("home-follows");
  if (!el) return;
  if (!followCount()) {
    // A footnote to the cards above (pulled up into the section gap), not a section of its own.
    el.innerHTML = `<p class="-mt-8 text-xs text-gray-500">Tip: use <strong>Follow</strong> on a bill, a member or an Issues topic, and this page will show what changed since your last visit. Saved in this browser only.</p>`;
    return;
  }
  const request = ++followsRequest;
  const now = await followedNow(stats);
  if (request !== followsRequest) return;
  const { f } = now;
  const rows = [
    ...Object.entries(f.bills).map(([id, base]) => ({ kind: "bills", id, base, open: "bill", change: billChange(base, now.bills.get(id)) })),
    ...Object.entries(f.members).map(([id, base]) => ({ kind: "members", id, base, open: "member", change: memberChange(base, now.members.get(id)) })),
    ...Object.entries(f.topics).map(([id, base]) => ({ kind: "topics", id, base, href: `#issues/${id}`, change: topicChange(base, now.topics.get(id)) })),
  ];
  const changed = rows.filter(r => r.change);
  const link = r => (r.href ? `<a href="${escapeHtml(r.href)}" class="font-semibold text-accent hover:underline">${escapeHtml(r.base.label)}</a>`
    : `<button type="button" data-open="${r.open}" data-id="${escapeHtml(r.id)}" class="font-semibold text-accent hover:underline text-left">${escapeHtml(r.base.label)}</button>`);
  el.innerHTML = `
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 class="font-serif text-2xl font-bold text-gray-900">Since you last looked</h2>
        <p class="text-sm text-gray-500">${changed.length ? `${changed.length} of the ${things(rows.length)} you follow changed.` : `Nothing new for the ${things(rows.length)} you follow.`} Saved in this browser only.</p>
      </div>
      ${changed.length ? `<button type="button" data-follow-seen class="px-3 py-1.5 min-h-10 sm:min-h-0 rounded-lg text-xs font-semibold text-accent border border-accent/40 hover:bg-accent/10">Mark all as seen</button>` : ""}
    </div>
    ${changed.length ? `<ul class="mt-4 grid gap-3 md:grid-cols-2">${changed.map(r => `
      <li class="bg-surface border border-gray-200 rounded-xl p-4">
        <p class="text-[11px] uppercase tracking-wide text-gray-500">${{ bills: "Bill", members: "Member", topics: "Topic" }[r.kind]}</p>
        <p class="text-sm mt-0.5">${link(r)}</p>
        <p class="text-sm text-gray-800 mt-1">${escapeHtml(r.change.what)}</p>
        ${r.change.detail ? `<p class="text-xs text-gray-500 mt-0.5">${escapeHtml(r.change.detail)}</p>` : ""}
        ${r.change.votes?.length ? `<ul class="mt-1.5 space-y-1 text-xs text-gray-600">${r.change.votes.map(v => `<li><button type="button" data-open="vote" data-id="${escapeHtml(v.id)}" class="hover:underline text-left">${escapeHtml(v.headline)}</button>: <strong class="text-gray-800">${escapeHtml(v.position || "")}</strong></li>`).join("")}</ul>` : ""}
      </li>`).join("")}</ul>` : ""}
    <details class="mt-3 text-sm"><summary class="cursor-pointer text-accent">Everything you follow (${rows.length})</summary>
      <ul class="mt-2 divide-y divide-gray-200">${rows.map(r => `<li class="py-2 flex items-center justify-between gap-3"><span class="min-w-0">${link(r)}${r.change ? "" : ` <span class="text-xs text-gray-500">· no change</span>`}</span>${followButtonHtml(r.kind, r.id)}</li>`).join("")}</ul>
    </details>`;
}

// Follow / Unfollow anywhere (data-follow="bills|members|topics" data-id), and Home's
// "Mark all as seen" (baselines move up to the current data).
function setupFollow() {
  const refresh = (kind, id) => document.querySelectorAll(`[data-follow="${kind}"][data-id="${CSS.escape(id)}"]`).forEach(b => { b.outerHTML = followButtonHtml(kind, id); });
  const rerenderHome = async () => { const snap = await getOverviewDoc().catch(() => null); if (snap?.exists()) showFollows(snap.data()); };
  document.addEventListener("click", async ev => {
    if (ev.target.closest("[data-follow-seen]")) {
      const snap = await getOverviewDoc().catch(() => null);
      if (!snap?.exists()) return;
      const now = await followedNow(snap.data());
      for (const [id, b] of now.bills) if (b) setFollow("bills", id, billBaseline(b));
      for (const [id, r] of now.members) {
        const base = now.f.members[id];
        if (r) setFollow("members", id, { ...memberBaseline(null, r), label: base.label, chamber: base.chamber, state: base.state });
      }
      for (const [slug, t] of now.topics) if (now.f.topics[slug]) setFollow("topics", slug, topicBaseline(t));
      return showFollows(snap.data());
    }
    const btn = ev.target.closest("[data-follow]");
    if (!btn) return;
    const { follow: kind, id } = btn.dataset;
    if (isFollowing(kind, id)) setFollow(kind, id, null);
    else {
      btn.disabled = true;
      try {
        let base = null;
        if (kind === "bills") { const b = await getBill(id); base = billBaseline(b ? { id, ...b } : { id }); }
        else if (kind === "members") { const [m, rec] = await Promise.all([getMember(id).catch(() => null), getMemberVotes(id).catch(() => null)]); base = memberBaseline(m, rec); }
        else if (kind === "topics") { const t = (await getOverviewDoc()).data()?.topics_summary?.find(x => x.slug === id); if (t) base = topicBaseline(t); }
        if (!base) throw new Error("not available");
        if (!setFollow(kind, id, base)) { btn.textContent = `Limit: ${LIMITS[kind]}`; btn.disabled = false; return; }
      } catch {
        btn.textContent = "Try again";
        btn.disabled = false;
        return;
      }
    }
    refresh(kind, id);
    if (!document.getElementById("view-overview")?.classList.contains("hidden")) rerenderHome();
  });
}

// "Forget" (Home's members card, My members): removes the saved district and members from
// this browser (cw-reps), then redraws the page it was on.
function setupForgetReps() {
  document.addEventListener("click", async ev => {
    if (!ev.target.closest("[data-forget-reps]")) return;
    forgetMyReps();
    if (activeTab() === "mine") return loadMine();
    const snap = await getOverviewDoc().catch(() => null);
    if (snap?.exists()) showHome(snap.data());
  });
}

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
    loadCongressPage(snap.data());
    renderOverview(container, snap.data(), {
      // State tile -> that state's members in the directory.
      onState: code => {
        switchTab("members");
        setMemberFilters({ state: code, party: "", chamber: "", text: "" });
      },
    });
  } catch (err) {
    console.error("Error loading charts:", err);
    container.innerHTML = loadErrorHtml("the charts", err);
  }
}

// "This Congress so far": the displayed Congress and the two before it (3 small docs).
async function loadCongressPage(overview) {
  const el = document.getElementById("congress-container");
  const cur = overview.congress;
  try {
    const list = await Promise.all([cur, cur - 1, cur - 2].map(c => getFirestoreDoc("stats", `congress-${c}`).catch(() => null)));
    const docs = Object.fromEntries(list.map((d, i) => [cur - i, d]).filter(([, d]) => d));
    renderCongressPage(el, { docs, cur, overview });
  } catch (err) {
    console.error("Error loading This Congress:", err);
    el.innerHTML = loadErrorHtml("this page", err);
  }
}

// --- Data freshness: stats/health, written by both nightly syncs ---------------
const STALE_AFTER_MS = 36 * 3600 * 1000;   // syncs run daily; allow one missed-by-hours run

async function loadHealth() {
  try {
    const h = (await getHome()).health;
    if (!h) return;
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
  onTabOpen.mine = loadMine;
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
  setupMine();
  setupForgetReps();
  setupFollow();
  setupSearch();
  setupGlossary();
  const glossary = document.getElementById("glossary-list");
  if (glossary) glossary.innerHTML = glossaryHtml();
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
  navCongress.addEventListener("click", () => switchTab("charts"));
  navBills.addEventListener("click", () => switchTab("bills"));
  navVotes.addEventListener("click", () => switchTab("votes"));
  navMembers.addEventListener("click", () => switchTab("members"));
}

init();
