import admin from 'firebase-admin';

// Accepts FIREBASE_SERVICE_ACCOUNT as raw JSON or base64-encoded JSON.
export function getDb() {
  if (!admin.apps.length) {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawKey) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.');

    const serviceAccount = rawKey.trim().startsWith('{')
      ? JSON.parse(rawKey)
      : JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));

    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin.firestore();
}

export { admin };
