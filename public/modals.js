// Detail modals: member / bill / vote, with a back stack.
// Anything with data-open="member|bill|vote" data-id="…" opens one, so you can go
// vote -> member -> bill and back. Server data (Congress.gov via Netlify functions)
// is optional: if it fails, the modal still shows Firestore data plus a Retry button.
import { fetchFunction, getBill, getFirestoreDoc, getMember, getVote, getVotesForBill } from "./data.js";
import { PARTY_BADGES, PARTY_NAMES, PARTY_TEXT, POSITION_BADGES, STATE_NAMES, errorBlock, escapeHtml, externalLink, factList, formatVoteDate, memberLink, ordinal, spinner } from "./util.js";
import { SUMMARY_SOURCE_LABELS, billLabel, noSummaryText } from "./bills.js";
import { POSITION_GROUPS, resultBadgeClass, sourceLabel, voteBillInfo, voteBillLine, voteHeadingBadge, voteTalliesHtml } from "./votes.js";
import { memberPhoto, memberRole } from "./members.js";
import { renderFinanceTab } from "./finance.js";
import { backDetail, closeAllDetails, detailHash, pushDetail, setRouteHandlers } from "./router.js";

const modalRoot = document.getElementById("modal-root");
let modalStack = [];
 // entries: { kind, id, tab, data: {}, errors: {}, filter: {} }
let lastFocused = null;

// Vote doc id for an action's recorded vote, matching ingest-votes.js.
function recordedVoteId(rv) {
  const chamber = { House: "house", Senate: "senate" }[rv.chamber];
  if (!chamber || !rv.congress || !rv.session || !rv.rollNumber) return null;
  return `${rv.congress}-${rv.session}-${chamber}-vote-${rv.rollNumber}`;
}

