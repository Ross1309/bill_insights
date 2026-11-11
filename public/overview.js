// Overview tab: four charts drawn in plain SVG/HTML from the precomputed
// `stats/overview` doc (see netlify/lib/vote-stats.js for definitions).
//
// Chart colors are deeper "mark" steps validated with the dataviz palette checker
// against the dark card surface (#363636). Where contrast or colorblind separation
// sits in the warning band, every chart also shows values as text and offers
// a table view. Party fills are used only in the delegation map, never in a chart
// that also shows Yea/Nay or outcomes.

import { STATES, DELEGATE_JURISDICTIONS } from "./states.js";

const C = {
  activity: "#13a5b2",
  same: "#13a5b2",
  opposed: "#8f68cb",
  succeeded: "#6fa326",
  failed: "#c04637",
  D: "#707ed4",
  R: "#d15b5c",
  I: "#3ba888",
  grid: "#444444",
};
const STATE_NAMES = Object.fromEntries([...STATES, ...DELEGATE_JURISDICTIONS]);
const CHAMBERS = ["House", "Senate"];
const CATEGORY_LABELS = {
  passage: "Passage of bills & resolutions",
  cloture: "Cloture (end debate)",
  nomination: "Nominations",
  amendment: "Amendments",
  procedural: "Procedural motions",
  other: "Other",
};

const esc = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const fmtDay = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtMonth = ym => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

function card(title, subtitle, body, { legend = "", table = "", note = "" } = {}) {
  return `
    <section class="bg-surface border border-gray-200 rounded-xl p-5 sm:p-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-serif text-xl font-bold text-gray-900">${esc(title)}</h3>
          <p class="text-sm text-gray-500 mt-0.5">${subtitle}</p>
        </div>
        ${legend ? `<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">${legend}</div>` : ""}
      </div>
      <div class="mt-4">${body}</div>
      ${note ? `<p class="text-[11px] text-gray-400 mt-3">${note}</p>` : ""}
      ${table ? `
        <details class="mt-3 text-sm">
          <summary class="cursor-pointer text-xs text-accent hover:text-accent-light">View as table</summary>
          <div class="mt-2 max-h-72 overflow-auto">${table}</div>
        </details>` : ""}
    </section>`;
}

const swatch = (color, label) =>
  `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded-sm" style="background:${color}"></span>${esc(label)}</span>`;

function table(headers, rows) {
  return `
    <table class="w-full text-xs text-left">
      <thead class="text-gray-500 uppercase sticky top-0 bg-surface"><tr>${headers.map((h, i) => `<th class="py-1 pr-3 font-semibold ${i ? "text-right" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody class="text-gray-700">${rows.map(r => `<tr class="border-t border-gray-100">${r.map((c, i) => `<td class="py-1 pr-3 ${i ? "text-right tabular-nums" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
}

// --- 1. Activity: roll-call votes per week, one row per chamber, shared y scale
function activityChart(s) {
  const weeks = s.weekly || [];
  const max = Math.max(1, ...weeks.map(w => Math.max(w.House, w.Senate)));
  const W = 10, gap = 2, H = 64;
  const width = weeks.length * W;

  // Ticks at the first week of each quarter (Jan/Apr/Jul/Oct), labeled by month.
  const ticks = [];
  let lastMonth = "";
  weeks.forEach((w, i) => {
    const month = w.week.slice(0, 7);
    if (month !== lastMonth && /-(01|04|07|10)$/.test(month) && i > 0) {
      ticks.push({ i, label: new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }) });
    }
    lastMonth = month;
  });

  const row = chamber => {
    const total = weeks.reduce((n, w) => n + w[chamber], 0);
    const bars = weeks.map((w, i) => {
      const v = w[chamber];
      const h = v ? Math.max(2, (v / max) * H) : 0;
      // Hit target is the full column, bigger than the bar.
      return `<g data-tip="${esc(`${chamber} · week of ${fmtDay(w.week)}: ${v} vote${v === 1 ? "" : "s"}`)}">
        <rect x="${i * W}" y="0" width="${W}" height="${H}" fill="transparent"></rect>
        ${h ? `<rect x="${i * W + gap / 2}" y="${H - h}" width="${W - gap}" height="${h}" rx="1.5" fill="${C.activity}"></rect>` : ""}
      </g>`;
    }).join("");
    return `
      <div class="mt-2">
        <div class="flex justify-between text-xs text-gray-600"><span class="font-semibold text-gray-800">${chamber}</span><span>${total} votes</span></div>
        <svg viewBox="0 0 ${width} ${H}" preserveAspectRatio="none" class="w-full h-16 mt-1" role="img" aria-label="${chamber} roll-call votes per week">
          <line x1="0" y1="${H - 0.5}" x2="${width}" y2="${H - 0.5}" stroke="${C.grid}" stroke-width="1" vector-effect="non-scaling-stroke"></line>
          ${bars}
        </svg>
      </div>`;
  };

  const axis = `
    <div class="relative h-4 mt-1 text-[10px] text-gray-400">
      ${ticks.map(t => `<span class="absolute -translate-x-1/2 whitespace-nowrap" style="left:${((t.i + 0.5) / weeks.length) * 100}%">${esc(t.label)}</span>`).join("")}
    </div>`;

  const busiest = [...weeks].sort((a, b) => (b.House + b.Senate) - (a.House + a.Senate))[0];
  const empty = weeks.filter(w => !w.House && !w.Senate).length;
  return card(
    "How busy has Congress been?",
    `Recorded roll-call votes per week since ${esc(fmtDay(weeks[0]?.week || ""))}. Empty weeks are usually recesses (${empty} weeks with no votes).`,
    row("House") + row("Senate") + axis,
    {
      note: `Both rows use the same scale (tallest bar = ${max} votes). Busiest week: ${esc(fmtDay(busiest?.week || ""))}, ${busiest ? busiest.House + busiest.Senate : 0} votes. Source: House Clerk, senate.gov.`,
      table: table(["Week of", "House", "Senate"], weeks.slice().reverse().map(w => [fmtDay(w.week), w.House, w.Senate])),
    },
  );
}

