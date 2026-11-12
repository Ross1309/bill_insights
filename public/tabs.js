// Tab bar. Modules register what to load the first time their tab opens (onTabOpen).

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

// Each tab's loader, called every time it's shown (loaders skip work already done).
export const onTabOpen = {};

const TAB_BASE = "nav-tab py-3.5 text-sm sm:text-base font-semibold whitespace-nowrap border-b-2 focus:outline-none focus-visible:text-gray-900";
const TAB_ACTIVE = `${TAB_BASE} text-gray-900 border-pink`;
const TAB_IDLE = `${TAB_BASE} text-gray-500 border-transparent hover:text-gray-800`;

export function switchTab(tabName) {
  const tabs = { overview: [navOverview, viewOverview], issues: [navIssues, viewIssues], bills: [navBills, viewBills], votes: [navVotes, viewVotes], members: [navMembers, viewMembers] };
  for (const [name, [nav, view]] of Object.entries(tabs)) {
    const active = name === tabName;
    nav.className = active ? TAB_ACTIVE : TAB_IDLE;
    nav.setAttribute("aria-selected", String(active));
    view.classList.toggle("hidden", !active);
  }
  onTabOpen[tabName]?.();
  // If the sticky tab bar is pinned (scrolled past the header), start the new tab
  // at its top instead of mid-way down.
  // (The bar sits right under the header, so the header's height is where it pins.)
  const barTop = document.querySelector("body > header")?.offsetHeight || 0;
  if (window.scrollY > barTop) window.scrollTo({ top: barTop });
}
