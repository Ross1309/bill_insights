# Congress Watcher (bill_insights)

Non-partisan web app that tracks what the US Congress is actually doing: bills with
plain-language AI summaries, House roll-call votes, and a member directory by state.

## Ground rules

- **Never fabricate or placeholder congressional data.** No hardcoded vote counts,
  outcomes, or categories. If a value isn't available from the source, store `null`
  and show "pending"/"not available" in the UI. (Earlier versions wrote fake
  `outcome: 'Passed'` / `vote_counts: {yea: 218, nay: 205}` on every bill — that was
  removed; don't reintroduce anything like it.)
- AI summaries must be neutral, stick to the source text, and carry their source
  (`ai_summary.source`: `crs_summary` or `title_only`) so the UI can label them.
- Never commit `.env` (Firebase service account + OpenAI key). It's in `.gitignore`.

## Stack

- **Frontend:** `public/index.html` + `public/app.js` — vanilla ES modules, Tailwind via
  CDN, Firebase **v13.2.0** modular web SDK loaded from gstatic, reading Firestore
  directly. Three tabs: Bills & Summaries, Roll-Call Votes, Legislators by State.
- **Backend:** Netlify Functions (Node 20+, ESM, `"type": "module"`) using
  `firebase-admin`. Data sources: Congress.gov API v3, OpenAI (`gpt-4o-mini`).
- **Local dev:** `netlify dev` → http://localhost:8888 (publish dir `public`,
  functions dir `netlify/functions`).

## Layout

```
public/index.html, public/app.js   UI (no build step)
public/states.js                   State/delegate list, shared by UI dropdown and ingest
firestore.indexes.json             Composite indexes the UI's queries need
netlify/functions/sync-votes.js    Syncs recent BILLS (name is historical) + AI summaries
netlify/functions/ingest-votes.js  Syncs all current members + 5 latest House roll-call votes
netlify/functions/member-profile.js  GET ?id={bioguideId}: Congress.gov member detail +
                                   10 latest sponsored bills/amendments (key stays server-side)
netlify/functions/bill-detail.js   GET ?id={bill_id}: sponsor, cosponsor count, latest CRS
                                   summary, action history (works for bills not in `bills`)
netlify/lib/bills.js               Congress.gov fetch helpers, bill doc shaping,
                                   policy-area -> category map, summary generation
netlify/lib/firebase.js            firebase-admin init (raw or base64 service account)
scripts/backfill-bills.js          One-off cleanup/refresh of existing bill docs
run-ingest.js                      Runs ingest-votes handler locally
```

`netlify/lib/` sits outside the functions dir on purpose so Netlify doesn't deploy it
as a function; esbuild bundles it via imports.

## Commands

```
netlify dev                                         # app + functions on :8888
node run-ingest.js                                  # all current members + House votes
curl localhost:8888/.netlify/functions/sync-votes   # bill sync (10 bills, ≤3 summaries/run)
node scripts/backfill-bills.js                      # dry run
node scripts/backfill-bills.js --write [--summaries]
```

Env vars (`.env`): `CONGRESS_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY`.

## Firestore schema

**`bills`** — doc id `{type}{number}-{congress}` lowercase, e.g. `hr1234-119`
```
bill_id, congress (number), type ("HR"), number ("1234"), bill_number ("HR 1234"),
title, chamber, policy_area (CRS name or null),
category ("Economy" | "Healthcare" | "Foreign Affairs" | "Other" | "Uncategorized"),
introduced_date, update_date, latestAction { actionDate, text },
congress_gov_url,
ai_summary { bullet_points[], source: "crs_summary"|"title_only", model, generated_at },
synced_at
```

**`votes`** — doc id `{congress}-{session}-house-vote-{rollCall}` (roll-call numbers restart
each session), written by `ingest-votes.js`
```
vote_id, bill_id (bills doc id format, or null), legislation ("HR 9612" or null), chamber,
congress, session, roll_call_number, date (UTC ISO), question, vote_type, result,
tallies { yea, nay, present, not_voting } (Aye/No counted as yea/nay),
individual_votes [{ bioguideId, name, state, party ("R"/"D"/"I"), position }],
source_url (House Clerk XML), updatedAt
```
Congress.gov's `house-vote` list ignores `sort` and is unordered, so the ingest pages
through the whole congress and takes the newest by `startDate`.

**`members`** — doc id = bioguideId, written by `ingest-votes.js`
```
bioguideId, name ("Last, First"), state ("WA"), state_name ("Washington"),
party ("Democratic" | "Republican" | "Independent"), chamber ("House" | "Senate"),
district (number, null/0 for senators and at-large), imageUrl (Congress.gov depiction or null),
current (bool), updatedAt
```
Synced from `/member?currentMember=true` (3 pages, ~539 incl. 6 delegates). Members no
longer in that list are set `current: false`, never deleted; the UI queries
`state ==` + `current == true`.

## Current state (as of 2026-11-10)

Working: all three tabs render live Firestore data; bill cards show bill number, policy
area, sourced summary bullets, latest action, Congress.gov link; search matches
title / policy area / bill number ("HR 10914", "hr10914", "10914"); category filter
buttons work.

