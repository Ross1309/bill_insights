// Issues tab: plain-language topic pages (Economy, Healthcare, Foreign Affairs +
// watchlists) rendered from precomputed `stats/topic-<slug>` docs (see
// netlify/lib/topic-stats.js and netlify/lib/topics.js for definitions).
//
// Bill labels open the bill modal (data-open="bill"), votes the vote modal, members
// the profile; the global data-open handler in modals.js does the rest.

import { DELEGATE_JURISDICTIONS, STATES } from "./states.js";
import { PARTY_NAMES as PARTY_NAME, STATE_NAMES, escapeHtml as esc, wireTooltip } from "./util.js";

const C = { succeeded: "#6fa326", failed: "#c04637", accent: "#13a5b2" };
const PARTY_CHIP = { D: "ring-party-d/70 text-party-d", R: "ring-party-r/70 text-party-r", I: "ring-party-i/60 text-party-i" };
const FOCUSED_MAX_SUBJECTS = 10; // keep in sync with netlify/lib/topics.js

const day = iso => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const billLink = b => `<button type="button" data-open="bill" data-id="${esc(b.id)}" class="text-xs font-semibold text-accent hover:underline">${esc(b.label)}</button>`;

// Plain-English meaning of each kind of floor question.
export function explainQuestion(question = "") {
  const q = question.toLowerCase();
  if (q.includes("concur in")) return "A vote to accept the other chamber's version of the bill. Agreeing usually sends it to the President.";
  if (q.includes("cloture")) return "A vote on whether to end debate and move forward. It needs 60 of 100 senators.";
  if (q.includes("motion to proceed")) return "A Senate vote on whether to start debating the measure. It doesn't decide whether it passes.";
  if (q.includes("nomination")) return "A Senate vote on whether to confirm the President's nominee.";
  if (q.includes("suspend the rules")) return "A fast-track vote for less controversial bills. It needs two-thirds of the House to pass.";
  if (q.includes("recommit")) return "The minority party's last chance to send the bill back to committee before the final vote.";
  if (q.includes("table")) return "A vote to set a measure aside, which usually ends it.";
  if (q.includes("discharge")) return "A vote to pull a measure out of committee so the full chamber can consider it.";
  if (q.includes("previous question")) return "A procedural House vote that ends debate on the rule for considering a bill.";
  if (q.includes("amendment")) return "A vote on changing the bill's text.";
  if (q.includes("passage") || q.includes("pass the bill")) return "The final vote on whether this chamber passes the bill.";
  if (q.includes("resolution")) return "The vote on whether this chamber adopts the resolution.";
  return "A recorded floor vote on this measure.";
}

const EXPLAINERS = {
  "war-powers": ["How War Powers Resolution votes work",
    "The War Powers Resolution (1973) requires the President to notify Congress within 48 hours of sending U.S. forces into hostilities, and generally limits that use of force to 60 days without congressional authorization (plus 30 days to withdraw). Section 5(c) lets Congress direct the removal of forces with a concurrent resolution, which needs both chambers but doesn't go to the President. Since the Supreme Court's 1983 decision in INS v. Chadha, whether such concurrent resolutions are legally binding has been disputed. Congress has also used joint resolutions, which go to the President and can be vetoed."],
  resolutions: ["Bills, joint and concurrent resolutions",
    "Bills (H.R./S.) and joint resolutions (H.J.Res./S.J.Res.) must pass both chambers and be signed by the President (or survive a veto) to become law. Concurrent resolutions (H.Con.Res./S.Con.Res.) need both chambers but don't go to the President; they usually concern how Congress itself operates. Simple resolutions (H.Res./S.Res.) involve one chamber only."],
  "no-vote": ["Why most bills never get a vote",
    "Thousands of bills are introduced each Congress. Most are referred to a committee and never move further: committees and chamber leaders decide what reaches the floor. A bill that never gets a vote hasn't been rejected; it just didn't advance. This page focuses on measures that reached a floor vote or became law."],
};
const GLOSSARY = {
  Cloture: "A Senate vote to end debate. Needs 60 votes. Without it, most bills can't get a final vote.",
  "Suspension of the rules": "A House fast track for less controversial bills: limited debate, no amendments, two-thirds needed to pass.",
  "Motion to recommit": "The House minority's last chance to send a bill back to committee before the final vote.",
  "Motion to table": "A vote to set something aside; adopting it usually ends that measure.",
  "Motion to discharge": "A vote to pull a measure out of committee for consideration by the full chamber.",
  Appropriations: "Bills that provide the actual money. Authorization bills set policy and allow spending; appropriations fund it.",
};

