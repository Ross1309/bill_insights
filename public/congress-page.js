// "This Congress so far" (#congress): the current Congress next to the last two at the same
// day of their two-year terms. Data: stats/congress-<n> (daily series, built by
// netlify/lib/congress-stats.js) for three Congresses + stats/overview's monthly party
// split. Pure rendering: app.js loads the docs.

import { escapeHtml as esc, ordinal } from "./util.js";

const TERM = 730;
const fmt = n => Number(n).toLocaleString("en-US");
const years = c => `${1787 + 2 * c}–${String(1788 + 2 * c).slice(2)}`;
// This Congress = the site's activity mark; earlier ones neutral gray, told apart by line
// style and direct labels (never color alone).
const LINE = { cur: { color: "#13a5b2", width: 2.5, dash: "" }, prev: { color: "#a0a0a0", width: 2, dash: "" }, prev2: { color: "#a0a0a0", width: 2, dash: "5 4" } };

// Running total of a daily series up to and including `day`.
function cumulative(daily = []) {
  const run = []; let s = 0;
  for (const n of daily) { s += n; run.push(s); }
  return day => (day < 0 || !run.length ? 0 : run[Math.min(day, run.length - 1)]);
}
const dateOf = (start, day) => new Date(Date.parse(`${start}T12:00:00Z`) + day * 86400e3)
  .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

let tip = null;
function tooltip() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.setAttribute("role", "status");
  tip.className = "hidden fixed z-50 pointer-events-none bg-surface-deep border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 shadow-lg";
  tip.style.maxWidth = "260px";
  document.body.appendChild(tip);
  return tip;
}
const placeTip = ev => { tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - 270)}px`; tip.style.top = `${ev.clientY + 14}px`; };

// Cumulative lines by day of term. series: [{ c, style, f(day), until }]; until = last day
// drawn (this Congress: today). xmax can run past the term (laws signed after it ends).
function lineChart(el, { series, ymax, today, start, height = 300, xmax = TERM }) {
  const W = Math.max(320, Math.round(el.clientWidth || 1000));
  const H = W < 600 ? Math.round(height * 0.85) : height, L = 48, R = 92, T = 14, B = 34;
  const x = d => L + d / xmax * (W - L - R), y = v => T + (1 - v / ymax) * (H - T - B);
  const step = ymax > 1000 ? 500 : ymax > 300 ? 100 : 50;
  const ticks = []; for (let v = 0; v <= ymax; v += step) ticks.push(v);
  const xt = W < 600 ? [[0, "Start"], [365, "1 year"], [TERM, "2 years"]]
    : [[0, "Start"], [182, "6 months"], [365, "1 year"], [547, "18 months"], [TERM, "2 years"]];
  const path = s => { let p = ""; for (let d = 0; d <= s.until; d += 2) p += `${p ? "L" : "M"}${x(d).toFixed(1)},${y(s.f(d)).toFixed(1)}`; return p; };
  const ends = series.map(s => ({ s, v: s.f(s.until), d: s.until })).sort((a, b) => y(a.v) - y(b.v));
  ends.forEach((e, i) => { e.ly = i ? Math.max(y(e.v), ends[i - 1].ly + 16) : y(e.v); });
  const legend = series.map(s => `<span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" x2="22" y1="3" y2="3" stroke="${s.style.color}" stroke-width="${s.style.width}" stroke-dasharray="${s.style.dash}"/></svg>${ordinal(s.c)} Congress (${years(s.c)})</span>`).join("");
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="${esc(series.map(s => `${ordinal(s.c)} Congress: ${fmt(s.f(Math.min(today, s.until)))} by day ${today}${s.until > today ? `, ${fmt(s.f(s.until))} in all` : ""}`).join("; "))}">
      ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#444"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12" fill="#b0b0b0">${fmt(v)}</text>`).join("")}
      ${xt.map(([d, t]) => `<text x="${x(d)}" y="${H - 10}" text-anchor="${d === 0 ? "start" : d === TERM && xmax === TERM ? "end" : "middle"}" font-size="12" fill="#b0b0b0">${t}</text>`).join("")}
      ${xmax > TERM ? `<line x1="${x(TERM)}" x2="${x(TERM)}" y1="${T}" y2="${H - B}" stroke="#666"/><text x="${x(TERM) + 4}" y="${H - B - 6}" font-size="11" fill="#b0b0b0">term ends;</text><text x="${x(TERM) + 4}" y="${H - B + 7}" font-size="11" fill="#b0b0b0">last signings</text>` : ""}
      <line x1="${x(today)}" x2="${x(today)}" y1="${T}" y2="${H - B}" stroke="#ffc1cc" stroke-dasharray="3 3"/>
      <text x="${x(today) - 6}" y="${T + 10}" text-anchor="end" font-size="12" fill="#e4e4e4">Today (day ${fmt(today)})</text>
      ${[...series].reverse().map(s => `<path d="${path(s)}" fill="none" stroke="${s.style.color}" stroke-width="${s.style.width}" stroke-dasharray="${s.style.dash}" stroke-linejoin="round"/>`).join("")}
      ${ends.map(e => `<circle cx="${x(e.d)}" cy="${y(e.v)}" r="4" fill="${e.s.style.color}" stroke="#363636" stroke-width="2"/><text x="${x(e.d) + 8}" y="${e.ly + 4}" font-size="12" fill="${e.s.style === LINE.cur ? "#f3f3f3" : "#c4c4c4"}" font-weight="${e.s.style === LINE.cur ? 700 : 400}">${ordinal(e.s.c)} · ${fmt(e.v)}</text>`).join("")}
      <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#e4e4e4" opacity="0"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" data-hit/>
    </svg>
    <div class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 mt-1">${legend}</div>`;
  const svg = el.querySelector("svg"), xh = svg.querySelector(".xh"), hit = svg.querySelector("[data-hit]");
  hit.addEventListener("pointermove", ev => {
    const r = svg.getBoundingClientRect();
    const d = Math.max(0, Math.min(xmax, Math.round(((ev.clientX - r.left) / r.width * W - L) / (W - L - R) * xmax)));
    xh.setAttribute("x1", x(d)); xh.setAttribute("x2", x(d)); xh.setAttribute("opacity", 0.5);
    const t = tooltip();
    t.innerHTML = `<div class="font-semibold mb-1">Day ${fmt(d)}</div>` + series.map(s => `<div class="flex justify-between gap-4"><span>${ordinal(s.c)} <span class="text-gray-500">${dateOf(s.start, d)}</span></span><span class="tabular-nums">${d > s.until ? "—" : fmt(s.f(d))}</span></div>`).join("");
    t.classList.remove("hidden"); placeTip(ev);
  });
  hit.addEventListener("pointerleave", () => { tip?.classList.add("hidden"); xh.setAttribute("opacity", 0); });
}

