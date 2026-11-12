// Tab bar. Modules register what to load the first time their tab opens (onTabOpen).
import { pushTab } from "./router.js";

// Tab Navigation Elements
export const navOverview = document.getElementById("nav-overview");
export const navIssues = document.getElementById("nav-issues");
export const navBills = document.getElementById("nav-bills");
export const navVotes = document.getElementById("nav-votes");
export const navMembers = document.getElementById("nav-members");

const viewOverview = document.getElementById("view-overview");
const viewIssues = document.getElementById("view-issues");
const viewBills = document.getElementById("view-bills");
const viewVotes = document.getElementById("view-votes");
const viewMembers = document.getElementById("view-members");
const viewMethodology = document.getElementById("view-methodology");   // no tab-bar button
const viewWeek = document.getElementById("view-week");                 // no tab-bar button (#week/<Monday>)
const viewCharts = document.getElementById("view-charts");             // no tab-bar button (#charts)

// Each tab's loader, called every time it's shown (loaders skip work already done).
export const onTabOpen = {};

// Which tab is showing (for modules that only update the URL while they're visible).
export const activeTab = () => Object.entries({ overview: viewOverview, issues: viewIssues, bills: viewBills, votes: viewVotes, members: viewMembers, methodology: viewMethodology, week: viewWeek, charts: viewCharts })
  .find(([, v]) => v && !v.classList.contains("hidden"))?.[0] || "overview";

const TAB_BASE = "nav-tab py-3.5 text-sm sm:text-base font-semibold whitespace-nowrap border-b-2 focus:outline-none focus-visible:text-gray-900";
const TAB_ACTIVE = `${TAB_BASE} text-gray-900 border-pink`;
const TAB_IDLE = `${TAB_BASE} text-gray-500 border-transparent hover:text-gray-800`;

// `push`: record it in browser history / the URL (false when the router is applying
// a URL, e.g. Back/Forward or a pasted link).
export function switchTab(tabName, { push = true } = {}) {
  const tabs = { overview: [navOverview, viewOverview], issues: [navIssues, viewIssues], bills: [navBills, viewBills], votes: [navVotes, viewVotes], members: [navMembers, viewMembers], methodology: [null, viewMethodology], week: [null, viewWeek], charts: [null, viewCharts] };
  for (const [name, [nav, view]] of Object.entries(tabs)) {
    const active = name === tabName;
    if (nav) {
      nav.className = active ? TAB_ACTIVE : TAB_IDLE;
      nav.setAttribute("aria-selected", String(active));
    }
    view?.classList.toggle("hidden", !active);
  }
  // History first: a loader may update the URL in place (Issues writes its topic), and
  // doing that before the push would overwrite the *previous* tab's history entry.
  if (push) pushTab(tabName);
  onTabOpen[tabName]?.();
  // If the sticky tab bar is pinned (scrolled past the header), start the new tab
  // at its top instead of mid-way down.
  // (The bar sits right under the header, so the header's height is where it pins.)
  const barTop = document.querySelector("body > header")?.offsetHeight || 0;
  if (window.scrollY > barTop) window.scrollTo({ top: barTop });
}
