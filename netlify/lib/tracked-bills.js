// Which bills the issue tracker follows, in one server-only doc: sync_state/tracked
//
//   { ids: [bill ids with enriched_at], laws: [bill ids stored with stage "law"] }
//
// sync-bills' nightly refresh lists the 250-750 bills Congress.gov changed that day
// plus every law, and needs to know which of those we track. Checking this one doc
// replaces reading each of those bills. Everything that enriches a bill calls
// markTracked(); scripts/build-tracked-bills.js rebuilds the doc from `bills`.

const ref = db => db.collection('sync_state').doc('tracked');

// `bills`: [{ id, stage }] just enriched and written.
export async function markTracked(db, admin, bills) {
  const ids = bills.map(b => b.id).filter(Boolean);
  if (!ids.length) return;
  const { arrayUnion } = admin.firestore.FieldValue;
  const laws = bills.filter(b => b.stage === 'law').map(b => b.id);
  // set+merge (not update): works before the doc exists. If it doesn't exist yet,
  // loadTracked() still returns null until the build script marks it complete.
  await ref(db).set({ ids: arrayUnion(...ids), ...(laws.length ? { laws: arrayUnion(...laws) } : {}) }, { merge: true });
}

// { ids: Set, laws: Set }, or null when the doc hasn't been built yet (callers then
// look the bills up directly).
export async function loadTracked(db) {
  const d = (await ref(db).get()).data();
  if (!d?.complete) return null;
  return { ids: new Set(d.ids || []), laws: new Set(d.laws || []) };
}

// Full rebuild from the bills collection (~1 small read per bill). Scripts only.
export async function rebuildTracked(db, admin) {
  const snap = await db.collection('bills').select('enriched_at', 'stage').get();
  const tracked = snap.docs.filter(d => d.data().enriched_at);
  const ids = tracked.map(d => d.id);
  const laws = tracked.filter(d => d.data().stage === 'law').map(d => d.id);
  await ref(db).set({ ids, laws, complete: true, built_at: admin.firestore.FieldValue.serverTimestamp() });
  return { bills: snap.size, tracked: ids.length, laws: laws.length };
}
