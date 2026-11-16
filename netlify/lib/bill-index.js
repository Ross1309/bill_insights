// stats/bill-titles: every stored bill's number, title (first 140 characters), stage and
// latest action date, in one ~330 KB doc, so the Bills tab can search all of them by word
// with one read (Firestore has no text search; the paged list holds only what's loaded).
// Rebuilt by sync-bills when it refreshed bills, and by scripts/build-stats.js.
//   { count, entries: [[id, "HR 1234", title, stage, "YYYY-MM-DD"]], generated_at }

import { billName } from '../../public/util.js';
export async function writeBillIndex(db, admin) {
  const snap = await db.collection('bills').select('bill_number', 'title', 'short_title', 'stage', 'latest_action_date').get();
  const entries = snap.docs.map(d => {
    const b = d.data();
    return [d.id, b.bill_number || '', String(b.short_title ? `${b.short_title} (${b.title || ''})` : billName(b) || '').slice(0, 140), b.stage || '', b.latest_action_date || ''];
  });
  await db.collection('stats').doc('bill-titles').set({ count: entries.length, entries, generated_at: admin.firestore.FieldValue.serverTimestamp() });
  return entries.length;
}
