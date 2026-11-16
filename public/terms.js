// Term end and the election for a seat, from members.term ({ start, end, class }). Pure.
// Federal elections are on the Tuesday after the first Monday in November of the year
// before a term ends (terms end January 3). Who won is never stated: we don't have results.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = d => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;

export function electionDay(year) {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstMonday = 1 + ((8 - nov1.getUTCDay()) % 7);
  return new Date(Date.UTC(year, 10, firstMonday + 1));
}

// -> { termEnds: "January 3, 2029", election: "November 7, 2028", held: bool, class } or null.
export function termFacts(term, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(term?.end || "");
  if (!m) return null;
  const end = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const vote = electionDay(+m[1] - 1);
  return { termEnds: day(end), election: day(vote), held: today >= vote && today < end, class: term.class ?? null };
}
