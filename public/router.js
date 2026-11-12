// Shareable links. The URL hash mirrors what's on screen, and browser Back/Forward
// work:
//   (no hash) / #overview      Overview
//   #issues/<topic>            Issues tab on a topic (economy, healthcare, foreign-affairs)
//   #bills  #votes             those tabs
//   #legislators/<WA|WA-7|all> Legislators for a state, "your representatives" for a
//                              district, or every state
//   #methodology               "How we count" (a page with no tab-bar button)
//   #bill/<id>  #member/<id>  #vote/<id>   a detail on top of the current tab
//
// Each tab switch or detail opened by the visitor pushes a history entry; filter
// changes inside a tab (topic, state) replace the current one. Modules register how
// to show a tab argument (onTabArg) and what their current argument is (tabArg).

const TAB_URL = { overview: "overview", issues: "issues", bills: "bills", votes: "votes", members: "legislators", methodology: "methodology" };
const URL_TAB = Object.fromEntries(Object.entries(TAB_URL).map(([tab, url]) => [url, tab]));
const DETAIL_KINDS = new Set(["bill", "member", "vote"]);

// Filled in by modules at startup.
export const tabArg = {};      // tab -> () => current argument (string) or ""
export const onTabArg = {};    // tab -> arg => show it
const handlers = { showTab: null, showDetail: null, closeDetails: null };
export function setRouteHandlers(h) { Object.assign(handlers, h); }

// "#bill/hr1-119" -> { kind: "bill", id }, "#issues/economy" -> { tab, arg }.
export function parseHash(hash = location.hash) {
  const [head, ...rest] = decodeURIComponent(hash.replace(/^#\/?/, "")).split("/");
  const arg = rest.join("/");
  if (DETAIL_KINDS.has(head) && arg) return { kind: head, id: arg };
  return { tab: URL_TAB[head] || "overview", arg };
}

export function tabHash(tab) {
  if (tab === "overview") return "";
  const arg = tabArg[tab]?.() || "";
  return `#${TAB_URL[tab]}${arg ? `/${encodeURIComponent(arg).replace(/%2F/g, "/")}` : ""}`;
}
export const detailHash = (kind, id) => `#${kind}/${encodeURIComponent(id)}`;

// Absolute link for sharing (no hash = Overview).
export const shareUrl = hash => `${location.origin}${location.pathname}${hash || ""}`;

const current = () => location.hash || "";
let lastTabHash = "";   // where closing all details returns to

// How many details on screen have their own history entry (we pushed them). Stored in
// each entry's state too, so the browser's Back/Forward restore it. Details opened from
// a pasted link have none, so closing them replaces the URL instead.
let pushedDetails = 0;

export function pushTab(tab) {
  const h = tabHash(tab);
  lastTabHash = h;
  pushedDetails = 0;
  if (h !== current()) history.pushState({ tab }, "", h || location.pathname + location.search);
}

// Filter change within a tab: update the URL without a new history entry.
export function replaceTab(tab) {
  const h = tabHash(tab);
  lastTabHash = h;
  if (h !== current() && !parseHash().kind) history.replaceState({ tab }, "", h || location.pathname + location.search);
}

export function pushDetail(kind, id) {
  const h = detailHash(kind, id);
  if (h === current()) return;
  pushedDetails++;
  history.pushState({ detailDepth: pushedDetails }, "", h);
}

// The visitor pressed the modal's Back arrow.
export function backDetail() {
  if (pushedDetails > 0) { pushedDetails--; history.back(); return true; }
  return false;   // detail opened from a pasted link: no history to go back through
}

// ✕ / Escape / backdrop: close every detail (`depth` = how many are open).
export function closeAllDetails(depth) {
  if (pushedDetails > 0 && pushedDetails === depth) {
    const n = pushedDetails;
    pushedDetails = 0;
    history.go(-n);       // popstate then closes the details
    return true;
  }
  pushedDetails = 0;
  history.replaceState({}, "", lastTabHash || location.pathname + location.search);
  return false;           // caller closes them itself
}

function apply(route) {
  if (route.kind) {
    handlers.showDetail?.(route.kind, route.id);
    return;
  }
  handlers.closeDetails?.();
  // Argument first, so the tab's first load already uses it (#issues/healthcare
  // shouldn't load the remembered topic and then switch).
  if (route.arg) onTabArg[route.tab]?.(route.arg);
  handlers.showTab?.(route.tab);
  lastTabHash = tabHash(route.tab);
}

// Call once after every module has registered.
export function startRouter() {
  addEventListener("popstate", () => {
    pushedDetails = history.state?.detailDepth || 0;
    apply(parseHash());
  });
  const route = parseHash();
  if (route.kind) {
    // Pasted link to a detail: show it over the Overview.
    handlers.showTab?.("overview");
    handlers.showDetail?.(route.kind, route.id);
  } else {
    apply(route);
  }
}