// --- 2. Party agreement: monthly 100% columns per chamber
function alignmentChart(s) {
  const months = s.monthly || [];
  const H = 72, W = 20, gap = 4;
  const width = months.length * W;

  const row = chamber => {
    const tot = s.alignment_totals?.[chamber] || { same: 0, opposed: 0, unclear: 0 };
    const all = tot.same + tot.opposed + tot.unclear;
    const cols = months.map((m, i) => {
      const c = m[chamber];
      const n = c.same + c.opposed;
      const tip = n
        ? `${chamber} · ${fmtMonth(m.month)}: parties opposed on ${c.opposed} of ${n} votes (${pct(c.opposed, n)}%), agreed on ${c.same}`
        : `${chamber} · ${fmtMonth(m.month)}: no votes`;
      const hOpp = n ? (c.opposed / n) * H : 0;
      const hSame = n ? H - hOpp : 0;
      return `<g data-tip="${esc(tip)}">
        <rect x="${i * W}" y="0" width="${W}" height="${H}" fill="transparent"></rect>
        ${n ? `
          <rect x="${i * W + gap / 2}" y="0" width="${W - gap}" height="${Math.max(0, hOpp - 1)}" fill="${C.opposed}"></rect>
          <rect x="${i * W + gap / 2}" y="${hOpp + 1}" width="${W - gap}" height="${Math.max(0, hSame - 1)}" fill="${C.same}"></rect>` : ""}
      </g>`;
    }).join("");
    return `
      <div class="mt-3">
        <div class="flex flex-wrap justify-between gap-2 text-xs text-gray-600">
          <span class="font-semibold text-gray-800">${chamber}</span>
          <span>Opposed on <strong class="text-gray-900">${pct(tot.opposed, tot.same + tot.opposed)}%</strong> of ${all} votes</span>
        </div>
        <svg viewBox="0 0 ${width} ${H}" preserveAspectRatio="none" class="w-full h-20 mt-1" role="img" aria-label="${chamber}: share of votes where party majorities opposed each other, by month">
          ${cols}
        </svg>
      </div>`;
  };

  const ticks = months.map((m, i) => ({ i, m })).filter(({ m }) => /-(01|04|07|10)$/.test(m.month));
  const axis = `
    <div class="relative h-4 mt-1 text-[10px] text-gray-400">
      ${ticks.map(t => `<span class="absolute -translate-x-1/2 whitespace-nowrap" style="left:${((t.i + 0.5) / months.length) * 100}%">${esc(fmtMonth(t.m.month))}</span>`).join("")}
    </div>`;

  return card(
    "How often do the parties agree?",
    "Share of roll-call votes each month where the majority of Democrats and the majority of Republicans voted the same way, or opposite ways.",
    row("House") + row("Senate") + axis,
    {
      legend: swatch(C.opposed, "Majorities opposed") + swatch(C.same, "Majorities agreed"),
      note: "Definition: each party's majority is whichever of Yea/Nay most of its members chose; Present and Not Voting are ignored. Votes where a party tied are left out. Many Senate votes are on nominations and cloture, which tend to split along party lines.",
      table: table(["Month", "House opposed", "House agreed", "Senate opposed", "Senate agreed"],
        months.slice().reverse().map(m => [fmtMonth(m.month), m.House.opposed, m.House.same, m.Senate.opposed, m.Senate.same])),
    },
  );
}

