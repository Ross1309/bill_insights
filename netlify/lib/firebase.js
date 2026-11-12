// firebase-admin v14 (modular API; the old `admin.apps` / `admin.firestore()` namespace
// is gone). Callers use getDb() and admin.firestore.FieldValue, kept below so their
// code didn't have to change.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

// Accepts FIREBASE_SERVICE_ACCOUNT as raw JSON or base64-encoded JSON.
export function getDb() {
  if (!getApps().length) {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawKey) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');

    const serviceAccount = rawKey.trim().startsWith('{')
      ? JSON.parse(rawKey)
      : JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));

    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

export const admin = { firestore: { FieldValue } };

// BulkWriter whose close() throws if any write failed. Firestore's own close() "will
// never be rejected": a failed write only rejects the promise set()/update() returned,
// which nobody awaits (an unhandled rejection), and the caller carries on as if all was
// saved (e.g. flagging votes as applied). Use this everywhere instead of db.bulkWriter().
export function bulkWriter(db) {
  const writer = db.bulkWriter();
  const failures = [];
  const track = promise => { promise.catch(err => failures.push(err)); return promise; };
  return {
    set: (ref, data, options) => track(options ? writer.set(ref, data, options) : writer.set(ref, data)),
    update: (ref, data) => track(writer.update(ref, data)),
    async close() {
      await writer.close();
      if (failures.length) throw new Error(`${failures.length} Firestore write(s) failed, e.g. ${failures[0].message}`);
    },
  };
}