const STAGE_TEXT = { law: "Became law", passed_both: "Passed both chambers", to_president: "Sent to President", passed_one: "Passed one chamber", committee: "Didn't pass", introduced: "Introduced" };
function stageChip(b) {
  const failed = b.failed_house || b.failed_senate;
  const text = b.stage === "passed_one" && failed ? `Passed ${b.passed_house ? "House" : "Senate"}, failed ${b.failed_senate ? "Senate" : "House"}`
    : (b.stage === "committee" || b.stage === "introduced") && failed ? `Failed in ${b.failed_house ? "House" : "Senate"}`
    : STAGE_TEXT[b.stage] || "Reached the floor";
  const tone = b.stage === "law" || b.stage === "passed_both" || b.stage === "to_president" ? "bg-green-100 text-green-800"
    : failed && b.stage !== "passed_one" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700";
  return `<span class="text-[11px] font-semibold px-2 py-0.5 rounded ${tone}">${esc(text)}</span>`;
}
const sponsorText = s => (s ? `Sponsor: ${esc(s.name)} <span class="ring-1 ring-inset ${PARTY_CHIP[s.party] || ""} px-1 rounded">${esc(s.party)}-${esc(s.state)}</span>` : "");

// ---- sections

function glance(s) {
  const c = s.counts;
  const passedSome = c.law + c.passed_both + c.passed_one;
  const steps = [["Reached the floor or became law", c.measures], ["Passed at least one chamber", passedSome], ["Passed both chambers", c.law + c.passed_both], ["Became law", c.law]];
  return `
    <section>
      <h3 class="font-serif text-2xl font-bold text-gray-900">At a glance</h3>
      <p class="text-base sm:text-lg text-gray-800 mt-2 max-w-3xl">This Congress, <strong>${c.measures}</strong> ${esc(s.label.toLowerCase())} measures reached a floor vote or became law. <strong>${c.law}</strong> became law, <strong>${c.passed_both + c.passed_one}</strong> more passed at least one chamber, and <strong>${c.none}</strong> didn't pass either. Members cast <strong>${c.votes}</strong> recorded votes on them.</p>
      <div class="mt-5 bg-surface border border-gray-200 rounded-xl p-5">
        <p class="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">How far they got</p>
        <div class="space-y-2.5">${steps.map(([lbl, n], i) => `
          <div data-tip="${esc(`${lbl}: ${n} of ${c.measures} measures`)}">
            <div class="flex justify-between text-sm"><span class="text-gray-800">${i ? "→ " : ""}${esc(lbl)}</span><span class="font-semibold text-gray-900 tabular-nums">${n}</span></div>
            <div class="h-2.5 mt-1 rounded-full bg-gray-100"><div class="h-2.5 rounded-full" style="width:${c.measures ? Math.max(1.5, (n / c.measures) * 100) : 0}%;background:${C.accent}"></div></div>
          </div>`).join("")}
        </div>
        <p class="text-[11px] text-gray-400 mt-3">Concurrent and simple resolutions don't go to the President, so "passed" is as far as they can go.</p>
      </div>
      <p class="text-xs text-gray-500 mt-2">Most bills are referred to a committee and never get a floor vote. That's normal, and they aren't shown here. <button type="button" class="text-accent hover:underline" data-explain="no-vote">Why most bills never get a vote</button></p>
    </section>`;
}

