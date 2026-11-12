// Campaign Finance tab of the member detail (OpenFEC via member-finance).
import { fetchFunction } from "./data.js";
import { STATE_NAMES, errorBlock, escapeHtml, externalLink, spinner } from "./util.js";
import { loadInto } from "./modals.js";

// --- campaign finance (FEC) helpers

const usdCompact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const usdExact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = v => (typeof v === "number" ? usdCompact.format(v) : "—");
const moneyExact = v => (typeof v === "number" ? usdExact.format(v) : "not reported");
const SIZE_LABELS = { 0: "$200 and under", 200: "$200.01 – $499.99", 500: "$500 – $999.99", 1000: "$1,000 – $1,999.99", 2000: "$2,000 and over" };

function formatDay(iso) {
  if (!iso) return "?";
  const d = new Date(`${iso}T12:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

// One-hue horizontal bars, each a share of `total`; amounts as text, exact on hover.
function shareBars(rows, total) {
  return rows.map(({ label, value }) => {
    const pct = total > 0 && value > 0 ? (value / total) * 100 : 0;
    const pctText = pct >= 1 || pct === 0 ? `${Math.round(pct)}%` : "<1%";
    return `
      <div class="py-1.5" title="${escapeHtml(`${label}: ${moneyExact(value)}`)}">
        <div class="flex justify-between gap-3 text-sm">
          <span class="text-gray-700">${escapeHtml(label)}</span>
          <span class="text-gray-900 font-semibold tabular-nums whitespace-nowrap">${money(value)} <span class="text-gray-500 font-normal">${escapeHtml(pctText)}</span></span>
        </div>
        <div class="mt-1 h-2 rounded-full bg-gray-100" aria-hidden="true"><div class="h-2 rounded-full bg-accent" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  }).join("");
}

export function renderFinanceTab(e) {
  if (!e.financeRequested) {
    e.financeRequested = true; // only call the FEC when this tab is opened
    loadInto(e, "finance", fetchFunction("member-finance", e.id));
  }
  if (e.errors.finance) return errorBlock(e.errors.finance, "Couldn't load campaign finance data from the FEC right now.");
  const f = e.data.finance;
  if (!f) return spinner("Loading FEC filings…");
  if (!f.available) return `<p class="text-sm text-gray-500 py-8 text-center">${escapeHtml(f.reason || "Campaign finance data isn't available for this member.")}</p>`;

  const t = f.totals;
  const tile = (label, value) => `
    <div class="bg-gray-50 border border-gray-200 rounded-lg p-3" title="${escapeHtml(moneyExact(value))}">
      <p class="text-xs text-gray-500 uppercase font-semibold">${label}</p>
      <p class="text-xl font-bold text-gray-900 tabular-nums">${money(value)}</p>
    </div>`;

  const self = (t.candidateSelf || 0) + (t.candidateLoans || 0);
  const sources = [
    { label: "Individuals, unitemized ($200 or less)", value: t.individualUnitemized },
    { label: "Individuals, itemized (over $200)", value: t.individualItemized },
    { label: "PACs and other committees", value: t.pacs },
    { label: "Party committees", value: t.partyCommittees },
    { label: "Candidate's own money (incl. loans)", value: self },
    { label: "Transfers from other authorized committees (e.g. joint fundraising)", value: t.transfersIn },
    { label: "Other receipts (dividends, interest, etc.)", value: t.otherReceipts },
    { label: "Offsets to operating expenditures", value: t.offsets },
  ];
  // Anything the FEC totals include that isn't itemized above (e.g. other loans).
  const known = sources.reduce((sum, r) => sum + (r.value || 0), 0);
  const other = (t.receipts || 0) - known;
  if (t.receipts && other / t.receipts > 0.005) sources.push({ label: "Other (loans, etc.)", value: other });
  const sourceRows = sources.filter(r => typeof r.value === "number" && r.value > 0);

  const sizes = (f.bySize || []).filter(r => typeof r.total === "number" && r.total > 0)
    .sort((a, b) => a.size - b.size);
  const sizeTotal = sizes.reduce((sum, r) => sum + r.total, 0);

  const st = f.byState;
  const home = STATE_NAMES[st?.homeState] || st?.homeState;
  const inPct = st?.itemizedTotal ? Math.round((st.inState / st.itemizedTotal) * 100) : null;

  return `
    <p class="text-xs text-gray-500">
      FEC election cycle ending ${escapeHtml(String(f.candidate.electionYear))} · reported ${escapeHtml(formatDay(f.period.start))} – ${escapeHtml(formatDay(f.period.end))}
      · ${externalLink(f.sourceUrl, "FEC filings")}
    </p>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
      ${tile("Raised", t.receipts)}
      ${tile("Spent", t.disbursements)}
      ${tile("Cash on hand", t.cashOnHand)}
      ${tile("Debts", t.debts)}
    </div>

    ${sourceRows.length ? `
      <section class="mt-5">
        <h3 class="text-sm font-bold text-gray-900">Where the money came from</h3>
        <p class="text-xs text-gray-500">Share of ${escapeHtml(money(t.receipts))} total receipts.</p>
        <div class="mt-2">${shareBars(sourceRows, t.receipts)}</div>
      </section>` : ""}

    ${sizes.length ? `
      <section class="mt-5">
        <h3 class="text-sm font-bold text-gray-900">Individual contributions by size</h3>
        <p class="text-xs text-gray-500">Grouped by each donor's total to the campaign, as the FEC aggregates them.</p>
        <div class="mt-2">${shareBars(sizes.map(r => ({ label: SIZE_LABELS[r.size] || `${r.size}+`, value: r.total })), sizeTotal)}</div>
      </section>` : ""}

    ${st && st.itemizedTotal ? `
      <section class="mt-5">
        <h3 class="text-sm font-bold text-gray-900">Itemized contributions by state</h3>
        <p class="text-xs text-gray-500">The FEC records a donor's state only for itemized contributions (over $200).</p>
        <p class="text-sm text-gray-800 mt-2"><strong>${inPct}%</strong> from ${escapeHtml(home || "the home state")}, ${100 - inPct}% from elsewhere.</p>
        <div class="mt-1">${shareBars(st.top.map(r => ({ label: STATE_NAMES[r.state] || r.name, value: r.total })), st.itemizedTotal)}</div>
      </section>` : ""}

    <p class="text-[11px] text-gray-400 mt-5">
      Figures are as reported to the FEC by the candidate's campaign committee. They don't include
      outside spending such as super PACs. Amounts are rounded; hover for exact figures.
    </p>`;
}
