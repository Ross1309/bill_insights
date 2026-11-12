// Roll-Call Votes tab: paged votes, chamber filter, vote display helpers.
import { collection, getDocs, limit, orderBy, query, startAfter, where } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { billCache, db, voteCache } from "./data.js";
import { PARTY_NAMES, escapeHtml, formatVoteDate, ordinal, partyChip } from "./util.js";
import { billLabel } from "./bills.js";
import { setChipGroup } from "./members.js";

const votesContainer = document.getElementById("votes-container");
export let votesLoaded = false;

// --- Roll-call votes (schema written by netlify/functions/ingest-votes.js) ---

// --- Votes: newest first, cursor pagination (like bills) ---------------------
// Filtering by chamber while ordering by date needs the (chamber ASC, date DESC)
// index in firestore.indexes.json. If it's missing, fall back to paging all votes and
// filtering by chamber in the browser.

const VOTES_PAGE_SIZE = 10;
const FALLBACK_PAGE_SIZE = 30;
const votesMore = document.getElementById("votes-more");
 // every vote seen this session, by id
let voteChamber = "";
let voteIndexMissing = false;
const votesState = { items: [], cursor: null, exhausted: false, loading: false, generation: 0 };

function rememberVotes(list) {
  for (const v of list) voteCache.set(v.id, v);
}

async function queryVotes({ chamber = "", cursor = null, size }) {
  const useIndex = chamber && !voteIndexMissing;
  const constraints = [];
  if (useIndex) constraints.push(where("chamber", "==", chamber));
  constraints.push(orderBy("date", "desc"));
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(useIndex || !chamber ? size : FALLBACK_PAGE_SIZE));
  try {
    const snap = await getDocs(query(collection(db, "votes"), ...constraints));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    rememberVotes(docs);
    return {
      votes: chamber && !useIndex ? docs.filter(v => v.chamber === chamber) : docs,
      cursor: snap.docs.at(-1) || cursor,
      done: snap.docs.length < (useIndex || !chamber ? size : FALLBACK_PAGE_SIZE),
    };
  } catch (err) {
    if (err.code === "failed-precondition" && useIndex) {
      console.warn("Votes chamber index missing; filtering by chamber in the browser.", err.message);
      voteIndexMissing = true;
      return queryVotes({ chamber, cursor, size });
    }
    throw err;
  }
}

