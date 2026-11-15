// Which Congress and session a date falls in, shared by the page and the server
// (netlify/lib/congress.js re-exports this). A Congress begins at noon on January 3 of
// each odd-numbered year (20th Amendment), so January 1–2 still belong to the outgoing
// Congress's second session.

// "Now", overridable on the server for rollover rehearsals (CW_TODAY=2027-01-04T12:00:00Z
// with scripts/rehearse.js). Never set in production.
export function today() {
  const fake = globalThis.process?.env?.CW_TODAY;
  return fake ? new Date(fake) : new Date();
}

export function currentCongress(now = today()) {
  const year = now.getUTCFullYear();
  const beforeJan3 = now.getUTCMonth() === 0 && now.getUTCDate() < 3;
  const effectiveYear = beforeJan3 ? year - 1 : year;
  return {
    congress: Math.floor((effectiveYear - 1789) / 2) + 1,
    session: effectiveYear % 2 === 1 ? 1 : 2,
  };
}

// The outgoing Congress keeps producing records for a few weeks after January 3: votes
// from its last days that the sources publish late, and bills the President signs
// (10 days, Sundays excepted, after they're presented; Congress.gov lags too). Until
// TAIL_DAYS after the new Congress begins, the nightly jobs also finish the previous
// one. Returns its number, or null.
export const TAIL_DAYS = 45;
export function outgoingCongress(now = today()) {
  const { congress, session } = currentCongress(now);
  if (session !== 1) return null;
  const start = Date.UTC(now.getUTCFullYear(), 0, 3);
  return now.getTime() - start < TAIL_DAYS * 86400e3 ? congress - 1 : null;
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

// Early in a new Congress there's almost nothing to chart, so the Overview and Issues
// stats keep showing the previous Congress until the new one has this many votes.
export const MIN_VOTES_TO_DISPLAY = 25;