// --- 3. Outcomes: what kinds of questions come up, and how often they succeed
function outcomesChart(s) {
  const block = chamber => {
    const rows = Object.entries(s.outcomes?.[chamber] || {})
      .map(([cat, c]) => ({ cat, ...c, total: c.succeeded + c.failed + c.other }))
      .filter(r => r.total)
      .sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.map(r => r.total));
    return `
      <div>
        <p class="text-xs font-semibold text-gray-800 mb-2">${chamber}</p>
        <div class="space-y-2.5">
          ${rows.map(r => `
            <div data-tip="${esc(`${chamber} · ${CATEGORY_LABELS[r.cat] || r.cat}: ${r.succeeded} succeeded, ${r.failed} failed${r.other ? `, ${r.other} other` : ""}`)}">
              <div class="flex justify-between gap-2 text-xs"><span class="text-gray-700">${esc(CATEGORY_LABELS[r.cat] || r.cat)}</span><span class="text-gray-500 tabular-nums">${r.total}</span></div>
              <div class="flex h-3 mt-1 gap-[2px]" style="width:${(r.total / max) * 100}%">
                ${r.succeeded ? `<div class="h-full rounded-l-sm" style="flex:${r.succeeded};background:${C.succeeded}"></div>` : ""}
                ${r.failed ? `<div class="h-full ${r.succeeded ? "" : "rounded-l-sm"} rounded-r-sm" style="flex:${r.failed};background:${C.failed}"></div>` : ""}
                ${r.other ? `<div class="h-full rounded-r-sm bg-gray-300" style="flex:${r.other}"></div>` : ""}
              </div>
              <p class="text-[11px] text-gray-500 mt-0.5 tabular-nums">${r.succeeded} succeeded · ${r.failed} failed${r.other ? ` · ${r.other} other` : ""}</p>
            </div>`).join("")}
        </div>
      </div>`;
  };
  const tableRows = [];
  for (const ch of CHAMBERS) {
    for (const [cat, c] of Object.entries(s.outcomes?.[ch] || {})) tableRows.push([`${ch}: ${CATEGORY_LABELS[cat] || cat}`, c.succeeded, c.failed, c.other]);
  }
  return card(
    "What gets voted on, and what succeeds?",
    "Every roll call grouped by the kind of question, split by whether the motion, bill or nomination succeeded.",
    `<div class="grid gap-6 md:grid-cols-2">${block("House")}${block("Senate")}</div>`,
    {
      legend: swatch(C.succeeded, "Succeeded") + swatch(C.failed, "Failed"),
      note: "Grouped from the official question text. \"Succeeded\" means passed, agreed to, confirmed or sustained; a failed procedural motion can still be a win for whoever opposed it.",
      table: table(["Question type", "Succeeded", "Failed", "Other"], tableRows),
    },
  );
}

// --- 4. Delegations: equal-size state tiles
const TILES = {
  AK: [0, 0], ME: [0, 10],
  VT: [1, 9], NH: [1, 10],
  WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 8], RI: [2, 9], MA: [2, 10],
  OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], CT: [3, 9],
  CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
  AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
  OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
  HI: [7, 0], TX: [7, 3], FL: [7, 8],
};
const TERRITORIES = ["PR", "GU", "VI", "AS", "MP"];