function timeline(focused) {
  const vs = focused.flatMap(b => (b.votes || []).map(v => ({ ...v, bill: b }))).sort((a, b) => a.date.localeCompare(b.date));
  if (!vs.length) return "";
  const t0 = new Date(vs[0].date).getTime(), span = Math.max(1, new Date(vs.at(-1).date).getTime() - t0);
  const row = ch => `
    <div class="flex items-center gap-3">
      <span class="w-14 text-xs text-gray-500">${ch}</span>
      <div class="relative flex-1 h-12 border-b border-gray-200">
        ${vs.filter(v => v.chamber === ch).map((v, i) => {
          const x = ((new Date(v.date).getTime() - t0) / span) * 100;
          const tip = `${day(v.date)} · ${ch} · ${v.bill.label}: ${v.result} ${v.yea}–${v.nay}`;
          return `<button type="button" data-open="vote" data-id="${esc(v.id)}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" class="absolute bottom-0 -translate-x-1/2 flex flex-col items-center" style="left:${Math.min(98, Math.max(2, x))}%">
            <span class="hidden sm:block text-[10px] tabular-nums text-gray-500 ${i % 2 ? "mb-4" : "mb-0.5"}">${v.yea}–${v.nay}</span>
            <span class="w-3 h-3 rounded-full ring-2 ring-surface" style="background:${v.passed ? C.succeeded : C.failed}"></span>
          </button>`;
        }).join("")}
      </div>
    </div>`;
  return `
    <div class="bg-surface border border-gray-200 rounded-xl p-5">
      <div class="flex flex-wrap justify-between gap-2">
        <p class="text-sm font-semibold text-gray-900">Floor votes on these measures over time</p>
        <div class="flex gap-4 text-xs text-gray-600">
          <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full" style="background:${C.succeeded}"></span>Passed / agreed to</span>
          <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full" style="background:${C.failed}"></span>Failed / rejected</span>
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-1">${vs.length} recorded votes, ${vs.filter(v => v.passed).length} passed. Numbers are Yea–Nay<span class="sm:hidden">; tap a dot for details</span>. Select a dot to see how every member voted.</p>
      <div class="mt-4 space-y-3">${row("House")}${row("Senate")}</div>
      <div class="flex justify-between text-[10px] text-gray-400 mt-1 pl-[4.25rem]"><span>${day(vs[0].date)}</span><span>${day(vs.at(-1).date)}</span></div>
    </div>`;
}

function watchPanel(w) {
  const c = w.counts;
  const billRow = b => `
    <li class="py-3">
      <div class="flex flex-wrap items-center gap-2">${billLink(b)} ${stageChip(b)} <span class="text-[11px] text-gray-500">${sponsorText(b.sponsor)}</span></div>
      <p class="text-sm text-gray-900 mt-1">${esc(b.title)}</p>
      ${b.votes?.length ? `<p class="text-xs text-gray-500 mt-1">${b.votes.map(v => `${v.chamber} ${day(v.date)}: <span class="${v.passed ? "text-green-700" : "text-red-700"}">${esc(v.result)}</span> ${v.yea}–${v.nay}`).join(" · ")}</p>` : ""}
    </li>`;
  return `
    <p class="text-sm text-gray-600 max-w-3xl">${esc(w.intro)}</p>
    <p class="text-base text-gray-900 mt-3"><strong>${c.measures}</strong> measures focused on ${esc(w.label)} reached the floor or became law${c.law ? ` (${c.law} became law)` : ""}, with <strong>${c.votes}</strong> recorded votes. Another <strong>${c.broad}</strong> broad bills include ${esc(w.label)} provisions.</p>
    <div class="mt-4">${timeline(w.focused)}</div>
    <div class="grid gap-4 lg:grid-cols-2 mt-4">
      <div class="bg-surface border border-gray-200 rounded-xl p-5">
        <p class="text-sm font-semibold text-gray-900">Focused on ${esc(w.label)} (${w.focused.length})</p>
        <ul class="divide-y divide-gray-100">${w.focused.map(billRow).join("") || `<li class="py-3 text-sm text-gray-500">None reached the floor.</li>`}</ul>
      </div>
      <div class="bg-surface border border-gray-200 rounded-xl p-5">
        <p class="text-sm font-semibold text-gray-900">Broad bills that include ${esc(w.label)} provisions (${w.broad.length})</p>
        <p class="text-xs text-gray-500 mt-1">Large packages, like appropriations and defense authorization bills, that cover many subjects. ${esc(w.label)} is one of them.</p>
        <ul class="divide-y divide-gray-100 mt-1">${w.broad.map(b => `<li class="py-2 flex flex-wrap items-center gap-2">${billLink(b)}${stageChip(b)}<span class="text-sm text-gray-800 w-full">${esc(b.title)}</span><span class="text-[11px] text-gray-500 w-full">${b.subject_count ?? "?"} CRS subjects</span></li>`).join("")}</ul>
      </div>
    </div>`;
}

