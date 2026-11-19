// "What changed since you last looked": follow bills, members and Issues topics on this
// device (localStorage `cw-follow`; nothing leaves the browser). Following records the
// item's current state as a baseline; Home lists what changed since, and "Mark all as
// seen" moves the baselines up to now.
//
//   cw-follow = { bills: { id: { label, stage, date, action } },
//                 members: { id: { label, chamber, state, votes, missed, last } },
//                 topics: { slug: { label, law, measures } } }

import { billName, escapeHtml as esc, officialLabel, store } from "./util.js";
import { stageSteps } from "./stage.js";
import { voteHeadline, outcomeOf } from "./plain.js";

const KEY = "cw-follow";
export const LIMITS = { bills: 20, members: 10, topics: 10 };

export function loadFollows() {
  try {
    const f = JSON.parse(store.get(KEY, "null")) || {};
    return { bills: f.bills || {}, members: f.members || {}, topics: f.topics || {} };
  } catch { return { bills: {}, members: {}, topics: {} }; }
}
const saveFollows = f => store.set(KEY, JSON.stringify(f));
export const followCount = (f = loadFollows()) => Object.keys(f.bills).length + Object.keys(f.members).length + Object.keys(f.topics).length;
export const isFollowing = (kind, id) => Boolean(loadFollows()[kind]?.[id]);

// Baselines: the state to compare against later.
export const billBaseline = b => ({ label: b.bill_number ? `${officialLabel(b.bill_number)}${billName(b) ? `: ${billName(b)}` : ""}` : b.id,
  stage: b.stage || null, date: b.latest_action_date || b.latestAction?.actionDate || null, action: b.latestAction?.text || null });
export const memberBaseline = (m, rec) => ({ label: String(m?.name || rec?.name || "").split(", ").reverse().join(" "), chamber: m?.chamber || rec?.chamber || null,
  state: m?.state || rec?.state || null, votes: rec?.totals?.votes ?? 0, missed: rec?.totals?.not_voting ?? 0, last: rec?.recent?.[0]?.date || null, congress: rec?.congress ?? null });
export const topicBaseline = t => ({ label: t.label, law: t.law ?? 0, measures: t.measures ?? 0 });

// Returns false when the list is full (the page says so).
export function setFollow(kind, id, baseline) {
  const f = loadFollows();
  if (!baseline) { delete f[kind][id]; saveFollows(f); return true; }
  if (!f[kind][id] && Object.keys(f[kind]).length >= LIMITS[kind]) return false;
  f[kind][id] = baseline;
  saveFollows(f);
  return true;
}

// --- What changed (pure: baselines + current data -> change items) ---------------------
const stageWord = b => stageSteps(b)?.status || null;

export function billChange(base, b) {
  if (!b) return null;
  if (b.stage && b.stage !== base.stage) return { what: `Now: ${stageWord(b) || b.stage}`, detail: b.latestAction?.text || null };
  const date = b.latest_action_date || b.latestAction?.actionDate || null;
  if (date && (!base.date || date > base.date)) return { what: "New action", detail: `${date}: ${b.latestAction?.text || ""}`.trim() };
  return null;
}

// rec: the member's member_votes doc. A new Congress resets the counts: then all votes are new.
export function memberChange(base, rec) {
  if (!rec?.totals) return null;
  const fresh = base.congress != null && rec.congress !== base.congress;
  const newVotes = fresh ? rec.totals.votes : rec.totals.votes - (base.votes || 0);
  if (newVotes <= 0) return null;
  const missed = fresh ? rec.totals.not_voting : rec.totals.not_voting - (base.missed || 0);
  const recent = (rec.recent || []).filter(e => !base.last || fresh || e.date > base.last).slice(0, 3);
  return {
    what: `${newVotes} new recorded vote${newVotes === 1 ? "" : "s"}${missed > 0 ? `, ${missed} missed` : ""}`,
    votes: recent.map(e => ({ id: e.id, position: e.position, headline: voteHeadline({ chamber: e.chamber, question: e.question, outcome: outcomeOf(e.result), result: e.result,
      bill: e.bill_id ? { id: e.bill_id, label: e.legislation || e.bill_id, title: null } : null, legislation: e.legislation }) })),
  };
}

export function topicChange(base, t) {
  if (!t) return null;
  const laws = (t.law ?? 0) - (base.law || 0), measures = (t.measures ?? 0) - (base.measures || 0);
  if (laws <= 0 && measures <= 0) return null;
  return { what: [laws > 0 && `${laws} new law${laws === 1 ? "" : "s"}`, measures > 0 && `${measures} more ${measures === 1 ? "bill or resolution" : "bills or resolutions"} voted on or enacted`].filter(Boolean).join(", ") };
}

// --- Follow button (bill/member window headers, Issues topic pages) ---------------------
export function followButtonHtml(kind, id) {
  const on = isFollowing(kind, id);
  return `<button type="button" data-follow="${esc(kind)}" data-id="${esc(id)}" aria-pressed="${on}"
    class="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border focus:outline-none focus:ring-2 focus:ring-accent ${on ? "bg-cta text-ink border-cta" : "text-accent border-accent/40 hover:bg-accent/10"}">${on ? "Following" : "Follow"}</button>`;
}
