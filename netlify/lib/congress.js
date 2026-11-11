// Which Congress and session a date falls in. A Congress begins at noon on
// January 3 of each odd-numbered year (20th Amendment), so January 1–2 still belong
// to the outgoing Congress's second session.

export function currentCongress(now = new Date()) {
  const year = now.getUTCFullYear();
  const beforeJan3 = now.getUTCMonth() === 0 && now.getUTCDate() < 3;
  const effectiveYear = beforeJan3 ? year - 1 : year;
  return {
    congress: Math.floor((effectiveYear - 1789) / 2) + 1,
    session: effectiveYear % 2 === 1 ? 1 : 2,
  };
}

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

// Early in a new Congress there's almost nothing to chart, so the Overview and Issues
// stats keep showing the previous Congress until the new one has this many votes.
export const MIN_VOTES_TO_DISPLAY = 25;