function watchlists(s) {
  const keys = (s.watchlist_order || Object.keys(s.watchlists || {})).filter(k => s.watchlists?.[k]);
  if (!keys.length) return "";
  return `
    <section>
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 class="font-serif text-2xl font-bold text-gray-900">Watchlists</h3>
          <p class="text-sm text-gray-500">Narrower topics, defined by official CRS subject tags.</p>
        </div>
        <div class="flex flex-wrap gap-2" role="tablist" data-watch-tabs>
          ${keys.map((k, i) => `<button type="button" role="tab" data-watch="${k}" aria-selected="${i === 0}" class="px-3 py-1.5 text-xs font-semibold rounded-full ${i === 0 ? "bg-cta text-ink" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}">${esc(s.watchlists[k].label)} (${s.watchlists[k].focused.length + s.watchlists[k].broad.length})</button>`).join("")}
        </div>
      </div>
      <div class="mt-4" data-watch-panel>${watchPanel(s.watchlists[keys[0]])}</div>
    </section>`;
}

function laws(s) {
  const summary = b => b.summary
    ? `<ul class="list-disc pl-5 text-sm text-gray-700 space-y-1">${b.summary.map(p => `<li>${esc(p)}</li>`).join("")}</ul><p class="text-[11px] text-gray-400 mt-1">AI summary of the official CRS summary</p>`
    : `<p class="text-sm text-gray-500">${b.crs_summary_available === false ? "No official CRS summary yet." : "Not summarized yet."}</p>`;
  const chamberLine = (b, ch) => {
    const v = b.chamber_votes?.[ch];
    if (v) return `${ch}: <span class="text-gray-900 tabular-nums">${v.yea}–${v.nay}</span>`;
    const did = ch === "House" ? b.passed_house : b.passed_senate;
    return did ? `${ch}: passed without a recorded roll call` : `${ch}: —`;
  };
  return `
    <section>
      <h3 class="font-serif text-2xl font-bold text-gray-900">What became law <span class="text-base font-normal text-gray-500">(${s.laws.length})</span></h3>
      <p class="text-sm text-gray-500">${esc(s.label)} bills signed into law this Congress, with how each chamber voted.</p>
      ${s.laws.length ? `<div class="grid gap-4 md:grid-cols-2 mt-4">${s.laws.map((b, i) => `
        <article class="bg-surface border border-gray-200 rounded-xl p-5 ${i >= 6 ? "hidden" : ""}" data-law-card>
          <div class="flex flex-wrap items-center gap-2">${billLink(b)} ${stageChip(b)}${b.law_number ? `<span class="text-[11px] text-gray-500">Public Law ${esc(b.law_number)}</span>` : ""}</div>
          <h4 class="font-serif text-lg font-bold text-gray-900 mt-2 leading-snug">${esc(b.title)}</h4>
          <div class="mt-2">${summary(b)}</div>
          <div class="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
            <p>${chamberLine(b, "House")} · ${chamberLine(b, "Senate")}</p>
            ${b.sponsor ? `<p>Sponsor: ${esc(b.sponsor.name)} (${esc(b.sponsor.party)}-${esc(b.sponsor.state)})${b.cosponsors_count != null ? ` · ${b.cosponsors_count} cosponsors` : ""}</p>` : ""}
          </div>
        </article>`).join("")}</div>
        ${s.laws.length > 6 ? `<div class="text-center mt-4"><button type="button" data-show-laws class="px-4 py-2 text-sm font-semibold rounded-lg bg-surface border border-gray-300 text-gray-700 hover:bg-gray-100">Show all ${s.laws.length} laws</button></div>` : ""}`
      : `<p class="text-sm text-gray-500 mt-3">None yet this Congress.</p>`}
    </section>`;
}

const partyRow = (p, c) => `
  <div class="flex items-center gap-2 text-xs" data-tip="${esc(`${PARTY_NAME[p]}: ${c.yea} Yea, ${c.nay} Nay${c.not_voting ? `, ${c.not_voting} not voting` : ""}`)}">
    <span class="w-24 shrink-0"><span class="inline-block px-1.5 py-0.5 rounded ring-1 ring-inset ${PARTY_CHIP[p]} font-semibold">${PARTY_NAME[p]}</span></span>
    <div class="flex-1 flex h-3 gap-[2px]">
      ${c.yea ? `<div class="rounded-l-sm" style="flex:${c.yea};background:${C.succeeded}"></div>` : ""}
      ${c.nay ? `<div class="rounded-r-sm" style="flex:${c.nay};background:${C.failed}"></div>` : ""}
      ${!c.yea && !c.nay ? `<div class="flex-1 bg-gray-200 rounded-sm"></div>` : ""}
    </div>
    <span class="w-20 text-right tabular-nums text-gray-600">${c.yea} Y · ${c.nay} N</span>
  </div>`;

