// A member's current term, from a congress-legislators term (legislators-current.json):
// { start, end, class } (class = Senate class 1/2/3, else null), or null without one.
export function memberTerm(term) {
  if (!term?.end) return null;
  return { start: term.start || null, end: term.end, class: term.class ?? null };
}
