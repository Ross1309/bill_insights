// Where a bill is in the process, from its official action history (Congress.gov / Library
// of Congress). Shared by the server (bill enrichment stores `stage` + flags on each
// bill) and the page (the stage tracker on bill cards and in the bill window).
//
// Steps depend on the measure type:
//   bills and joint resolutions: Introduced, Committee, Passed <origin>, Passed <other>,
//     To the President, Law
//   concurrent resolutions:      Introduced, Committee, Agreed to in <origin>, in <other>
//   simple resolutions:          Introduced, Committee, Agreed to in <origin>
//   constitutional amendments (joint resolutions "Proposing an amendment to the
//   Constitution"): Introduced, Committee, Passed <origin>, Passed <other>; they go to
//   the states, not the President (ratification isn't tracked here)
// Only what the actions say counts; nothing is inferred.

import { termize } from "./glossary.js";

// Stages in order (introduced -> committee -> passed_one -> passed_both -> to_president -> law).
// Action text starts with "Passed/agreed to in House: …" on success and "Failed of
// passage/not agreed to in House: …" on failure, so match at the start (a substring test
// confuses the two).
export function stageFromActions(actions = [], { isLaw = false } = {}) {
  const texts = actions.map(a => (a.text || "").trim().toLowerCase());
  const has = re => texts.some(t => re.test(t));
  const passedHouse = has(/^passed\/agreed to in house/);
  const passedSenate = has(/^passed\/agreed to in senate/);
  let stage = "introduced";
  if (has(/referred to/)) stage = "committee";
  if (passedHouse || passedSenate) stage = "passed_one";
  if (passedHouse && passedSenate) stage = "passed_both";
  if (has(/presented to president/)) stage = "to_president";
  if (isLaw || has(/became (public|private) law/)) stage = "law";
  // Signing date: the "Became Public/Private Law" action (later actions, e.g. a committee
  // report filed afterwards, can follow it, so the latest action isn't always it).
  const lawAction = actions.find(a => /^became (public|private) law/i.test((a.text || "").trim()));
  return {
    stage,
    law_date: lawAction?.actionDate || null,
    passed_house: passedHouse,
    passed_senate: passedSenate,
    failed_house: has(/^failed of passage\/not agreed to in house/),
    failed_senate: has(/^failed of passage\/not agreed to in senate/),
    vetoed: has(/vetoed by president/),
  };
}

// Stages the Bills tab's "Moving or passed" view shows.
export const MOVING_STAGES = ["passed_one", "passed_both", "to_president", "law"];

const SIMPLE = new Set(["HRES", "SRES"]);
const CONCURRENT = new Set(["HCONRES", "SCONRES"]);
const isAmendment = (type, title) => (type === "HJRES" || type === "SJRES") && /^proposing an amendment to the constitution/i.test(String(title || ""));
// House rules ("Providing for consideration of the bill …") only set the terms of debate
// for another bill; the Bills tab's "Moving or passed" view leaves them out.
export const isRuleBill = bill => /^providing for consideration of/i.test(String(bill?.title || ""));

