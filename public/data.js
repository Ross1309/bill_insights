// Firestore client, shared caches and data access (Firestore docs + Netlify functions).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { collection, doc, getDoc, getDocs, getFirestore, limit, query, where } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB53n86BTG9co1S8Ek0Acvx4onbzvXQD8Y",
    authDomain: "congress-watcher-b0dd3.firebaseapp.com",
    projectId: "congress-watcher-b0dd3",
    storageBucket: "congress-watcher-b0dd3.firebasestorage.app",
    messagingSenderId: "775303136240",
    appId: "1:775303136240:web:ab13bd736700a29cfe5335"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// Every bill seen this session, by id (used to label votes with bill titles).
export const billCache = new Map();

// stats/overview, shared by the Overview tab and the header cards (one read per visit).
let overviewDocPromise = null;
export function getOverviewDoc() {
  overviewDocPromise ??= getDoc(doc(db, "stats", "overview")).catch(err => { overviewDocPromise = null; throw err; });
  return overviewDocPromise;
}
export const voteCache = new Map();

// Members seen this session, by id (directory entries or full member docs).

export const memberById = new Map();
const functionCache = new Map();
// Rate-limited functions are served at their own paths (see each function's config).
const FUNCTION_PATHS = { "member-profile": "/api/member-profile", "bill-detail": "/api/bill-detail" };

export function fetchFunction(name, id) {
  const key = `${name}:${id}`;
  if (!functionCache.has(key)) {
    functionCache.set(key, fetch(`${FUNCTION_PATHS[name] || `/.netlify/functions/${name}`}?id=${encodeURIComponent(id)}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body;
      })
      .catch(err => { functionCache.delete(key); throw err; }));
  }
  return functionCache.get(key);
}

export async function getFirestoreDoc(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getMember(id) {
  if (memberById.has(id)) return memberById.get(id);
  const m = await getFirestoreDoc("members", id);
  if (m) memberById.set(id, m);
  return m;
}

export async function getBill(id) {
  if (billCache.has(id)) return billCache.get(id);
  const b = await getFirestoreDoc("bills", id);
  if (b) billCache.set(id, b);
  return b;
}

export async function getVote(id) {
  if (voteCache.has(id)) return voteCache.get(id);
  const v = await getFirestoreDoc("votes", id);
  if (v) voteCache.set(id, v);
  return v;
}

export async function getVotesForBill(billId) {
  const snap = await getDocs(query(collection(db, "votes"), where("bill_id", "==", billId), limit(50)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