const card = (id, title, note, body) => `
  <section class="bg-surface border border-gray-200 rounded-2xl p-5" aria-labelledby="${id}">
    <h3 id="${id}" class="font-serif text-2xl font-bold text-gray-900">${title}</h3>
    ${note ? `<p class="text-sm text-gray-600 mt-1 max-w-3xl">${note}</p>` : ""}
    ${body}
  </section>`;

// docs: { [congress]: stats/congress-<n> data }; cur = the Congress shown; overview =
// stats/overview (monthly party split of the current Congress).
export function renderCongressPage(el, { docs, cur, overview }) {
  const D = docs[cur];
  if (!D) { el.innerHTML = `<p class="text-center text-gray-500 py-12">The ${esc(ordinal(cur))} Congress's figures haven't been built yet.</p>`; return; }
  const past = [cur - 1, cur - 2].filter(c => docs[c]);
  const all = [cur, ...past];
  const style = c => (c === cur ? LINE.cur : c === cur - 1 ? LINE.prev : LINE.prev2);
  const N = D.final ? Math.min(D.days - 1, TERM) : D.days - 1;   // "today" in the term
  const f = (c, key, sub) => cumulative(sub ? docs[c][key]?.[sub] : docs[c][key]);
  const at = (c, key, sub, day = N) => f(c, key, sub)(day);
  const votesAt = (c, day = N) => at(c, "votes", "House", day) + at(c, "votes", "Senate", day);
  const totalOf = c => (docs[c].totals?.laws ?? 0);
  const pct = Math.round(N / TERM * 100);
  // "more than either" / "fewer than the 118th" / "between" (one or two earlier Congresses).
  const rel = (a, others) => {
    const hi = others.filter(o => a > o).length, lo = others.filter(o => a < o).length;
    const which = others.length === 2 ? "either" : `the ${ordinal(past[0])}`;
    return hi === others.length ? `more than ${which}` : lo === others.length ? `fewer than ${which}` : others.length === 2 ? "between the two" : `the same as ${which}`;
  };
  const lateShare = c => { const all = totalOf(c); return all ? Math.round((all - at(c, "laws", null, N)) / all * 100) : null; };
  const lede = `${fmt(at(cur, "laws"))} laws and ${fmt(votesAt(cur))} roll-call votes in ${fmt(N)} days.` +
    (past.length ? ` Compared with the last ${past.length === 2 ? "two Congresses" : "Congress"} at this point: laws ${rel(at(cur, "laws"), past.map(c => at(c, "laws")))}, roll calls ${rel(votesAt(cur), past.map(c => votesAt(c)))}.` : "") +
    (!D.final && past.length ? ` But the final weeks matter most: the ${ordinal(past[0])} signed <strong>${lateShare(past[0])}%</strong> of its laws after this point${past[1] ? `, the ${ordinal(past[1])} <strong>${lateShare(past[1])}%</strong>` : ""}.` : "");

  // --- Comparison tiles ---
  const tiles = [
    { label: "Laws enacted", v: c => at(c, "laws"), note: "Signed into law (public and private)." },
    { label: "Roll-call votes", v: c => votesAt(c), note: "House and Senate together." },
    { label: "Bills introduced", v: c => at(c, "introduced"), note: "Bills and joint resolutions (measures that can become law)." },
    { label: "Passed a chamber", v: c => at(c, "passed_one"), note: "Bills and joint resolutions the House or Senate passed." },
  ];
  const cmp = (a, others) => {
    const r = rel(a, others);
    if (r === "between the two") return "Between the last two Congresses at this point";
    return `${r[0].toUpperCase()}${r.slice(1)}${others.length === 2 ? " of the last two" : ""} at this point`;
  };
  const tileHtml = t => {
    const vals = all.map(c => ({ c, v: t.v(c) }));
    const max = Math.max(1, ...vals.map(x => x.v));
    return `
      <article class="bg-surface border border-gray-200 rounded-2xl p-5">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-pink">${t.label}</h3>
        <p class="font-serif text-4xl font-bold text-gray-900 tabular-nums mt-1">${fmt(vals[0].v)}</p>
        ${past.length ? `<p class="text-sm text-gray-700 mt-1">${cmp(vals[0].v, vals.slice(1).map(x => x.v))}.</p>` : ""}
        <div class="mt-3 space-y-1.5" role="img" aria-label="${esc(`${t.label} by day ${N}: ${vals.map(x => `${ordinal(x.c)} ${fmt(x.v)}`).join(", ")}`)}">
          ${vals.map(x => `
            <div class="flex items-center gap-2 text-xs" aria-hidden="true">
              <span class="w-10 shrink-0 ${x.c === cur ? "font-bold text-gray-900" : "text-gray-500"}">${ordinal(x.c)}</span>
              <span class="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><span class="block h-full rounded-full" style="width:${x.v / max * 100}%;background:${x.c === cur ? "#13a5b2" : "#777"}"></span></span>
              <span class="w-14 shrink-0 text-right tabular-nums ${x.c === cur ? "text-gray-900 font-semibold" : "text-gray-600"}">${fmt(x.v)}</span>
            </div>`).join("")}
        </div>
        <p class="text-[11px] text-gray-500 mt-3">${t.note}</p>
      </article>`;
  };

  // --- Funnel ---
  const intro = at(cur, "introduced"), one = at(cur, "passed_one"), both = at(cur, "passed_both"), laws = at(cur, "laws");
  const oneIn = (a, b) => (b ? Math.round(a / b) : null);
  const stepBar = (label, n, sub) => `
    <div>
      <div class="flex flex-wrap items-baseline justify-between gap-x-3"><span class="text-sm font-semibold text-gray-900">${label}</span><span class="text-sm tabular-nums text-gray-800"><strong>${fmt(n)}</strong>${sub ? ` <span class="text-gray-500">· ${sub}</span>` : ""}</span></div>
      <div class="h-3 rounded-full bg-gray-100 mt-1.5 overflow-hidden"><div class="h-full rounded-full" style="width:max(${intro ? n / intro * 100 : 0}%, 3px);background:#13a5b2"></div></div>
    </div>`;
  const share = n => (intro ? `${(n / intro * 100).toFixed(1)}% of those introduced` : "");
  const funnel = `
    <div class="mt-5 space-y-4">
      ${stepBar("Bills introduced", intro, "bills and joint resolutions")}
      ${stepBar("Passed the House or the Senate", one, share(one))}
      ${stepBar("Passed both chambers", both, share(both))}
      ${stepBar("Became law", laws, share(laws))}
    </div>
    ${past.length ? `<div class="mt-6 pt-4 border-t border-gray-200 grid gap-3 sm:grid-cols-2">${past.filter(c => docs[c].final).map(c => {
      const t = docs[c].totals;
      return `<p class="text-sm text-gray-600"><span class="block font-semibold text-gray-900">The full ${ordinal(c)} Congress</span>${fmt(t.introduced)} bills introduced, ${fmt(t.passed_one)} passed a chamber, ${fmt(t.laws)} became law: about <strong class="text-gray-900">1 in ${oneIn(t.introduced, t.laws)}</strong>.</p>`;
    }).join("")}</div>` : ""}`;

  // --- Party split: same point comparison + monthly bars ---
  const splitShare = (c, ch, day = N) => {
    const sp = docs[c].split?.[ch];
    if (!sp) return null;
    const op = cumulative(sp.opposed)(day), sa = cumulative(sp.same)(day);
    return op + sa ? Math.round(op / (op + sa) * 100) : null;
  };
  const splitRows = ["House", "Senate"].map(ch => `
    <div>
      <p class="text-sm font-semibold text-gray-900">${ch}</p>
      <div class="mt-1.5 space-y-1.5" role="img" aria-label="${esc(`${ch}: parties split on ${all.map(c => `${splitShare(c, ch) ?? "—"}% (${ordinal(c)})`).join(", ")} of roll calls by day ${N}`)}">
        ${all.map(c => { const s = splitShare(c, ch); return `
          <div class="flex items-center gap-2 text-xs" aria-hidden="true">
            <span class="w-10 shrink-0 ${c === cur ? "font-bold text-gray-900" : "text-gray-500"}">${ordinal(c)}</span>
            <span class="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><span class="block h-full rounded-full" style="width:${s ?? 0}%;background:${c === cur ? "#8f68cb" : "#777"}"></span></span>
            <span class="w-10 shrink-0 text-right tabular-nums ${c === cur ? "text-gray-900 font-semibold" : "text-gray-600"}">${s == null ? "—" : `${s}%`}</span>
          </div>`; }).join("")}
      </div>
    </div>`).join("");
  const months = overview?.congress === cur ? overview.monthly || [] : [];

  const lawSeries = all.map(c => ({ c, start: docs[c].start, style: style(c), f: f(c, "laws"), until: c === cur ? N : docs[c].days - 1 }));
  const lastDay = Math.max(N, ...lawSeries.map(s => s.until));
  const lawMax = Math.ceil(Math.max(50, ...lawSeries.map(s => s.f(s.until))) / 100) * 100;
  const voteMax = Math.ceil(Math.max(100, ...all.flatMap(c => ["House", "Senate"].map(ch => at(c, "votes", ch, docs[c].days - 1)))) / 250) * 250;
  const checkpoints = [[182, "6 months"], [365, "1 year"], [547, "18 months"], [N, `Today (day ${fmt(N)})`], [TERM, "End of term"], [lastDay, "With laws signed after the term"]]
    .filter(([d], i, a) => d <= lastDay && a.findIndex(x => x[0] === d) === i);

  el.innerHTML = `
    <div class="space-y-10">
      <section>
        <h2 class="font-serif text-3xl sm:text-4xl font-bold text-gray-900">The ${esc(ordinal(cur))} Congress ${D.final ? "in full" : "so far"}</h2>
        <p class="text-gray-600 mt-2 max-w-3xl">${lede}</p>
        <div class="mt-4 max-w-3xl">
          <div class="flex justify-between text-xs text-gray-500"><span>Began ${dateOf(D.start, 0)}</span><span>Ends ${dateOf(D.start, TERM)}</span></div>
          <div class="h-2 rounded-full bg-gray-200 mt-1 overflow-hidden" role="img" aria-label="Day ${N} of ${TERM}, ${pct}% of the term"><div class="h-full rounded-full" style="width:${pct}%;background:#13a5b2"></div></div>
          <p class="text-xs text-gray-500 mt-1">Day ${fmt(N)} of ${fmt(TERM)} (${pct}% of the two-year term). Figures as of ${dateOf(D.start, N)}.</p>
        </div>
      </section>

      ${past.length ? `<section>
        <h2 class="font-serif text-2xl font-bold text-gray-900">Is this normal?</h2>
        <p class="text-sm text-gray-500 mt-1 max-w-3xl">Each number next to the last ${past.length === 2 ? "two Congresses" : "Congress"} at the same point in their two-year terms (${fmt(N)} days in).</p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-4">${tiles.map(tileHtml).join("")}</div>
      </section>` : ""}

      ${card("congress-laws", "Laws enacted over the two-year term",
        past.length ? `Laws pile up at the end of a term, when Congress passes what it can before it expires. ${past.filter(c => docs[c].final).map((c, i) => `${i ? "the" : "The"} ${ordinal(c)} had ${fmt(at(c, "laws"))} laws at this point and finished with ${fmt(totalOf(c))}`).join("; ")}.` : "",
        `<div class="mt-4" data-chart="laws"></div>
        <details class="mt-3 text-sm"><summary class="cursor-pointer text-accent">View as table</summary>
          <div class="mt-2 overflow-x-auto"><table class="text-sm tabular-nums"><thead class="text-xs text-gray-500"><tr><th class="text-left pr-6 py-1">Point in term</th>${all.map(c => `<th class="text-right pr-6">${ordinal(c)}</th>`).join("")}</tr></thead>
          <tbody>${checkpoints.map(([d, t]) => `<tr class="border-t border-gray-200"><td class="pr-6 py-1">${t}</td>${lawSeries.map(s => `<td class="text-right pr-6">${d > s.until ? "—" : fmt(s.f(d))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        </details>`)}

      ${card("congress-funnel", "From bill to law",
        `Most bills never get a vote. So far in the ${ordinal(cur)} Congress, about <strong>1 in ${oneIn(intro, one)}</strong> bills introduced has passed the House or the Senate, and about <strong>1 in ${oneIn(intro, laws)}</strong> has become law. Bars are drawn to scale. <a href="#how-laws-are-made" class="text-accent hover:underline">How a bill becomes law</a>`,
        funnel)}

      ${card("congress-votes", "Roll-call votes over the term",
        `By this point the House had held ${fmt(at(cur, "votes", "House"))} roll-call votes${past.length ? ` (${past.map(c => `${ordinal(c)}: ${fmt(at(c, "votes", "House"))}`).join(", ")})` : ""} and the Senate ${fmt(at(cur, "votes", "Senate"))}${past.length ? ` (${past.map(c => `${ordinal(c)}: ${fmt(at(c, "votes", "Senate"))}`).join(", ")})` : ""}. Most Senate roll calls are on nominations.`,
        `<div class="grid gap-6 lg:grid-cols-2 mt-4"><div><h4 class="text-sm font-bold text-gray-900">House</h4><div data-chart="House"></div></div><div><h4 class="text-sm font-bold text-gray-900">Senate</h4><div data-chart="Senate"></div></div></div>`)}

      ${card("congress-split", "How often the parties split",
        `Roll calls where most Democrats and most Republicans voted opposite ways (Yea vs Nay), by this point in each term.`,
        `<div class="grid gap-6 sm:grid-cols-2 mt-4 max-w-3xl">${splitRows}</div>
        <p class="text-xs text-gray-500 mt-3">Month by month: see &ldquo;Party agreement&rdquo; under More charts below.</p>`)}

      <section class="text-sm text-gray-600 max-w-3xl">
        <h2 class="font-serif text-xl font-bold text-gray-900">How these numbers are counted</h2>
        <ul class="list-disc pl-5 mt-2 space-y-1.5">
          <li><strong>Same point in the term:</strong> each Congress starts on January 3 of an odd year; "day N" is N days after that, so every Congress is compared at the same stage of its two years.</li>
          <li><strong>Bills:</strong> measures that can become law (H.R., S., H.J.Res., S.J.Res.), counted by their introduction date. Simple and concurrent resolutions, which can't become law, are left out.</li>
          <li><strong>Passed a chamber / both:</strong> the first "Passed/agreed to in House" or "in Senate" action in the official history. <strong>Laws:</strong> the "Became Public/Private Law" action.</li>
          <li><strong>Roll-call votes and party splits:</strong> every recorded vote (House Clerk, senate.gov); a split is most Democrats voting the opposite way from most Republicans, ties left out.</li>
          <li><strong>Sources:</strong> GovInfo's bill status files and Congress.gov (bills), the House Clerk and senate.gov (votes). Updated nightly. <a href="#methodology" class="text-accent hover:underline">How we count</a></li>
        </ul>
      </section>
    </div>`;

  // Charts are drawn after the layout exists (they size themselves to their box).
  lineChart(el.querySelector('[data-chart="laws"]'), { series: lawSeries, ymax: lawMax, today: N, xmax: Math.max(TERM, lastDay + 4) });
  for (const ch of ["House", "Senate"]) {
    lineChart(el.querySelector(`[data-chart="${ch}"]`), { today: N, ymax: voteMax, series: all.map(c => ({ c, start: docs[c].start, style: style(c), f: f(c, "votes", ch), until: c === cur ? N : Math.min(docs[c].days - 1, TERM) })) });
  }
  const m = el.querySelector('[data-chart="months"]');
  if (m) monthlySplit(m, months);
}

// Monthly share of roll calls where the parties split, one row per chamber.
function monthlySplit(el, months) {
  const W = Math.max(320, Math.round(el.clientWidth || 1000)), RH = 110, L = 44, R = 8, T = 30, gap = 46, B = 28;
  const H = T + 2 * RH + gap + B, bw = (W - L - R) / months.length;
  const share = t => (t && t.same + t.opposed ? Math.round(t.opposed / (t.same + t.opposed) * 100) : null);
  const label = mo => new Date(`${mo}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const row = (ch, top) => {
    const y = v => top + (1 - v / 100) * RH;
    return `<text x="${L}" y="${top - 12}" font-size="13" font-weight="700" fill="#f3f3f3">${ch}, by month</text>
      ${[0, 50, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#444"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#b0b0b0">${v}%</text>`).join("")}
      ${months.map((m, i) => { const s = share(m[ch]); if (s == null) return "";
        return `<rect x="${L + i * bw + 2}" y="${y(s)}" width="${Math.max(1, bw - 4)}" height="${y(0) - y(s)}" rx="2" fill="#8f68cb" data-tip="${esc(`${label(m.month)} · ${ch}: parties split on ${s}% (${m[ch].opposed} of ${m[ch].same + m[ch].opposed} roll calls)`)}"/>`; }).join("")}`;
  };
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Share of roll calls where the parties split, by month, House and Senate">
      ${row("House", T)}${row("Senate", T + RH + gap)}
      ${months.map((m, i) => i % (W < 600 ? 6 : 3) === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#b0b0b0">${new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })}</text>` : "").join("")}
    </svg>
    <p class="text-xs text-gray-500 mt-1">Months with no bar had no roll calls where both parties took a side (recess).</p>`;
  el.addEventListener("pointermove", ev => {
    const t = ev.target.closest("[data-tip]");
    if (!t) { tip?.classList.add("hidden"); return; }
    tooltip().textContent = t.dataset.tip; tip.classList.remove("hidden"); placeTip(ev);
  });
  el.addEventListener("pointerleave", () => tip?.classList.add("hidden"));
}
