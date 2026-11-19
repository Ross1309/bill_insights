// Firestore client, shared caches and data access (Firestore docs + Netlify functions).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app-check.js";
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

// App Check: Firestore only serves requests from this site (an invisible reCAPTCHA
// Enterprise check; the site key is public). Server code (firebase-admin) isn't affected.
// Local dev and the smoke test can't always pass reCAPTCHA, so on localhost the SDK uses a
// debug token instead: it prints one in the console to register in Firebase (App Check ->
// Apps -> Manage debug tokens), unless one was set already (the smoke test sets its own).
const RECAPTCHA_ENTERPRISE_SITE_KEY = "6LeWOB0uAAAAACv-bHJFResrg5gcpAYUJewzSlGx";
if (["localhost", "127.0.0.1"].includes(location.hostname) && !self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
// Started on the first Firestore read, not at page load: Home comes from /api/home, so a
// visit that only reads Home never loads reCAPTCHA (~415 KB of script and ~1.6 s of work
// on a phone). Firestore waits for App Check's token on its first request either way.
const db = getFirestore(app);
let appCheckStarted = false;
export function firestore() {
  if (!appCheckStarted) {
    appCheckStarted = true;
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  return db;
}
// Every bill seen this session, by id (used to label votes with bill titles).
export const billCache = new Map();

// Home's docs (stats/overview, health, floor, participation): from /api/home (CDN-cached,
// no Firebase needed), else straight from Firestore. One request per visit.
// The endpoint gets 5 s to start answering (a slow function shouldn't hold Home on "Loading";
// a slow connection downloading the answer isn't cut off); a failed
// Firestore read of the overview passes its own error on, so a visitor whose blocker stopped
// App Check's reCAPTCHA gets that explanation (loadErrorHtml), not a generic one.
let homePromise = null;
const HOME_TIMEOUT_MS = 5000;
export function getHome() {
  if (homePromise) return homePromise;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), HOME_TIMEOUT_MS);
  homePromise = fetch("/api/home", { signal: abort.signal })
    .then(res => { clearTimeout(timer); return res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)); })
    .finally(() => clearTimeout(timer))
    .catch(async () => {
      const read = id => getDoc(doc(firestore(), "stats", id)).then(s => (s.exists() ? s.data() : null));
      const optional = id => read(id).catch(() => null);
      const [overview, health, floor, participation] = await Promise.all([read("overview"), optional("health"), optional("floor"), optional("participation")]);
      if (!overview) throw new Error("The home page data isn't available right now.");
      return { overview, health, floor, participation };
    })
    .catch(err => { homePromise = null; throw err; });
  return homePromise;
}

// stats/overview as a snapshot-like object ({ exists(), data() }), for the callers that
// read it (Home, search, Bills' topic links, follows).
export function getOverviewDoc() {
  return getHome().then(h => ({ exists: () => Boolean(h.overview), data: () => h.overview }));
}

// Full vote docs by id (see getVote).
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
  const snap = await getDoc(doc(firestore(), collectionName, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Directory entries (members.js) are a compact subset: the member window needs the full
// record (committees, contact), so only a full doc (it has bioguideId) counts as cached.
export async function getMember(id) {
  const cached = memberById.get(id);
  if (cached?.bioguideId) return cached;
  const m = await getFirestoreDoc("members", id).catch(err => { if (cached) return null; throw err; });
  if (m) memberById.set(id, { ...cached, ...m });
  return m ? memberById.get(id) : cached || null;
}

export async function getBill(id) {
  if (billCache.has(id)) return billCache.get(id);
  const b = await getFirestoreDoc("bills", id);
  if (b) billCache.set(id, b);
  return b;
}

// Full vote docs (with member positions), cached as promises so concurrent callers
// share one request. Misses and errors aren't cached.
export function getVote(id) {
  if (!voteCache.has(id)) {
    voteCache.set(id, getFirestoreDoc("votes", id).then(
      v => { if (!v) voteCache.delete(id); return v; },
      err => { voteCache.delete(id); throw err; }));
  }
  return voteCache.get(id);
}

// Cached per page view (reopening a bill or member, Back/Forward): a failed read isn't kept.
const memo = (cache, key, load) => {
  if (!cache.has(key)) cache.set(key, load().catch(err => { cache.delete(key); throw err; }));
  return cache.get(key);
};
const billVotesCache = new Map(), memberVotesCache = new Map();
export function getVotesForBill(billId) {
  // Summaries are enough for the bill's Votes tab (tallies + party table).
  return memo(billVotesCache, billId, async () => {
    const snap = await getDocs(query(collection(firestore(), "vote_summaries"), where("bill_id", "==", billId), limit(50)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  });
}
// A member's voting record (member_votes/<id>).
export const getMemberVotes = id => memo(memberVotesCache, id, () => getFirestoreDoc("member_votes", id));

// Missed votes per member + chamber medians (stats/participation), one read, cached.
let participationDoc = null;
export function loadParticipation() {
  participationDoc ??= getHome().then(h => h.participation || Promise.reject(new Error("missing")))
    .catch(() => getFirestoreDoc("stats", "participation"))
    .catch(err => { participationDoc = null; throw err; });
  return participationDoc;
}

// Every stored bill's number, title, stage and date (stats/bill-titles, ~330 KB): the
// Bills tab's word search. Loaded on the first word search, then cached.
let billIndexDoc = null;
export function loadBillIndex() {
  billIndexDoc ??= getFirestoreDoc("stats", "bill-titles").catch(err => { billIndexDoc = null; throw err; });
  return billIndexDoc;
}
