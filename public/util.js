// Small shared helpers: HTML escaping, formatting, party/state labels, modal bits.
import { DELEGATE_JURISDICTIONS, STATES } from "./states.js";

// localStorage that never throws (private mode etc.). Remembers the chosen Issues
// topic and "your members" state per browser.
export const store = {
  get(k, fallback) { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc. */ } },
};

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}
export const PARTY_NAMES = { R: "Republican", D: "Democratic", I: "Independent" };

export function formatVoteDate(iso) {
  if (!iso) return "Date not available";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export const STATE_NAMES = Object.fromEntries([...STATES, ...DELEGATE_JURISDICTIONS]);

// Outlined pastel chips: deliberately a different shape from the filled Yea/Nay
// tiles and badges, so party never reads as a vote position.
export const PARTY_TEXT = { D: "text-party-d", R: "text-party-r", I: "text-party-i" };

export function partyChip(name) {
  return `<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded ${PARTY_BADGES[name] || "bg-gray-100 text-gray-800"}">${escapeHtml(name)}</span>`;
}

export const PARTY_BADGES = {
  Democratic: "ring-1 ring-inset ring-party-d/70 text-party-d",
  Republican: "ring-1 ring-inset ring-party-r/70 text-party-r",
  Independent: "ring-1 ring-inset ring-party-i/60 text-party-i",
};
export const PARTY_ABBR = { Democratic: "D", Republican: "R", Independent: "I" };

export const isDelegate = m => DELEGATE_JURISDICTIONS.some(([code]) => code === m.state);
export const POSITION_BADGES = {
  yea: "bg-green-100 text-green-800", nay: "bg-red-100 text-red-800",
  present: "bg-gray-100 text-gray-700", not_voting: "bg-yellow-50 text-yellow-800",
};

// --- modal building blocks

export function spinner(text) {
  return `<div class="text-center py-10"><div class="inline-block animate-spin rounded-full h-6 w-6 border-4 border-accent border-t-transparent mb-3"></div><p class="text-sm text-gray-500">${escapeHtml(text)}</p></div>`;
}

export function errorBlock(message, lead = "Couldn't load this from Congress.gov right now.") {
  return `
    <div class="text-center py-8">
      <p class="text-sm text-red-600">${escapeHtml(lead)}</p>
      <p class="text-xs text-gray-400 mt-1">${escapeHtml(message)}</p>
      <button type="button" data-retry class="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-cta text-ink hover:bg-cta-light">Retry</button>
    </div>`;
}

export function factList(facts) {
  return `<dl>${facts.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v, raw]) =>
    `<div class="flex gap-3 py-1.5 border-b border-gray-100 text-sm"><dt class="w-36 shrink-0 text-gray-500">${escapeHtml(k)}</dt><dd class="text-gray-900 min-w-0">${raw ? v : escapeHtml(String(v))}</dd></div>`).join("")}</dl>`;
}

export function memberLink(id, label) {
  return id
    ? `<button type="button" data-open="member" data-id="${escapeHtml(id)}" class="text-accent hover:underline text-left">${escapeHtml(label)}</button>`
    : escapeHtml(label);
}

export function externalLink(url, label) {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="text-accent hover:underline">${escapeHtml(label)} →</a>` : "";
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