const memberModal = {
  load(e) {
    loadInto(e, "member", getMember(e.id));
    loadInto(e, "profile", fetchFunction("member-profile", e.id));
    loadInto(e, "record", getFirestoreDoc("member_votes", e.id));
    if (e.financeRequested) loadInto(e, "finance", fetchFunction("member-finance", e.id)); // Retry
  },
  header(e) {
    const m = e.data.member, p = e.data.profile;
    const name = p?.name || m?.name || (e.errors.member || m === null ? "Member" : "Loading…");
    const shown = m || (p ? { name, party: p.party, imageUrl: p.imageUrl } : { name });
    return `
      ${memberPhoto(shown)}
      <div class="min-w-0 flex-1">
        ${shown.party ? `<span class="text-xs font-semibold px-2 py-0.5 rounded ${PARTY_BADGES[shown.party] || "bg-gray-100 text-gray-800"}">${escapeHtml(shown.party)}</span>` : ""}
        <h2 id="modal-title" class="font-serif text-2xl font-bold text-gray-900 mt-1">${escapeHtml(name)}</h2>
        ${m ? `<p class="text-sm text-gray-500">${escapeHtml(memberRole(m))} · ${escapeHtml(STATE_NAMES[m.state] || m.state || "")}</p>` : ""}
      </div>`;
  },
  tabs: [
    ["overview", "Overview", e => {
      const m = e.data.member, p = e.data.profile;
      if (!m && !p) {
        if (e.errors.member && e.errors.profile) return errorBlock(e.errors.profile);
        if (e.data.member === null && e.errors.profile) return errorBlock(e.errors.profile);
        return spinner("Loading member…");
      }
      const facts = [];
      if (p?.leadership?.length) facts.push(["Leadership", p.leadership.join(", ")]);
      if (m) facts.push(["Role", memberRole(m)], ["State", STATE_NAMES[m.state] || m.state], ["Party", m.party]);
      if (p) facts.push(["First took office", p.firstTermStart], ["Born", p.birthYear], ["Office", p.office?.address], ["Phone", p.office?.phone]);
      if (m && m.current === false) facts.push(["Status", "No longer serving"]);
      return `
        ${factList(facts)}
        ${p ? `
          <div class="grid grid-cols-2 gap-3 mt-4">
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center"><p class="text-xs text-gray-500 uppercase font-semibold">Bills sponsored</p><p class="text-xl font-bold text-gray-900">${p.sponsoredCount ?? "—"}</p></div>
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center"><p class="text-xs text-gray-500 uppercase font-semibold">Bills cosponsored</p><p class="text-xl font-bold text-gray-900">${p.cosponsoredCount ?? "—"}</p></div>
          </div>
          <p class="text-[11px] text-gray-400 mt-1">Career totals, including amendments, per Congress.gov.</p>
          <div class="flex flex-wrap gap-4 mt-4 text-sm">${externalLink(p.website, "Official website")} ${externalLink(p.bioguideUrl, "Congressional biography")}</div>`
        : e.errors.profile ? errorBlock(e.errors.profile) : spinner("Loading details from Congress.gov…")}`;
    }],
    ["votes", "Voting Record", e => {
      // Precomputed per member (netlify/lib/member-votes.js): totals over every
      // roll call this Congress + the latest 50 votes.
      if (e.errors.record) return `<p class="text-sm text-red-600 py-8 text-center">Failed to load votes: ${escapeHtml(e.errors.record)}</p>`;
      if (e.data.record === undefined) return spinner("Loading votes…");
      const r = e.data.record;
      if (!r || !r.totals?.votes) {
        return `<p class="text-sm text-gray-500 py-8 text-center">No recorded roll-call votes for this member in the current Congress yet.</p>`;
      }
      const t = r.totals;
      const cast = t.yea + t.nay + t.present;
      const stat = (label, value, cls) => `<div class="${cls} border rounded-lg p-2 text-center"><p class="text-[11px] font-semibold uppercase">${label}</p><p class="text-lg font-bold tabular-nums">${value}</p></div>`;
      return `
        <p class="text-sm text-gray-800">In the ${escapeHtml(ordinal(r.congress))} Congress, voted on <strong>${cast} of ${t.votes}</strong> ${escapeHtml(r.chamber || "")} roll calls they were eligible for (${Math.round((cast / t.votes) * 100)}%).</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          ${stat("Yea", t.yea, "bg-green-50 border-green-200 text-green-700")}
          ${stat("Nay", t.nay, "bg-red-50 border-red-200 text-red-700")}
          ${stat("Present", t.present, "bg-gray-50 border-gray-200 text-gray-700")}
          ${stat("Not voting", t.not_voting, "bg-yellow-50 border-yellow-100 text-yellow-800")}
        </div>
        ${t.party_comparable ? `<p class="text-sm text-gray-700 mt-3">Voted with the majority of their party on <strong>${t.with_party} of ${t.party_comparable}</strong> votes where they voted Yea or Nay (${Math.round((t.with_party / t.party_comparable) * 100)}%).</p>` : ""}
        <p class="text-xs text-gray-500 mt-3">Counts cover every recorded vote this Congress, from the House Clerk and senate.gov. Below: the latest ${r.recent.length}.</p>
        <ul class="mt-2 divide-y divide-gray-100">
          ${r.recent.map(v => {
            const bill = voteBillInfo(v);
            return `
            <li class="py-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <button type="button" data-open="vote" data-id="${escapeHtml(v.id)}" class="text-sm font-semibold text-gray-900 hover:text-accent-light hover:underline text-left">${escapeHtml(v.question || "Question not available")}</button>
                <p class="text-xs text-gray-500 mt-0.5">
                  Roll call #${escapeHtml(String(v.roll ?? "?"))} · ${escapeHtml(formatVoteDate(v.date))}
                  ${bill ? ` · <button type="button" data-open="bill" data-id="${escapeHtml(v.bill_id)}" class="text-accent hover:underline">${escapeHtml(bill.label)}</button>` : v.legislation ? ` · ${escapeHtml(v.legislation)}` : ""}
                  · ${escapeHtml(v.result || "Result pending")}
                </p>
                ${v.party_majority && v.group !== v.party_majority ? `<p class="text-[11px] text-gray-500 mt-0.5">Voted differently from most of their party</p>` : ""}
              </div>
              <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded ${POSITION_BADGES[v.group] || "bg-gray-100 text-gray-700"}">${escapeHtml(v.position || "Not recorded")}</span>
            </li>`;
          }).join("")}
        </ul>`;
    }],
    ["legislation", "Legislation", e => {
      const p = e.data.profile;
      if (e.errors.profile) return errorBlock(e.errors.profile);
      if (!p) return spinner("Loading sponsored legislation…");
      if (!p.sponsored) return errorBlock("Sponsored legislation is unavailable right now.");
      if (!p.sponsored.length) return `<p class="text-sm text-gray-500 py-8 text-center">No sponsored legislation found.</p>`;
      return `
        <p class="text-xs text-gray-500 mb-3">${p.sponsored.length} most recent of ${p.sponsoredCount ?? "?"} sponsored bills and amendments, from Congress.gov.</p>
        <ul class="divide-y divide-gray-100">
          ${p.sponsored.map(item => `
            <li class="py-3">
              <div class="flex flex-wrap items-center gap-2 text-xs">
                ${item.kind === "bill" && item.bill_id
                  ? `<button type="button" data-open="bill" data-id="${escapeHtml(item.bill_id)}" class="font-semibold text-accent hover:underline">${escapeHtml(item.label)}</button>`
                  : item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="font-semibold text-accent hover:underline">${escapeHtml(item.label)}</a>`
                  : `<span class="font-semibold">${escapeHtml(item.label)}</span>`}
                ${item.introducedDate ? `<span class="text-gray-400">Introduced ${escapeHtml(item.introducedDate)}</span>` : ""}
                ${item.policyArea ? `<span class="text-gray-500">· ${escapeHtml(item.policyArea)}</span>` : ""}
              </div>
              ${item.title ? `<p class="text-sm text-gray-900 mt-1">${escapeHtml(item.title)}</p>` : ""}
              ${item.latestAction?.text ? `<p class="text-xs text-gray-500 mt-1"><strong class="text-gray-600">Latest action${item.latestAction.actionDate ? ` (${escapeHtml(item.latestAction.actionDate)})` : ""}:</strong> ${escapeHtml(item.latestAction.text)}</p>` : ""}
            </li>`).join("")}
        </ul>`;
    }],
    ["money", "Campaign Finance", renderFinanceTab],
  ],
};

// --- bill

const billModal = {
  load(e) {
    loadInto(e, "bill", getBill(e.id));
    loadInto(e, "detail", fetchFunction("bill-detail", e.id));
    loadInto(e, "votes", getVotesForBill(e.id));
  },
  header(e) {
    const b = e.data.bill, d = e.data.detail;
    const label = b ? billLabel(b) : d?.bill_number || e.id.toUpperCase();
    const title = b?.title || d?.title || (e.errors.detail ? "" : "Loading…");
    const policy = b?.policy_area || d?.policy_area;
    const congress = b?.congress || d?.congress;
    return `
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="bg-accent/10 text-accent font-semibold ring-1 ring-accent/30 px-2 py-0.5 rounded uppercase">${escapeHtml(label)}</span>
          ${congress ? `<span class="text-gray-500">${escapeHtml(ordinal(Number(congress)))} Congress</span>` : ""}
          ${policy ? `<span class="text-gray-500">· ${escapeHtml(policy)}</span>` : ""}
        </div>
        <h2 id="modal-title" class="font-serif text-xl font-bold text-gray-900 mt-1">${escapeHtml(title || label)}</h2>
      </div>`;
  },
  tabs: [
    ["summary", "Summary", e => {
      const b = e.data.bill, d = e.data.detail;
      const bill = b || d;
      if (!bill) return e.errors.detail ? errorBlock(e.errors.detail) : spinner("Loading bill…");
      const sponsor = d?.sponsor;
      const latest = bill.latestAction;
      const facts = [
        ["Sponsor", sponsor ? memberLink(sponsor.bioguideId, sponsor.label || sponsor.name) : null, true],
        ["Cosponsors", d?.cosponsorsCount],
        ["Introduced", bill.introduced_date],
        ["Origin chamber", bill.chamber],
        ["Policy area", bill.policy_area || (d ? "Not yet assigned by CRS" : null)],
        ["Latest action", latest?.text ? `${latest.actionDate ? `${escapeHtml(latest.actionDate)}: ` : ""}${escapeHtml(latest.text)}` : null, true],
      ];
      const ai = b?.ai_summary?.bullet_points?.length ? `
        <section class="mt-5">
          <h3 class="text-sm font-bold text-gray-900">Plain-language summary</h3>
          <ul class="list-disc pl-5 space-y-1 text-gray-700 text-sm mt-2">${b.ai_summary.bullet_points.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
          <p class="text-[11px] text-gray-400 mt-1">${escapeHtml(SUMMARY_SOURCE_LABELS[b.ai_summary.source] || "AI-generated summary")}</p>
        </section>`
        : `<p class="text-xs text-gray-400 mt-5">${b ? escapeHtml(noSummaryText(b)) : "No plain-language summary: this bill hasn't been synced to Congress Watcher."}</p>`;
      const crs = d?.crsSummary ? `
        <section class="mt-5">
          <h3 class="text-sm font-bold text-gray-900">Official summary <span class="font-normal text-gray-500">(Congressional Research Service${d.crsSummary.version ? `, ${escapeHtml(d.crsSummary.version)}` : ""})</span></h3>
          <details class="mt-2 group">
            <summary class="text-sm text-gray-700 cursor-pointer list-none">
              <span class="group-open:hidden">${escapeHtml(d.crsSummary.text.slice(0, 280))}${d.crsSummary.text.length > 280 ? "… <span class=\"text-accent\">Read more</span>" : ""}</span>
              <span class="hidden group-open:inline text-accent">Show less</span>
            </summary>
            <p class="text-sm text-gray-700 mt-2 whitespace-pre-line">${escapeHtml(d.crsSummary.text)}</p>
          </details>
        </section>`
        : d ? `<p class="text-xs text-gray-400 mt-3">No official CRS summary yet.</p>`
        : e.errors.detail ? errorBlock(e.errors.detail) : spinner("Loading sponsor and official summary…");
      return `
        ${factList(facts)}
        ${ai}
        ${crs}
        <div class="flex flex-wrap gap-4 mt-5 text-sm">${externalLink(bill.congress_gov_url, "View on Congress.gov")}</div>`;
    }],
    ["actions", "Actions", e => {
      const d = e.data.detail;
      if (e.errors.detail) return errorBlock(e.errors.detail);
      if (!d) return spinner("Loading actions…");
      if (!d.actions) return errorBlock("The action history is unavailable right now.");
      if (!d.actions.length) return `<p class="text-sm text-gray-500 py-8 text-center">No actions recorded yet.</p>`;
      return `
        <p class="text-xs text-gray-500 mb-3">${d.actions.length} actions, newest first, from Congress.gov.</p>
        <ol class="relative border-l border-gray-200 ml-2">
          ${d.actions.map(a => `
            <li class="ml-4 pb-4">
              <span class="absolute -left-1.5 mt-1.5 w-3 h-3 rounded-full bg-accent/60 border border-surface"></span>
              <p class="text-xs text-gray-500">${escapeHtml(a.actionDate || "")}${a.source ? ` · ${escapeHtml(a.source)}` : ""}</p>
              <p class="text-sm text-gray-800">${escapeHtml(a.text)}</p>
              ${a.recordedVotes.map(rv => {
                const id = recordedVoteId(rv);
                return `<span class="inline-flex flex-wrap gap-x-3 mr-3">
                  ${id ? `<button type="button" data-open="vote" data-id="${escapeHtml(id)}" class="text-xs font-semibold text-accent hover:underline">${escapeHtml(rv.chamber || "")} roll call #${escapeHtml(String(rv.rollNumber))}: how members voted →</button>` : ""}
                  ${rv.url ? `<a href="${escapeHtml(rv.url)}" target="_blank" rel="noopener" class="text-xs text-gray-500 hover:underline">official record</a>` : ""}
                </span>`;
              }).join("")}
            </li>`).join("")}
        </ol>`;
    }],
    ["votes", "Votes", e => {
      if (e.errors.votes) return `<p class="text-sm text-red-600 py-8 text-center">Failed to load votes: ${escapeHtml(e.errors.votes)}</p>`;
      if (!e.data.votes) return spinner("Loading votes…");
      if (!e.data.votes.length) {
        return `<p class="text-sm text-gray-500 py-8 text-center">No roll-call votes on this bill have been synced. Check the Actions tab for recorded votes.</p>`;
      }
      return `
        <ul class="divide-y divide-gray-100">
          ${e.data.votes.map(v => `
            <li class="py-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <button type="button" data-open="vote" data-id="${escapeHtml(v.id)}" class="text-sm font-semibold text-gray-900 hover:text-accent-light hover:underline text-left">${escapeHtml(v.question || "Question not available")}</button>
                <p class="text-xs text-gray-500 mt-0.5">Roll call #${escapeHtml(String(v.roll_call_number ?? "?"))} · ${escapeHtml(formatVoteDate(v.date))} · Yea ${v.tallies?.yea ?? "—"}, Nay ${v.tallies?.nay ?? "—"}</p>
              </div>
              <span class="shrink-0 text-xs font-bold px-2 py-0.5 rounded ${resultBadgeClass(v.result)}">${escapeHtml(v.result || "Result pending")}</span>
            </li>`).join("")}
        </ul>`;
    }],
  ],
};

// --- vote

const POSITION_ORDER = ["yea", "nay", "present", "not_voting", "other"];
const POSITION_HEADINGS = { yea: "Yea", nay: "Nay", present: "Present", not_voting: "Not voting", other: "Other" };

function voteMemberListHtml(e) {
  const vote = e.data.vote;
  const f = e.filter;
  const term = (f.text || "").trim().toLowerCase();
  // A bare state code ("wa") filters by state; anything else matches names.
  const stateCode = STATE_NAMES[term.toUpperCase()] ? term.toUpperCase() : null;
  const rows = (vote.individual_votes || []).filter(v =>
    (!f.party || v.party === f.party) &&
    (!term || (stateCode ? v.state === stateCode : (v.name || "").toLowerCase().includes(term))));
  const groups = {};
  for (const v of rows) {
    const g = POSITION_GROUPS[(v.position || "").toLowerCase()] || "other";
    (groups[g] ??= []).push(v);
  }
  if (!rows.length) return `<p class="text-sm text-gray-500 py-6 text-center">No members match.</p>`;
  return POSITION_ORDER.filter(g => groups[g]).map(g => `
    <section class="mt-4">
      <h3 class="text-xs font-bold uppercase text-gray-500">${POSITION_HEADINGS[g]} <span class="font-normal">(${groups[g].length})</span></h3>
      <ul class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        ${groups[g].sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(v => `
          <li class="py-1 text-sm flex items-center justify-between gap-2 border-b border-gray-50">
            ${memberLink(v.bioguideId, v.name || v.bioguideId || "Unknown")}
            <span class="text-xs shrink-0 ${PARTY_TEXT[v.party] || "text-gray-500"}">${escapeHtml(v.party || "?")}-${escapeHtml(v.state || "?")}</span>
          </li>`).join("")}
      </ul>
    </section>`).join("");
}

const voteModal = {
  load(e) {
    loadInto(e, "vote", getVote(e.id));
  },
  header(e) {
    const v = e.data.vote;
    if (!v) {
      return `<div class="min-w-0 flex-1"><h2 id="modal-title" class="font-serif text-xl font-bold text-gray-900">${e.data.vote === null ? "Vote not synced" : "Loading vote…"}</h2></div>`;
    }
    return `
      <div class="min-w-0 flex-1">
        <span class="text-xs font-semibold px-2 py-0.5 rounded bg-accent/10 text-accent ring-1 ring-accent/30 uppercase">${voteHeadingBadge(v)}</span>
        <h2 id="modal-title" class="font-serif text-xl font-bold text-gray-900 mt-1">${escapeHtml(v.question || "Question not available")}</h2>
        <p class="text-sm text-gray-500 mt-0.5">
          <span class="inline-block px-2 py-0.5 text-xs font-bold rounded ${resultBadgeClass(v.result)}">${escapeHtml(v.result || "Result pending")}</span>
          ${escapeHtml(formatVoteDate(v.date))}
        </p>
      </div>`;
  },
  tabs: [
    ["results", "Results", e => {
      const v = e.data.vote;
      if (e.errors.vote) return `<p class="text-sm text-red-600 py-8 text-center">Failed to load vote: ${escapeHtml(e.errors.vote)}</p>`;
      if (v === undefined) return spinner("Loading vote…");
      if (v === null) return `<p class="text-sm text-gray-500 py-8 text-center">This roll call hasn't been synced yet. Only the most recent House and Senate votes are stored so far.</p>`;
      return `
        ${voteBillLine(v)}
        ${v.vote_type ? `<p class="text-xs text-gray-400 mt-1">${escapeHtml(v.vote_type)}</p>` : ""}
        ${voteTalliesHtml(v)}
        <div class="flex flex-wrap gap-4 mt-4 text-sm">${externalLink(v.source_url, sourceLabel(v))}</div>`;
    }],
    ["members", "How members voted", e => {
      const v = e.data.vote;
      if (!v) return voteModal.tabs[0][2](e);
      if (!v.individual_votes?.length) return `<p class="text-sm text-gray-500 py-8 text-center">Member-level votes not available.</p>`;
      const parties = [...new Set(v.individual_votes.map(x => x.party).filter(Boolean))].sort();
      return `
        <div class="flex flex-wrap gap-2">
          <input type="search" data-vote-filter="text" value="${escapeHtml(e.filter.text || "")}" placeholder="Filter by name or state (e.g. WA)"
            class="flex-1 min-w-[12rem] px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" />
          <select data-vote-filter="party" class="px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-surface">
            <option value="">All parties</option>
            ${parties.map(p => `<option value="${escapeHtml(p)}"${e.filter.party === p ? " selected" : ""}>${escapeHtml(PARTY_NAMES[p] || p)}</option>`).join("")}
          </select>
        </div>
        <div data-vote-members>${voteMemberListHtml(e)}</div>`;
    }],
  ],
};