async function loadVotes({ reset = false } = {}) {
  const st = votesState;
  if (reset) {
    st.generation++;
    Object.assign(st, { items: [], cursor: null, exhausted: false, loading: false });
    votesContainer.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-accent border-t-transparent mb-4"></div>
        <p class="text-gray-500">Loading vote records...</p>
      </div>`;
    votesMore.innerHTML = "";
  }
  if (st.loading || st.exhausted) return;

  const generation = st.generation;
  st.loading = true;
  renderVotesMore();
  try {
    const page = [];
    while (page.length < VOTES_PAGE_SIZE && !st.exhausted) {
      const res = await queryVotes({ chamber: voteChamber, cursor: st.cursor, size: VOTES_PAGE_SIZE });
      if (generation !== st.generation) return;
      page.push(...res.votes);
      st.cursor = res.cursor;
      st.exhausted = res.done;
    }
    st.items.push(...page);
    st.loading = false;
    votesLoaded = true;
    renderVotes(st.items);
    renderVotesMore();
  } catch (err) {
    if (generation !== st.generation) return;
    st.loading = false;
    console.error("Error fetching votes:", err);
    votesContainer.innerHTML = `<p class="text-center text-red-500 py-12">Failed to load votes: ${escapeHtml(err.message)}</p>`;
    votesMore.innerHTML = "";
  }
}

export function fetchVotes() {
  return loadVotes({ reset: true });
}

function renderVotesMore() {
  const st = votesState;
  if (st.exhausted && !st.loading) {
    votesMore.innerHTML = st.items.length
      ? `<p class="text-xs text-gray-400">All ${st.items.length} synced ${voteChamber ? `${voteChamber} ` : ""}votes loaded.</p>`
      : "";
    return;
  }
  const oldest = st.items.at(-1)?.date;
  votesMore.innerHTML = `
    <button type="button" id="votes-load-more" ${st.loading ? "disabled" : ""}
      class="px-4 py-2 text-sm font-semibold rounded-lg bg-surface border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50 shadow-sm">
      ${st.loading ? "Loading…" : "Load older votes"}
    </button>
    ${oldest && !st.loading ? `<p class="text-xs text-gray-400 mt-2">Showing ${st.items.length} votes back to ${escapeHtml(new Date(oldest).toLocaleDateString(undefined, { dateStyle: "medium" }))}</p>` : ""}`;
  document.getElementById("votes-load-more")?.addEventListener("click", () => loadVotes());
}

const BILL_TYPE_SLUGS = {
  hr: "house-bill", s: "senate-bill", hres: "house-resolution", sres: "senate-resolution",
  hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution",
};

// Link a vote to its bill: our own bill card data when we have it,
// otherwise straight to Congress.gov.
export function voteBillInfo(vote) {
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

export const POSITION_GROUPS = { yea: "yea", aye: "yea", nay: "nay", no: "nay", present: "present", "not voting": "not_voting" };

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

export function resultBadgeClass(result) {
  const r = (result || "").toLowerCase();
  // Check the negative forms first: "Not Agreed to" also contains "agreed".
  if (/(failed|rejected|not agreed|not sustained|defeated)/.test(r)) return "bg-red-100 text-red-800";
  if (/(passed|agreed|adopted|confirmed|sustained|ratified)/.test(r)) return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-700";
}

export function voteTalliesHtml(vote) {
  const t = vote.tallies || {};
  const parties = partyBreakdown(vote.individual_votes);
  const tally = (label, value, cls) => `
    <div class="${cls} p-3 rounded-lg border text-center">
      <p class="text-xs font-semibold uppercase">${label}</p>
      <p class="text-xl font-bold">${Number.isFinite(value) ? value : "—"}</p>
    </div>`;
  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4">
      ${tally("Yea", t.yea, "bg-green-50 border-green-200 text-green-700")}
      ${tally("Nay", t.nay, "bg-red-50 border-red-200 text-red-700")}
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
              <td class="py-1">${partyChip(PARTY_NAMES[party] || party)}</td>
              <td class="py-1 text-right">${c.yea}</td><td class="py-1 text-right">${c.nay}</td>
              <td class="py-1 text-right">${c.present}</td><td class="py-1 text-right">${c.not_voting}</td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p class="text-xs text-gray-400">Member-level votes not available.</p>`}`;
}

// Bill reference for a vote: opens the bill modal (which also links out).
const SOURCE_LABELS = { House: "Official record (House Clerk)", Senate: "Official record (Senate.gov)" };
export const sourceLabel = vote => SOURCE_LABELS[vote.chamber] || "Official record";

export function voteBillLine(vote) {
  const bill = voteBillInfo(vote);
  if (!bill) {
    // Nominations (PN …) and other non-bill questions: show what was voted on.
    if (vote.legislation || vote.document_title) {
      return `<p class="text-sm text-gray-600 mt-1">${vote.legislation ? `<span class="font-semibold">${escapeHtml(vote.legislation)}</span>` : ""}${vote.legislation && vote.document_title ? " — " : ""}${escapeHtml(vote.document_title || "")}</p>`;
    }
    return `<p class="text-sm text-gray-400 mt-1">No bill associated with this vote</p>`;
  }
  return `
    <p class="text-sm text-gray-600 mt-1">
      <button type="button" data-open="bill" data-id="${escapeHtml(vote.bill_id)}" class="font-semibold text-accent hover:underline">${escapeHtml(bill.label)}</button>
      ${bill.title || vote.document_title ? ` — ${escapeHtml(bill.title || vote.document_title)}` : ""}
    </p>`;
}

export function voteHeadingBadge(vote) {
  return `${escapeHtml(vote.chamber || "House")} Roll Call #${escapeHtml(String(vote.roll_call_number ?? "?"))}${vote.session ? ` · Session ${escapeHtml(String(vote.session))}` : ""}`;
}

export function setupVoteFilters() {
  setChipGroup("vote-chamber-filters", "chamber", voteChamber);
  document.getElementById("vote-chamber-filters")?.addEventListener("click", e => {
    const b = e.target.closest("[data-chamber]");
    if (!b) return;
    voteChamber = b.dataset.chamber;
    setChipGroup("vote-chamber-filters", "chamber", voteChamber);
    fetchVotes();
  });
}

function renderVotes(votes) {
  if (votes.length === 0) {
    votesContainer.innerHTML = `<p class="text-center text-gray-500 py-12">No ${voteChamber ? `${voteChamber} ` : ""}roll-call votes have been synced yet.</p>`;
    return;
  }

  // Group under month headings so it's clear how far back the list goes.
  const monthOf = v => (v.date ? new Date(v.date).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Date not available");
  const groups = [];
  for (const v of votes) {
    const label = monthOf(v);
    if (groups.at(-1)?.label !== label) groups.push({ label, votes: [] });
    groups.at(-1).votes.push(v);
  }

  votesContainer.innerHTML = groups.map(g => `
    <h3 class="text-xs font-bold uppercase tracking-wide text-gray-500 mt-8 mb-3 first:mt-0">${escapeHtml(g.label)}</h3>
    <div class="space-y-6">
      ${g.votes.map(vote => `
        <div class="bg-surface border border-gray-200 rounded-xl p-6 shadow-sm">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-gray-100">
            <div>
              <span class="text-xs font-semibold px-2 py-0.5 rounded bg-accent/10 text-accent ring-1 ring-accent/30 uppercase">${voteHeadingBadge(vote)}</span>
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
            ${vote.individual_votes?.length ? `<button type="button" data-open="vote" data-id="${escapeHtml(vote.id)}" class="font-semibold text-accent hover:underline">How each member voted →</button>` : ""}
            ${vote.source_url ? `<a href="${escapeHtml(vote.source_url)}" target="_blank" rel="noopener" class="text-accent hover:underline">${escapeHtml(sourceLabel(vote))} →</a>` : ""}
          </div>
        </div>`).join("")}
    </div>`).join("");
}