Votes tab reads the `votes` collection (orderBy `date` desc): question, result, tallies,
party breakdown, bill link (own bill data or Congress.gov), House Clerk source link.
Backfill has been run (verified 2026-11-10: no fake fields, all summaries sourced).

Pending / known issues:
- Title-only AI summaries can still speculate despite the prompt (e.g. HRES 1650: "It is
  likely to affect…"). Tighten the prompt or skip AI summaries until a CRS summary exists.
- `sync-votes.js` must stay under Netlify's function timeout: detail fetches run in
  parallel and AI summaries are capped at 3 per run.
- Votes link to bills that usually aren't in `bills` (bill sync only takes the 10 most
  recently updated). Consider syncing bills referenced by votes.

## Detail modals (frontend)

- One modal shell with a stack (Back button): anything with `data-open="member|bill|vote"
  data-id="…"` opens one, from the page or inside another modal. Escape / backdrop / ✕
  close all and return focus. Kinds are defined in `MODAL_KINDS` (load, header, tabs).
- **Member** (id = bioguideId): Overview / Voting Record / Legislation. Member doc from
  `memberById` or Firestore; details + sponsored items from `member-profile`.
- **Bill** (id = bill_id): Summary (sponsor → member modal, cosponsors, AI summary with
  source label, official CRS summary, latest action) / Actions (timeline; recorded House
  votes link to the vote modal by `{congress}-{session}-house-vote-{roll}`) / Votes
  (synced `votes` where `bill_id ==`). Works for bills not in `bills` via `bill-detail`.
- **Vote** (id = vote doc id): Results (tallies, party table, bill link, Clerk record) /
  How members voted (grouped by position; filter by name, a bare state code like "WA",
  or party; names open member modals). Unsynced roll calls say so.
- Functions are cached per id in the page and for 1h via `Cache-Control`. If they fail,
  modals still show Firestore data plus a Retry button.
- Voting Record = latest 50 `votes` (shared `getRecentVotes`) filtered to the member;
  "voted with party majority" = matches most of their party's Yea/Nay on that roll call
  (ties and Independents excluded). Senators: "Senate votes aren't tracked yet".
- Scaling note: once many votes accumulate, filtering the latest 50 client-side will
  miss older votes. Then add a `voter_ids` array to vote docs and query
  `array-contains` + `orderBy('date')` (needs a composite index).
- Not done: Tab-key focus trap inside the modal; deep links (e.g. `#bill/hr9612-119`).

## Bills paging (frontend)

- `loadBills` queries `bills` with `orderBy('update_date','desc')`, 12 per page,
  `startAfter(lastDoc)` cursors behind a "Load more bills" button.
- Category buttons filter in the query (`where('category','==',…)`), which needs the
  composite index (category ASC, update_date DESC) in `firestore.indexes.json`. Without
  it the UI shows "Category filtering isn't available yet". Created in the Firebase console
  2026-11-10; add new indexes to the JSON and create them the same way (or
  `firebase deploy --only firestore:indexes`).
- Search filters only the loaded pages (Firestore has no text search). Bill-number terms
  ("HR 1234", "H.R. 1234", "1234") also do an exact `number`/`type` lookup across the
  whole collection.
- `billCache` holds every bill seen; the Votes tab uses it to label bills.

## Reference: congress-watch.netlify.app (unmaintained, reviewed 2026-11-10)

A similar member-centric tracker the user likes. Borrow its good ideas, avoid its failures.

**Borrow**
- Member profile modal with tabs: Overview, Voting Record, Legislation, Money & Donors.
- Per-member Yea / Nay / Absent counts, computed from our `votes.individual_votes`.
- Directory filters: name/state/district search, party and chamber toggles.
- Headline counts (senators / representatives / states) and a stronger visual identity
  (it used dark navy + gold with serif headings; ours is plain gray Tailwind).

**Avoid**
- Hardcoded member lists: its 43 hand-picked members went stale (Gaetz, Rubio still
  listed). Always sync from Congress.gov with `currentMember=true`.
- Unsourced scores: its "Accountability ~ Estimated" numbers have no stated method. Only
  show numbers we can compute from stored source data, and say how.
- AI judging politicians ("promise kept rate"): not neutral. AI stays limited to
  summarizing official text, labeled with its source.
- Live-AI-only pages: its profiles now fail with "Failed to fetch". Keep the core data in
  Firestore so the site degrades gracefully when a backend call fails.

**Real data sources for member profiles**
- Voting record: `votes` collection (House only so far; 5 votes per ingest run).
- Legislation: Congress.gov `/member/{bioguideId}/sponsored-legislation` and
  `/cosponsored-legislation` (same API key, server side only).
- Money & donors: OpenFEC API (free key, not set up yet). Net worth / financial
  disclosures: messy, defer.

## Next steps (in priority order)

1. ~~Votes tab → `votes` collection.~~ Done.
2. ~~Members for all states.~~ Done (all states + delegates, current only, real photos).
3. ~~Server-side ordering + pagination~~ Done (see Bills paging above).
4. ~~Detail modals~~ Done for members, bills and votes (see Detail modals above).
5. Directory filters (name search, party, chamber) and headline counts.
6. Money & donors tab via OpenFEC.
7. Visual refresh.
8. Consider renaming `sync-votes.js` → `sync-bills.js` (check any schedules first).