// { steps: [{ label, state: done|failed|todo }], status, final } or null when the bill has
// no stage data. `final` = nothing further can happen (law, vetoed, adopted resolution).
export function stageSteps(bill) {
  if (!bill?.stage) return null;
  const type = String(bill.type || "").toUpperCase().replace(/[.\s]/g, "");
  const origin = bill.chamber === "Senate" || (!bill.chamber && type.startsWith("S")) ? "Senate" : "House";
  const other = origin === "House" ? "Senate" : "House";
  const passed = { House: Boolean(bill.passed_house), Senate: Boolean(bill.passed_senate) };
  const failed = { House: Boolean(bill.failed_house), Senate: Boolean(bill.failed_senate) };
  const resolution = SIMPLE.has(type) || CONCURRENT.has(type);
  const amendment = isAmendment(type, bill.title);
  const passWord = c => (resolution ? `Agreed to in ${c}` : `Passed ${c}`);
  const chambers = SIMPLE.has(type) ? [origin] : [origin, other];
  const steps = [
    { label: "Introduced", reached: true },
    { label: "Committee", reached: bill.stage !== "introduced" },
    ...chambers.map(c => ({ label: passWord(c), reached: passed[c], failed: failed[c] && !passed[c], failLabel: `Failed in ${c}` })),
  ];
  if (!resolution && !amendment) {
    const vetoed = Boolean(bill.vetoed) && bill.stage !== "law";
    steps.push({ label: "To the President", reached: ["to_president", "law"].includes(bill.stage) && !vetoed, failed: vetoed, failLabel: "Vetoed" });
    steps.push({ label: "Law", reached: bill.stage === "law" });
  }
  // Everything before the furthest step reached counts as behind the bill.
  let furthest = 0;
  steps.forEach((s, i) => { if (s.reached || s.failed) furthest = i; });
  const out = steps.map((s, i) => ({
    label: s.failed ? s.failLabel : s.label,
    state: s.failed ? "failed" : i <= furthest ? "done" : "todo",
  }));

  const passedIn = chambers.filter(c => passed[c]);
  const failedIn = chambers.find(c => failed[c] && !passed[c]);
  let status, final = false;
  if (bill.stage === "law") { status = "Became law"; final = true; }
  else if (bill.vetoed) { status = "Vetoed by the President"; final = true; }
  else if (bill.stage === "to_president") status = "Sent to the President";
  else if (failedIn) status = `Failed in the ${failedIn}`;
  else if (resolution && passedIn.length === chambers.length) {
    status = chambers.length === 1 ? `Agreed to in the ${origin}` : "Agreed to by both chambers";
    final = true;
  } else if (amendment && passedIn.length === 2) { status = "Passed both chambers; goes to the states for ratification"; final = true; }
  else if (passedIn.length === 2) status = "Passed both chambers";
  else if (passedIn.length === 1) {
    const next = chambers.find(c => !passed[c]);
    status = `${resolution ? "Agreed to" : "Passed"} in the ${passedIn[0]}; next: the ${next}`;
  } else if (bill.stage === "committee") status = "In committee";
  else status = "Introduced";
  return { steps: out, status, final };
}

// The stage from a bill-detail response's actions, for bills not stored with a stage.
// Only when the full history came back (the function returns up to 100 actions).
export function stageFromDetail(d) {
  if (!d?.actions || (d.actionsCount != null && d.actionsCount > d.actions.length)) return null;
  return { type: d.type, chamber: d.originChamber || d.chamber, title: d.title, ...stageFromActions(d.actions) };
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SEG = { done: "bg-accent", failed: "bg-red-500", todo: "bg-gray-200" };

// compact: a thin segmented bar + status (bill cards). Full: labeled steps (bill window).
export function stageTrackerHtml(bill, { compact = false } = {}) {
  const s = stageSteps(bill);
  if (!s) return "";
  const aria = `Stage: ${s.status}. Steps: ${s.steps.map(x => `${x.label}${x.state === "todo" ? " (not yet)" : ""}`).join(", ")}.`;
  if (compact) {
    return `
      <div class="mb-3" role="img" aria-label="${esc(aria)}">
        <div class="flex gap-0.5" aria-hidden="true">${s.steps.map(x => `<span class="h-1.5 flex-1 rounded-full ${SEG[x.state]}" title="${esc(x.label)}"></span>`).join("")}</div>
        <p class="text-xs font-semibold text-gray-800 mt-1.5">${esc(s.status)}</p>
      </div>`;
  }
  return `
    <section class="mb-5" aria-label="Where this bill is">
      <p class="text-sm font-bold text-gray-900">${esc(s.status)}</p>
      <ol class="grid gap-1 mt-2" style="grid-template-columns:repeat(${s.steps.length},minmax(0,1fr))">
        ${s.steps.map(x => `
          <li class="min-w-0">
            <span class="block h-1.5 rounded-full ${SEG[x.state]}" aria-hidden="true"></span>
            <span class="block text-[11px] leading-tight mt-1 ${x.state === "todo" ? "text-gray-400" : x.state === "failed" ? "text-red-600 font-semibold" : "text-gray-700"}">${termize(esc(x.label))}<span class="sr-only">${x.state === "todo" ? " (not yet)" : x.state === "failed" ? "" : " (done)"}</span></span>
          </li>`).join("")}
      </ol>
      <p class="text-[11px] text-gray-500 mt-2">From the official action history. <a href="#how-laws-are-made" class="text-accent hover:underline">How a bill becomes law</a> · <a href="#methodology" class="text-accent hover:underline">How we count</a></p>
    </section>`;
}
