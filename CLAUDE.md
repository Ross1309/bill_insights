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
netlify/functions/sync-votes.js    Syncs recent BILLS (name is historical) + AI summaries
netlify/functions/ingest-votes.js  Syncs WA members + 5 latest House roll-call votes
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
node run-ingest.js                                  # members (WA) + House votes
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

**`votes`** — doc id `{congress}-house-vote-{rollCall}`, written by `ingest-votes.js`
```
vote_id, bill_id (matches bills doc id, or null), chamber, congress, roll_call_number,
date, question, result, tallies { yea, nay, present, not_voting, ... },
individual_votes [{ bioguideId, name, state, party, position }], updatedAt
```

**`members`** — doc id = bioguideId
```
bioguideId, name ("Last, First"), state, party, chamber, district, imageUrl, updatedAt
```

## Current state (as of 2026-11-10)

Working: all three tabs render live Firestore data; bill cards show bill number, policy
area, sourced summary bullets, latest action, Congress.gov link; search matches
title / policy area / bill number ("HR 10914", "hr10914", "10914"); category filter
buttons work.

Pending / known issues:
- **Backfill not yet run.** Existing bill docs (~9) still have rotated fake categories,
  some speculative title-only summaries, and some "Impact details pending analysis."
  placeholders. Run `node scripts/backfill-bills.js --write --summaries` once.
- Uncommitted work in the tree (app.js changes, new lib/scripts, CLAUDE.md,
  .gitignore). Review the diff before committing.
- `node_modules/` (~5k files) is tracked in git. Should be `git rm -r --cached
  node_modules` + added to `.gitignore`.
- `sync-votes.js` must stay under Netlify's function timeout: detail fetches run in
  parallel and AI summaries are capped at 3 per run.

## Next steps (in priority order)

1. **Votes tab → `votes` collection.** `renderVotesFromBills` currently just re-lists
   bills with their latest action. Query `votes` (orderBy `date` desc), show
   question, result, tallies, date; link to the bill via `bill_id`; party breakdown
   from `individual_votes`.
2. **Members for all states.** `ingest-votes.js` only syncs WA, so CA/OR/NY/TX in the
   dropdown are empty. Loop all states (or the dropdown's list), filter to current
   members (Congress.gov `currentMember=true`), and expand the dropdown to 50 states.
   Also switch `ingest-votes.js` to `netlify/lib/firebase.js`.
3. **Server-side ordering + pagination** for bills (`orderBy('update_date','desc')`,
   `startAfter` cursors). Safe once the backfill has run — docs missing the field
   would drop out of an orderBy query.
4. **Detail modal** per bill/vote (full summary, actions, how each member voted).
5. Consider renaming `sync-votes.js` → `sync-bills.js` (check any schedules first).