function keyVotes(s) {
  return `
    <section>
      <h3 class="font-serif text-2xl font-bold text-gray-900">Recent key votes</h3>
      <p class="text-sm text-gray-500">The latest recorded floor votes on ${esc(s.label.toLowerCase())} measures, explained, with how your state's members voted.</p>
      <div class="space-y-4 mt-4">${s.key_votes.map(v => {
        const pb = v.party_breakdown || {};
        return `
        <article class="bg-surface border border-gray-200 rounded-xl p-5">
          <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-xs text-gray-500">${esc(v.chamber)} · ${day(v.date)} · ${billLink(v.bill)}</p>
              <h4 class="font-serif text-lg font-bold text-gray-900 mt-1 leading-snug">${esc((v.bill.title || "").length > 140 ? v.bill.title.slice(0, 140) + "…" : v.bill.title)}</h4>
              <p class="text-sm text-gray-600 mt-1"><span class="text-gray-800 font-medium">${esc(v.question)}.</span> ${esc(explainQuestion(v.question || ""))}</p>
            </div>
            <div class="flex items-center gap-2 sm:flex-col sm:items-end shrink-0">
              <span class="inline-block px-2.5 py-1 text-xs font-bold rounded ${v.passed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}">${esc(v.result)}</span>
              <span class="text-sm text-gray-900 tabular-nums">${v.yea}–${v.nay}</span>
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-2 mt-4">
            <div class="space-y-1.5">${["D", "R", "I"].filter(p => pb[p]).map(p => partyRow(p, pb[p])).join("")}</div>
            <div>
              <p class="text-xs text-gray-500 mb-1.5" data-my-label>Members from your state</p>
              <div class="flex flex-wrap gap-2" data-my-votes="${esc(v.id)}" data-chamber="${esc(v.chamber)}"><span class="text-xs text-gray-500">Loading…</span></div>
              <button type="button" data-open="vote" data-id="${esc(v.id)}" class="mt-2 text-xs text-accent hover:underline">How every member voted →</button>
            </div>
          </div>
        </article>`;
      }).join("") || `<p class="text-sm text-gray-500">No recorded votes yet.</p>`}</div>
    </section>`;
}

function agreement(s) {
  const bar = (same, total, lbl) => `
    <div data-tip="${esc(`${lbl}: majorities agreed on ${same} of ${total} votes`)}">
      <div class="flex justify-between text-xs"><span class="text-gray-700">${esc(lbl)}</span><span class="text-gray-900 font-semibold tabular-nums">${pct(same, total)}% agreed</span></div>
      <div class="h-2.5 mt-1 rounded-full bg-gray-100"><div class="h-2.5 rounded-full" style="width:${pct(same, total)}%;background:${C.accent}"></div></div>
    </div>`;
  return `
    <section>
      <h3 class="font-serif text-2xl font-bold text-gray-900">Do the parties agree on ${esc(s.label.toLowerCase())}?</h3>
      <p class="text-sm text-gray-500">Share of these votes where most Democrats and most Republicans voted the same way, compared with all votes this Congress.</p>
      <div class="mt-4 bg-surface border border-gray-200 rounded-xl p-5 space-y-5">
        ${["House", "Senate"].map(ch => {
          const t = s.agreement?.[ch] || { same: 0, opposed: 0 };
          const o = s.overall_agreement?.[ch] || { same: 0, opposed: 0 };
          const n = t.same + t.opposed, on = o.same + o.opposed;
          return `<div><p class="text-sm font-semibold text-gray-900 mb-2">${ch}</p><div class="space-y-2">
            ${n ? bar(t.same, n, `${s.label} votes (${n})`) : `<p class="text-xs text-gray-500">No ${s.label.toLowerCase()} votes in the ${ch} yet.</p>`}
            ${bar(o.same, on, `All ${ch} votes this Congress (${on})`)}
          </div></div>`;
        }).join("")}
        <p class="text-[11px] text-gray-400">"Agreed" means the majority of Democrats and the majority of Republicans voted the same way (Yea/Nay only; ties left out).</p>
      </div>
    </section>`;
}