// --- modal shell

const MODAL_KINDS = { member: memberModal, bill: billModal, vote: voteModal };

export function loadInto(entry, key, promise) {
  delete entry.errors[key];
  Promise.resolve(promise)
    .then(value => { entry.data[key] = value ?? null; })
    .catch(err => { console.error(`Modal load ${entry.kind}/${key}:`, err); entry.errors[key] = err.message; })
    .finally(() => { if (modalStack.at(-1) === entry) renderModal(); });
}

// `push`: add a history entry (the visitor opened it). The router passes false when
// it's showing a detail from the URL (pasted link, Back/Forward).
function openModal(kind, id, { push = true } = {}) {
  const def = MODAL_KINDS[kind];
  if (!def || !id) return;
  const top = modalStack.at(-1);
  if (top && top.kind === kind && top.id === id) return;
  if (push) pushDetail(kind, id);
  if (!modalStack.length) lastFocused = document.activeElement;
  const entry = { kind, id, tab: def.tabs[0][0], data: {}, errors: {}, filter: {} };
  modalStack.push(entry);
  renderModal();
  document.body.classList.add("overflow-hidden");
  modalRoot.querySelector("[data-close]")?.focus();
  def.load(entry);
}

function closeModals() {
  modalStack = [];
  modalRoot.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
  lastFocused?.focus?.();
}