function delegationTile(code, d) {
  if (!d) return "";
  const total = d.D + d.R + d.I + d.other;
  const parts = [["D", d.D], ["I", d.I], ["R", d.R]].filter(([, n]) => n);
  const counts = parts.map(([p, n]) => `${n}${p}`).join(" ");
  const tip = `${STATE_NAMES[code] || code}: ${d.senators} senator${d.senators === 1 ? "" : "s"}, ${d.representatives} ${d.delegate ? "delegate" : "representative"}${d.representatives === 1 ? "" : "s"} · Democratic ${d.D}, Republican ${d.R}${d.I ? `, Independent ${d.I}` : ""}`;
  return `
    <button type="button" data-state="${code}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"
      class="flex flex-col justify-between w-full h-full rounded-md bg-gray-100 border border-gray-200 hover:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent p-1 sm:p-1.5 text-left">
      <span class="text-[10px] sm:text-xs font-bold text-gray-900 leading-none">${code}</span>
      <span class="hidden md:block text-[9px] text-gray-500 leading-none tabular-nums">${esc(counts)}</span>
      <span class="flex h-1.5 sm:h-2 w-full gap-px overflow-hidden rounded-sm">
        ${parts.map(([p, n]) => `<span style="flex:${n};background:${C[p]}"></span>`).join("")}
        ${total ? "" : `<span class="flex-1 bg-gray-300"></span>`}
      </span>
    </button>`;
}

function delegationsChart(s) {
  const del = s.delegations || {};
  const cells = Object.entries(TILES).map(([code, [r, c]]) =>
    `<div style="grid-row:${r + 1};grid-column:${c + 1}" class="aspect-square">${delegationTile(code, del[code])}</div>`).join("");
  const territories = TERRITORIES.filter(t => del[t]).map(t => `<div class="w-6 sm:w-11 md:w-14 aspect-square">${delegationTile(t, del[t])}</div>`).join("");
  const rows = Object.entries(del).sort(([a], [b]) => (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b))
    .map(([code, d]) => [STATE_NAMES[code] || code, d.senators, d.representatives, d.D, d.R, d.I]);

  return card(
    "Who represents each state?",
    "Current members of Congress by state: both senators plus the House delegation. Every state gets the same size tile. Select a state to see its members.",
    `<div class="max-w-2xl mx-auto">
       <div class="grid gap-1 sm:gap-1.5" style="grid-template-columns:repeat(11,minmax(0,1fr))">${cells}</div>
       <div class="flex flex-wrap items-center gap-1.5 mt-3"><span class="text-xs text-gray-500 mr-1">Non-voting delegates:</span>${territories}</div>
     </div>`,
    {
      legend: swatch(C.D, "Democratic") + swatch(C.R, "Republican") + swatch(C.I, "Independent"),
      note: "Bar segments are proportional to each delegation's members. DC and the territories send non-voting delegates to the House. Source: Congress.gov.",
      table: table(["State", "Senators", "House", "Democratic", "Republican", "Independent"], rows),
    },
  );
}

// --- tooltip (one shared element; hover on desktop, tap on touch)
function wireTooltip(root) {
  let tip = document.getElementById("chart-tooltip");
  if (!tip) {
    tip = Object.assign(document.createElement("div"), {
      id: "chart-tooltip",
      className: "fixed z-40 pointer-events-none hidden max-w-xs px-2.5 py-1.5 text-xs rounded-md bg-surface-deep text-gray-800 border border-gray-200 shadow-lg",
    });
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  const show = (target, x, y) => {
    tip.textContent = target.dataset.tip;
    tip.classList.remove("hidden");
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
    tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12)}px`;
  };
  root.addEventListener("pointermove", e => {
    const t = e.target.closest("[data-tip]");
    if (t && root.contains(t)) show(t, e.clientX, e.clientY);
    else tip.classList.add("hidden");
  });
  root.addEventListener("pointerleave", () => tip.classList.add("hidden"));
  // Touch: no hover, so a tap shows the tooltip for that mark.
  root.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse") return;
    const t = e.target.closest("[data-tip]");
    if (t && root.contains(t)) show(t, e.clientX, e.clientY);
  });
  window.addEventListener("scroll", () => tip.classList.add("hidden"), { passive: true });
}

export function renderOverview(container, stats, { onState } = {}) {
  const updated = stats.generated_at?.toDate?.();
  container.innerHTML = `
    <div class="space-y-6">
      ${activityChart(stats)}
      ${alignmentChart(stats)}
      ${outcomesChart(stats)}
      ${delegationsChart(stats)}
      <p class="text-xs text-gray-400">${stats.congress ? `${stats.congress}th Congress · ` : ""}${(stats.totals?.House || 0) + (stats.totals?.Senate || 0)} roll-call votes${updated ? ` · updated ${esc(updated.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}` : ""}</p>
    </div>`;
  wireTooltip(container);
  container.querySelectorAll("[data-state]").forEach(b =>
    b.addEventListener("click", () => onState?.(b.dataset.state)));
}
