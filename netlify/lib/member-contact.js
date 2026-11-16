// How to reach a member, from a congress-legislators term (legislators-current.json):
// { phone, url, form, office }, or null when the term has none. Only web links are kept.
export function memberContact(term) {
  if (!term) return null;
  const web = u => (/^https?:\/\//i.test(u || "") ? u : null);
  const c = { phone: term.phone || null, url: web(term.url), form: web(term.contact_form), office: term.office || null };
  return Object.values(c).some(Boolean) ? c : null;
}
