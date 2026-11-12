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