// The router's view of details: show this one (popping back to it if it's already
// on the stack, e.g. after the browser's Back button), or close them all.
function showModalFromRoute(kind, id) {
  const i = modalStack.findIndex(e => e.kind === kind && e.id === id);
  if (i === -1) return openModal(kind, id, { push: false });
  if (i === modalStack.length - 1) return;
  modalStack = modalStack.slice(0, i + 1);
  renderModal();
  modalRoot.querySelector("[data-close]")?.focus();
}

// User actions: go through browser history when we pushed entries for these details.
const userClose = () => { if (!closeAllDetails(modalStack.length)) closeModals(); };
const userBack = () => { if (!backDetail()) backModal(); };

function backModal() {
  modalStack.pop();
  if (!modalStack.length) return closeModals();
  renderModal();
  modalRoot.querySelector("[data-close]")?.focus();
}

function renderModal() {
  const e = modalStack.at(-1);
  if (!e) return;
  const def = MODAL_KINDS[e.kind];
  // Keep scroll when data arrives for the same entry + tab; reset otherwise.
  const panel = modalRoot.querySelector("[data-panel]");
  const sameView = panel && panel.dataset.view === `${modalStack.length}:${e.kind}:${e.id}:${e.tab}`;
  const scrollTop = sameView ? panel.scrollTop : 0;
  const [, , renderTab] = def.tabs.find(([key]) => key === e.tab);

  modalRoot.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 p-0 sm:p-6" data-backdrop>
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title"
        class="bg-surface w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[90vh] sm:rounded-2xl shadow-xl flex flex-col">
        <div class="shrink-0 flex items-start gap-4 p-5 border-b border-gray-200">
          ${modalStack.length > 1 ? `<button type="button" data-back aria-label="Back" class="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-accent">←</button>` : ""}
          ${def.header(e)}
          <button type="button" data-copy-link="${escapeHtml(detailHash(e.kind, e.id))}" class="shrink-0 mt-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-accent border border-accent/40 hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent">Copy link</button>
          <button type="button" data-close aria-label="Close" class="p-2 rounded-lg text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-accent">✕</button>
        </div>
        <div role="tablist" class="shrink-0 flex gap-4 px-5 border-b border-gray-200 overflow-x-auto">
          ${def.tabs.map(([key, label]) => `
            <button type="button" role="tab" data-tab="${key}" aria-selected="${key === e.tab}"
              class="py-3 text-sm font-semibold whitespace-nowrap border-b-2 ${key === e.tab ? "text-gray-900 border-pink" : "text-gray-500 border-transparent hover:text-gray-700"}">${label}</button>`).join("")}
        </div>
        <div data-panel data-view="${escapeHtml(`${modalStack.length}:${e.kind}:${e.id}:${e.tab}`)}" role="tabpanel" class="p-5 overflow-y-auto flex-1">${renderTab(e)}</div>
      </div>
    </div>`;
  modalRoot.querySelector("[data-panel]").scrollTop = scrollTop;
}

export function setupModals() {
  document.addEventListener("click", ev => {
    const opener = ev.target.closest("[data-open]");
    if (opener) {
      ev.preventDefault();
      openModal(opener.dataset.open, opener.dataset.id);
      return;
    }
    if (!modalStack.length) return;
    if (ev.target.matches("[data-backdrop]") || ev.target.closest("[data-close]")) return userClose();
    if (ev.target.closest("[data-back]")) return userBack();
    const tab = ev.target.closest("[data-tab]");
    if (tab) {
      modalStack.at(-1).tab = tab.dataset.tab;
      renderModal();
      modalRoot.querySelector(`[data-tab="${tab.dataset.tab}"]`)?.focus();
      return;
    }
    if (ev.target.closest("[data-retry]")) {
      const e = modalStack.at(-1);
      e.errors = {};
      MODAL_KINDS[e.kind].load(e);
      renderModal();
    }
  });
  // Vote member filters update only the list, so the input keeps focus.
  const onFilter = ev => {
    const field = ev.target.dataset?.voteFilter;
    const e = modalStack.at(-1);
    if (!field || !e || e.kind !== "vote") return;
    e.filter[field] = ev.target.value;
    modalRoot.querySelector("[data-vote-members]").innerHTML = voteMemberListHtml(e);
  };
  modalRoot.addEventListener("input", onFilter);
  modalRoot.addEventListener("change", onFilter);
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && modalStack.length) userClose();
  });
  setRouteHandlers({
    showDetail: showModalFromRoute,
    closeDetails: () => { if (modalStack.length) closeModals(); },
  });
}