function explainers(s) {
  return `
    <section>
      <h3 class="font-serif text-2xl font-bold text-gray-900">Understanding the process</h3>
      <div class="grid gap-4 md:grid-cols-3 mt-4">${(s.explainers || []).filter(k => EXPLAINERS[k]).map(k => `
        <article class="bg-surface border border-gray-200 rounded-xl p-5">
          <h4 class="font-serif text-lg font-bold text-gray-900">${esc(EXPLAINERS[k][0])}</h4>
          <p class="text-sm text-gray-700 mt-2">${esc(EXPLAINERS[k][1].slice(0, 190))}… <button type="button" class="text-accent hover:underline" data-explain="${k}">Read more</button></p>
        </article>`).join("")}
      </div>
      <div class="mt-4 flex flex-wrap gap-2 text-xs"><span class="text-gray-500 mr-1 py-1">Glossary:</span>${Object.entries(GLOSSARY).map(([t, d]) => `<button type="button" class="px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700 hover:border-accent/60" data-tip="${esc(d)}">${esc(t)}</button>`).join("")}</div>
    </section>`;
}

function definition(s) {
  const w = Object.values(s.watchlists || {});
  return `
    <section class="text-xs text-gray-500 border-t border-gray-200 pt-5 space-y-1.5">
      <p><strong class="text-gray-700">What counts as ${esc(s.label.toLowerCase())} here:</strong> measures whose CRS policy area is <em>${s.policy_areas.map(esc).join("</em>, <em>")}</em>.${w.length ? ` Watchlists use CRS subject tags (${w.map(x => `${esc(x.label)}: <em>${x.subjects.map(esc).join("</em>, <em>")}</em>`).join("; ")}) or the topic named in the title, and can include bills from other policy areas, such as defense and appropriations.` : ""}</p>
      ${w.length ? `<p><strong class="text-gray-700">Focused vs. broad:</strong> a watchlist measure is focused if its title names the topic or CRS assigned it ${FOCUSED_MAX_SUBJECTS} or fewer subjects; otherwise it's a broad bill that includes the topic.</p>` : ""}
      <p><strong class="text-gray-700">Coverage:</strong> bills that became law or got a recorded floor vote this Congress. Bills that never reached the floor aren't counted. More in <a href="#methodology" class="text-accent hover:underline">How we count</a>.</p>
      <p><strong class="text-gray-700">Sources:</strong> Congress.gov (bills, CRS subjects and summaries, actions, laws), Office of the Clerk of the U.S. House, U.S. Senate (senate.gov).${s.generated_at?.toDate ? ` Updated ${esc(s.generated_at.toDate().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}.` : ""}</p>
    </section>`;
}

// ---- interactive pieces

function stateSelectHtml(current) {
  return `<label class="text-gray-500" for="issue-state">Show members from:</label>
    <select id="issue-state" class="px-2.5 py-1 rounded-lg bg-surface border border-gray-300 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
      ${[...STATES, ...DELEGATE_JURISDICTIONS].map(([code, name]) => `<option value="${code}"${code === current ? " selected" : ""}>${esc(name)}</option>`).join("")}
    </select>`;
}

// Each call supersedes the previous one (fast state changes): late answers are dropped.
let myVotesRequest = 0;

async function fillMyVotes(root, state, getVote) {
  const request = ++myVotesRequest;
  root.querySelectorAll("[data-my-label]").forEach(el => { el.textContent = `Members from ${STATE_NAMES[state] || state}`; });
  const posBadge = pos => /yea|aye/i.test(pos) ? "bg-green-100 text-green-800" : /nay|no/i.test(pos) ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700";
  await Promise.all([...root.querySelectorAll("[data-my-votes]")].map(async el => {
    try {
      const vote = await getVote(el.dataset.myVotes);
      if (request !== myVotesRequest) return;
      const mine = (vote?.individual_votes || []).filter(m => m.state === state);
      el.innerHTML = mine.length
        ? mine.map(m => `<button type="button" data-open="member" data-id="${esc(m.bioguideId || "")}" class="text-xs px-2 py-1 rounded bg-gray-100 border border-gray-200 hover:border-accent/60"><span class="text-gray-800">${esc((m.name || "").split(",")[0])}</span> <span class="font-bold px-1 rounded ${posBadge(m.position || "")}">${esc(m.position || "—")}</span></button>`).join("")
        : `<span class="text-xs text-gray-500">No ${esc(el.dataset.chamber)} members from ${esc(STATE_NAMES[state] || state)} on this vote.</span>`;
    } catch {
      if (request === myVotesRequest) el.innerHTML = `<span class="text-xs text-gray-500">Couldn't load member positions.</span>`;
    }
  }));
}


