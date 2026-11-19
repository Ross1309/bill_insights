// "My members" (#my-members): one page about the two senators and the representative for
// the address saved in this browser (cw-reps). Each member on their own: recent final votes,
// votes against their party's majority, missed votes with the chamber's typical rate, bills
// they sponsored, committees, term, and how to reach them. Never ranks or compares members.

import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { firestore, fetchFunction, getMember, getMemberVotes, loadParticipation } from "./data.js";
import { billName, callScriptHtml, contactLinks, escapeHtml as esc, formatDay, officialLabel, PARTY_BADGES, POSITION_BADGES, STATE_NAMES } from "./util.js";
import { lookupDistrict, memberPhoto, memberRole, myReps, rememberMyReps, repsFor, withContacts } from "./members.js";
import { missedLong } from "./participation.js";
import { committeesHtml } from "./modals.js";
import { termFacts } from "./terms.js";
import { againstParty, finalVotes, outcomeOf, voteHeadline } from "./plain.js";
import { MOVING_STAGES, stageSteps } from "./stage.js";
import { currentCongress, ordinal } from "./congress.js";

const POSITION_LABEL = { yea: "Yea", nay: "Nay", present: "Present", not_voting: "Not Voting" };
const SHOWN = 5;

// A member_votes "recent" entry -> a plain headline (no bill title is stored there).
// Nominations: the record has the nomination number but not the nominee's name.
const headline = e => (!e.bill_id && /^PN/i.test(e.legislation || "")
  ? `${e.chamber} ${outcomeOf(e.result) === "succeeded" ? "confirmed" : outcomeOf(e.result) === "failed" ? "rejected" : "voted on"} a nominee (${officialLabel(e.legislation)})`
  : voteHeadline({ chamber: e.chamber, question: e.question, outcome: outcomeOf(e.result), result: e.result,
  bill: e.bill_id ? { id: e.bill_id, label: e.legislation || e.bill_id, title: null } : null, legislation: e.legislation }));

const voteRow = e => `
  <li class="py-2">
    <button type="button" data-open="vote" data-id="${esc(e.id)}" class="text-left text-sm text-gray-900 hover:underline">${esc(headline(e))}</button>
    <span class="block text-xs text-gray-500">${esc(formatDay(e.date))}${e.party_majority && e.group !== e.party_majority && (e.group === "yea" || e.group === "nay") ? ` · most of their party voted ${esc(POSITION_LABEL[e.party_majority])}` : ""}
      · <strong class="inline-block px-1.5 rounded ${POSITION_BADGES[e.group] || "bg-gray-100 text-gray-700"}">${esc(POSITION_LABEL[e.group] || e.position || "Not recorded")}</strong></span>
  </li>`;

const section = (title, body, note = "") => `
  <section class="mt-5">
    <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500">${title}</h4>
    ${body}
    ${note ? `<p class="text-[11px] text-gray-500 mt-1">${note}</p>` : ""}
  </section>`;