// Small dialog with one explainer. Escape, the backdrop or Close shut it and return
// focus to what opened it; Tab stays on its Close button.
let explainerReturnFocus = null;
function closeExplainer(m) {
  if (m.classList.contains("hidden")) return;
  m.classList.add("hidden");
  m.classList.remove("flex");
  explainerReturnFocus?.focus?.();
}

function showExplainer(key) {
  const [title, body] = EXPLAINERS[key] || [];
  if (!title) return;
  let m = document.getElementById("explain-modal");
  if (!m) {
    m = Object.assign(document.createElement("div"), { id: "explain-modal", className: "fixed inset-0 z-50 hidden items-center justify-center bg-black/60 p-4" });
    m.addEventListener("click", e => { if (e.target === m || e.target.closest("[data-close-explainer]")) closeExplainer(m); });
    document.addEventListener("keydown", e => {
      if (m.classList.contains("hidden")) return;
      if (e.key === "Escape") closeExplainer(m);
      else if (e.key === "Tab") { e.preventDefault(); m.querySelector("[data-close-explainer]")?.focus(); }
    });
    document.body.appendChild(m);
  }
  explainerReturnFocus = document.activeElement;
  m.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="explain-title" class="bg-surface rounded-2xl max-w-lg w-full p-6 border border-gray-200"><h3 id="explain-title" class="font-serif text-xl font-bold text-gray-900">${esc(title)}</h3><p class="text-sm text-gray-700 mt-3 leading-relaxed">${esc(body)}</p><button type="button" class="mt-4 px-3 py-1.5 text-xs font-semibold rounded-lg bg-cta text-ink" data-close-explainer>Close</button></div>`;
  m.classList.remove("hidden");
  m.classList.add("flex");
  m.querySelector("[data-close-explainer]").focus();
}

// Render one topic page. ctx: { state, onStateChange(code), getVote(id) }
// The container stays; its content is replaced per topic. Listeners from the previous
// render (which hold the previous topic's data) are removed via this controller.
let wiring = null;

export function renderIssue(container, s, ctx) {
  wiring?.abort();
  wiring = new AbortController();
  const { signal } = wiring;
  container.innerHTML = `
    <div class="space-y-10">
      <div>
        <p class="text-sm text-gray-600 max-w-3xl">${esc(s.intro)}</p>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">${stateSelectHtml(ctx.state)}</div>
      </div>
      ${glance(s)}
      ${watchlists(s)}
      ${laws(s)}
      ${keyVotes(s)}
      ${agreement(s)}
      ${explainers(s)}
      ${definition(s)}
    </div>`;

  wireTooltip(container, { signal });
  fillMyVotes(container, ctx.state, ctx.getVote);

  container.querySelector("#issue-state").addEventListener("change", e => {
    ctx.onStateChange(e.target.value);
    fillMyVotes(container, e.target.value, ctx.getVote);
  }, { signal });
  container.addEventListener("click", e => {
    const tab = e.target.closest("[data-watch]");
    if (tab) {
      container.querySelectorAll("[data-watch]").forEach(t => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.className = `px-3 py-1.5 text-xs font-semibold rounded-full ${on ? "bg-cta text-ink" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`;
      });
      container.querySelector("[data-watch-panel]").innerHTML = watchPanel(s.watchlists[tab.dataset.watch]);
      return;
    }
    const ex = e.target.closest("[data-explain]");
    if (ex) return showExplainer(ex.dataset.explain);
    if (e.target.closest("[data-show-laws]")) {
      container.querySelectorAll("[data-law-card].hidden").forEach(el => el.classList.remove("hidden"));
      e.target.closest("[data-show-laws]").remove();
    }
  }, { signal });
}