// Cached per page view: reopening My members doesn't repeat the query (one read per bill).
const movedCache = new Map();
function movedBills(id) {
  if (!movedCache.has(id)) movedCache.set(id, queryMovedBills(id).catch(err => { movedCache.delete(id); throw err; }));
  return movedCache.get(id);
}
async function queryMovedBills(id) {
  const congress = currentCongress().congress;
  const snap = await getDocs(query(collection(firestore(), "bills"), where("sponsor.bioguideId", "==", id)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(b => Number(b.congress) === congress && MOVING_STAGES.includes(b.stage))
    .sort((a, b) => (b.latest_action_date || "").localeCompare(a.latest_action_date || ""));
}

async function memberHtml(saved, participation) {
  const [m, rec, moved, profile] = await Promise.all([
    getMember(saved.id).catch(() => null), getMemberVotes(saved.id).catch(() => null),
    movedBills(saved.id).catch(() => null), fetchFunction("member-profile", saved.id).catch(() => null),
  ]);
  const member = { ...saved, ...(m || {}) };
  const name = String(member.name || "").split(", ").reverse().join(" ");
  const t = rec?.totals;
  const finals = finalVotes(rec), breaks = againstParty(rec);
  const term = termFacts(member.term);
  const newest = (profile?.sponsored || []).filter(s => s.kind === "bill").slice(0, 3);
  return `
    <div class="flex items-start gap-4">
      ${memberPhoto(member)}
      <div class="min-w-0">
        ${member.party ? `<span class="text-xs font-semibold px-2 py-0.5 rounded ${PARTY_BADGES[member.party] || ""}">${esc(member.party)}</span>` : ""}
        <h3 class="font-serif text-xl font-bold text-gray-900 mt-1"><button type="button" data-open="member" data-id="${esc(member.id)}" class="text-left hover:underline">${esc(name)}</button></h3>
        <p class="text-sm text-gray-500">${esc(memberRole(member))} · ${esc(STATE_NAMES[member.state] || member.state || "")}</p>
        <p class="text-sm">${contactLinks(member.contact)}</p>
      </div>
    </div>
    <div class="grid gap-x-8 md:grid-cols-2">
      <div>
        ${section("Votes this Congress", t?.votes
          ? `<div class="mt-1">${missedLong(member, participation, t)}</div>${t.party_comparable ? `<p class="text-sm text-gray-800 mt-2">Voted with most of their party on <strong>${t.with_party} of ${t.party_comparable}</strong> votes where both took a side (${Math.round((t.with_party / t.party_comparable) * 100)}%).</p>` : ""}`
          : `<p class="text-sm text-gray-500 mt-1">No recorded votes for this member in the current Congress yet.</p>`)}
        ${section("Latest final votes", finals.length ? `<ul class="divide-y divide-gray-200">${finals.map(voteRow).join("")}</ul>` : `<p class="text-sm text-gray-500 mt-1">None among their latest recorded votes.</p>`,
          "Final votes on bills, resolutions and nominations.")}
        ${section("Voted against most of their party", breaks.length ? `<ul class="divide-y divide-gray-200">${breaks.map(voteRow).join("")}</ul>` : `<p class="text-sm text-gray-500 mt-1">Not on any of their latest ${rec?.recent?.length || 0} recorded votes.</p>`,
          `Among their latest ${rec?.recent?.length || 0} recorded votes, Yea or Nay only.`)}
      </div>
      <div>
        ${section("Bills they sponsored that moved", moved === null ? `<p class="text-sm text-gray-500 mt-1">Not available right now.</p>`
          : moved.length ? `<ul class="divide-y divide-gray-200">${moved.slice(0, SHOWN).map(b => `
            <li class="py-2"><button type="button" data-open="bill" data-id="${esc(b.id)}" class="text-left text-sm hover:underline"><span class="font-semibold text-accent">${esc(officialLabel(b.bill_number || b.id))}</span> <span class="text-gray-900">${esc(billName(b) || "")}</span></button>
              <span class="block text-xs text-gray-500">${esc(stageSteps(b)?.status || "")}</span></li>`).join("")}</ul>${moved.length > SHOWN ? `<p class="text-xs text-gray-500 mt-1">The latest ${SHOWN} of ${moved.length}.</p>` : ""}`
          : `<p class="text-sm text-gray-500 mt-1">None this Congress has passed a chamber yet.</p>`,
          "Passed at least one chamber this Congress. Most bills never get a vote.")}
        ${section("Newest bills they introduced", newest.length ? `<ul class="divide-y divide-gray-200">${newest.map(s => `
            <li class="py-2"><button type="button" data-open="bill" data-id="${esc(s.bill_id)}" class="text-left text-sm hover:underline"><span class="font-semibold text-accent">${esc(officialLabel(s.label))}</span> <span class="text-gray-900">${esc(s.title || "")}</span></button>
              <span class="block text-xs text-gray-500">Introduced ${esc(formatDay(s.introducedDate))}${s.latestAction?.text ? ` · ${esc(s.latestAction.text)}` : ""}</span></li>`).join("")}</ul>`
          : `<p class="text-sm text-gray-500 mt-1">${profile ? "None listed by Congress.gov." : "Not available right now."}</p>`)}
        ${member.committees ? committeesHtml(member.committees) : ""}
        ${term ? section("Term", `<p class="text-sm text-gray-800 mt-1">${term.special ? `Appointed until a special election on ${esc(term.election)}.` : `Current term ends ${esc(term.termEnds)}${term.class ? ` (Senate class ${term.class})` : ""}. ${term.held ? `The election for this seat was held ${esc(term.election)}.` : `Next election for this seat: ${esc(term.election)}.`}`}</p>`) : ""}
      </div>
    </div>`;
}

const form = (label = "Find") => `
  <form data-mine-find class="mt-3 flex gap-2 max-w-xl">
    <label for="mine-address" class="sr-only">Your home address</label>
    <input id="mine-address" type="text" autocomplete="street-address" maxlength="200" required placeholder="Street address, city, state"
      class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
    <button type="submit" class="px-3 py-2 rounded-lg bg-cta text-ink text-sm font-semibold hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent">${label}</button>
  </form>
  <p class="text-[11px] text-gray-500 mt-2">Sent to the U.S. Census Bureau's geocoder to find your district; not stored by us. Your members are remembered in this browser only.</p>
  <p data-mine-status class="text-sm mt-2 empty:hidden"></p>`;

let request = 0;
export async function loadMine() {
  const el = document.getElementById("mine-container");
  const mine = ++request;
  const reps = await withContacts(myReps());
  if (mine !== request) return;
  if (!reps?.members?.length || reps.stale) {
    el.innerHTML = `
      <h2 class="font-serif text-3xl font-bold text-gray-900">My members</h2>
      <p class="text-gray-600 mt-2 max-w-2xl">${reps?.stale ? "A new Congress began on January 3, and some district maps changed. Enter your address again to see your current members." : "Your two senators and your representative in one place: how they voted, when they voted against their party, what they sponsored, and how to reach them. Enter your home address to start."}</p>
      ${form()}`;
    return;
  }
  const place = reps.state && STATE_NAMES[reps.state] ? `${STATE_NAMES[reps.state]}${reps.district ? `'s ${ordinal(reps.district)} district` : ""}` : "";
  el.innerHTML = `
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-serif text-3xl font-bold text-gray-900">My members · ${esc(reps.code)}</h2>
        <p class="text-gray-600 mt-1 max-w-2xl">${esc(place)}. Each member on their own record, from official votes and Congress.gov. Members aren't compared or ranked.</p>
      </div>
      <div class="flex gap-2">
      <button type="button" data-forget-reps aria-label="Forget your members saved in this browser" class="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-600 border border-gray-300 hover:bg-gray-100">Forget</button>
      <button type="button" data-mine-change class="px-3 py-1.5 rounded-lg text-sm font-semibold text-accent border border-accent/40 hover:bg-accent/10">Change address</button>
      </div>
    </div>
    <div data-mine-change-form class="hidden">${form("Update")}</div>
    <div class="mt-4 max-w-2xl">${callScriptHtml({ code: reps.code })}</div>
    <div class="mt-6 space-y-6">${reps.members.map(m => `<article id="mine-${esc(m.id)}" class="bg-surface border border-gray-200 rounded-2xl p-5"><p class="text-sm text-gray-500">Loading ${esc(String(m.name || "").split(", ").reverse().join(" "))}…</p></article>`).join("")}</div>`;
  const participation = await loadParticipation().catch(() => null);
  await Promise.all(reps.members.map(async m => {
    const html = await memberHtml(m, participation).catch(err => `<p class="text-sm text-red-600">Couldn't load this member: ${esc(err.message)}</p>`);
    if (mine === request) document.getElementById(`mine-${m.id}`).innerHTML = html;
  }));
}

export function setupMine() {
  const el = document.getElementById("mine-container");
  el.addEventListener("submit", async ev => {
    const f = ev.target.closest("[data-mine-find]");
    if (!f) return;
    ev.preventDefault();
    const status = f.parentElement.querySelector("[data-mine-status]");
    status.className = "text-sm mt-2 text-gray-500";
    status.textContent = "Looking up your district…";
    try {
      const { state, district } = await lookupDistrict(f.querySelector("input").value.trim());
      rememberMyReps(state, district, await repsFor(state, district));
      await loadMine();
    } catch (err) {
      status.className = "text-sm mt-2 text-red-600";
      status.textContent = err.message;
    }
  });
  el.addEventListener("click", ev => {
    if (!ev.target.closest("[data-mine-change]")) return;
    const box = el.querySelector("[data-mine-change-form]");
    box?.classList.toggle("hidden");
    box?.querySelector("input")?.focus();
  });
}
