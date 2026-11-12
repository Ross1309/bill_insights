# Congress Watcher (bill_insights)

Non-partisan site tracking what the US Congress is doing: bills with plain-language
summaries of the official CRS summary, every House and Senate roll-call vote, every member
(voting record, legislation, campaign finance), topic pages, and "find your representatives".
Live at https://congress-watcher.netlify.app. README.md is the human-facing overview; this
file is the working reference. Dated history lives in docs/HISTORY.md.

## Ground rules

- **Never fabricate or placeholder congressional data.** No hardcoded vote counts,
  outcomes, or categories. If a value isn't available from the source, store `null`
  and show "pending"/"not available" in the UI. (Earlier versions wrote fake
  `outcome: 'Passed'` / `vote_counts: {yea: 218, nay: 205}` on every bill — that was
  removed; don't reintroduce anything like it.)
- AI summaries must be neutral, stick to the source text, and carry their source.
  **Policy (2026-11-10): summaries are generated only from the official CRS summary**
  (`ai_summary.source: "crs_summary"`). No CRS summary -> no AI summary. The bill gets
  `crs_summary_available: false` and the UI says CRS hasn't published one yet. Title-only
  summaries speculated, so they were removed; don't reintroduce them. All of this goes
  through `summaryUpdate()` in `netlify/lib/bills.js`.
  Bills before the 93rd Congress (1973) are treated as having no CRS summary (none exist,
  and Congress.gov's summaries endpoint 500s for them).
- Never commit `.env` (Firebase service account + OpenAI key). It's in `.gitignore`.
- **Firestore security rules** (`firestore.rules`, published 2026-11-11): public *read* of
  `bills`, `votes`, `vote_summaries`, `members`, `directory`, `stats`, `member_votes`; no browser writes anywhere. Before
  that the project was `allow read, write: if true`, so anyone could change or delete data.
  The site only reads; all writes go through firebase-admin (functions/scripts), which
  bypasses rules. **Adding a new collection the site reads? Add a read rule** and
  republish (Firebase console → Firestore → Rules, or the Rules API).
- **Server writes:** use `bulkWriter(db)` from `netlify/lib/firebase.js`, never
  `db.bulkWriter()`: Firestore's `close()` never rejects, so a failed write would go
  unnoticed (and e.g. votes get flagged applied anyway). Nightly steps must be safe to
  re-run after a crash at any point (see member_votes `applied`).
- The Firebase *web* config in `public/data.js` (`apiKey: "AIza…"`) is public by design.
  Netlify's secret scanner flags it, so `netlify.toml` exempts that one value via
  `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES`. Never exempt or disable scanning for
  anything else.

## Stack

- **Frontend:** `public/index.html` + plain ES modules (entry `public/app.js`, no bundler),
  Tailwind v3 built to a committed `public/styles.css` (`npm run build:css`), Firebase
  **v13.2.0** modular web SDK from gstatic, reading Firestore directly. Tabs: Overview,
  Issues, Bills & Summaries, Roll-Call Votes, Legislators, plus `#methodology`.
- **Backend:** Netlify Functions (Node 22+ for firebase-admin 14; Netlify runs 24; ESM,
  `"type": "module"`). Data: Congress.gov API v3, senate.gov LIS XML, OpenFEC, U.S.
  Census geocoder, OpenAI (`gpt-4o-mini`, summaries only).
- **Local dev:** `netlify dev` → http://localhost:8888 (publish dir `public`,
  functions dir `netlify/functions`).

## Layout

```
public/index.html                  Page shell + static sections (How we count lives here)
tailwind.config.js, src/styles.css Theme + CSS source -> public/styles.css (committed; npm test
                                   fails if stale: scripts/check-css.js)
public/app.js                      Entry: startup, tab wiring, Overview/Issues loading, data freshness
public/data.js                     Firestore client + web config, caches, getMember/getBill/getVote, functions
public/util.js                     escapeHtml, formatting, party/state labels, modal building blocks
public/tabs.js                     switchTab + onTabOpen registry (each tab registers its loader)
public/router.js                   Shareable links: URL hash <-> tab/topic/state/detail, Back/Forward
public/bills.js, votes.js,         One module per tab (state stays inside its module; ESLint's
  members.js                         no-import-assign stops other modules reassigning it)
public/modals.js, finance.js       Detail modals (member/bill/vote) and the Campaign Finance tab
public/states.js                   State/delegate list, shared by UI dropdown and ingest
public/overview.js                 Overview tab charts (plain SVG/HTML) from stats/overview
public/issues.js                   Issues tab topic pages from stats/topic-<slug> (+ explainers, glossary)
netlify/lib/topics.js              Topic + watchlist definitions (CRS policy areas / subjects)
netlify/lib/topic-stats.js         computeTopicStats(): one stats/topic-<slug> doc per topic
scripts/import-topic-bills.js      Store + enrich every law and voted-on bill (resumable)
mockups/                           Design mockups (static, not deployed; `mockups` launch config)
firestore.indexes.json             Composite indexes the UI's queries need
netlify/functions/sync-bills.js    Syncs recent bills + AI summaries (was sync-votes.js)
netlify/functions/ingest-votes.js  Syncs all current members (+ directory doc) + every House and
                                   Senate roll-call vote not yet stored (≤40/chamber/run)
netlify/lib/congress.js            currentCongress() (Jan 3 rollover), ordinal(), MIN_VOTES_TO_DISPLAY
tests/*.test.js                    Unit tests (node:test); `npm test` = ESLint + these, gates Netlify builds
tests/smoke.js                     Browser smoke test (Playwright): every tab, filters, search, modals
scripts/check-health.js            Reads public stats/health; exit 1 if a nightly sync failed or is >20 h old
.github/workflows/ci.yml           On push: npm test + smoke test against ./public
.github/workflows/health.yml       Daily 12:00 UTC: check-health + smoke test against the live site
netlify/lib/senate-votes.js        senate.gov LIS XML -> `votes` docs (menu, vote parse, ET->UTC)
netlify/lib/house-votes.js         Congress.gov House votes -> `votes` docs (list + build doc)
netlify/lib/vote-stats.js          party_breakdown, alignment/category/outcome rules, computeOverview
netlify/lib/overview.js            writeOverviewStats(): rebuild stats/overview (ingest + script)
netlify/lib/member-votes.js        member_votes docs: per-member totals + latest 50 (applyNewMemberVotes)
netlify/lib/vote-index.js          vote_index docs: compact fields of every vote (stats + ingest read these)
netlify/lib/health.js              recordRun(): stats/health, latest run of each scheduled sync
netlify/lib/tracked-bills.js       sync_state/tracked: enriched bill ids + stored laws (markTracked)
scripts/build-tracked-bills.js     Rebuild sync_state/tracked from `bills` [--write]
netlify/lib/http.js                fetchWithRetry/getJson/getText (timeouts, retries, key masking), json()
netlify/lib/pool.js                pool(items, concurrency, fn), shared by functions and scripts
scripts/build-member-votes.js      Rebuild member_votes + vote_index from full votes [--write] [--congress N]
scripts/build-stats.js             Rebuild stats/overview [--backfill party_breakdown]
scripts/import-votes.js            Backfill all House + Senate votes of a congress (resumable)
scripts/repair-house-legislation.js Link House votes without a measure via the Clerk XML [--write]
scripts/import-bills.js            Backfill the N most recently updated bills (resumable)
scripts/summarize-bills.js         CRS-based AI summaries for stored bills (resumable)
netlify/functions/member-profile.js  GET /api/member-profile?id={bioguideId}: Congress.gov member detail +
                                   10 latest sponsored bills/amendments (key stays server-side)
netlify/functions/member-finance.js GET ?id={bioguideId}: OpenFEC totals, receipt sources,
                                   donation-size buckets, itemized by state (api.data.gov key)
netlify/functions/find-district.js POST /api/find-district {address}: Census geocoder -> { state, district }
netlify/functions/bill-detail.js   GET /api/bill-detail?id={bill_id}: sponsor, cosponsor count, latest CRS
                                   summary, action history (works for bills not in `bills`)
netlify/lib/bills.js               Congress.gov fetch helpers, bill doc shaping,
                                   policy-area -> category map, summary generation
netlify/lib/firebase.js            firebase-admin init (raw or base64 service account)
run-ingest.js                      Runs ingest-votes handler locally
docs/HISTORY.md                    Dated notes: reviews, backfills, first deploys, reference site
```

`netlify/lib/` sits outside the functions dir on purpose so Netlify doesn't deploy it
as a function; esbuild bundles it via imports.

## Commands

```
netlify dev                                         # app + functions on :8888
node run-ingest.js                                  # all current members + House votes
curl localhost:8888/.netlify/functions/sync-bills   # bill sync (10 bills, ≤3 summaries/run)
node scripts/import-votes.js [--write] [--chamber house|senate] [--congress 118] [--limit N]
node scripts/import-bills.js [--write] [--limit 2000]
node scripts/summarize-bills.js [--write] [--limit N] [--recheck-days 3]
node scripts/build-stats.js [--backfill]          # stats/overview + stats/topic-*
node scripts/import-topic-bills.js [--write] [--force]
npm test                                          # ESLint + styles.css up to date + unit tests
npm run build:css                                 # rebuild public/styles.css after changing classes
npm run smoke                                     # browser smoke test on ./public (needs: npx playwright install chromium)
SMOKE_URL=https://congress-watcher.netlify.app npm run smoke   # same, against the live site
npm run health                                    # did last night's syncs succeed?
```

**Checks and alerts.** ESLint runs in `npm test` (Netlify build) and catches undefined
names; it would have blocked the Nov 12 regression (a refactor deleted `renderFinanceTab`).
The smoke test fails on any page/console error. Locally it serves `public/` without
Netlify functions (their 404s are ignored; Campaign Finance is only checked live); both
modes read the real Firestore (~30 reads). GitHub Actions emails the repo owner when a
workflow fails, including the daily health check: that's the alert for failed nightly runs
(the site's stale notice only appears after 36 h).

Env vars (`.env`): `CONGRESS_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY`,
optional `FEC_API_KEY`. `CONGRESS_API_KEY` is an api.data.gov key, which OpenFEC also
accepts, so `member-finance` uses `FEC_API_KEY` if set, else `CONGRESS_API_KEY` (else
`DEMO_KEY` under `netlify dev` only). Set the same vars in Netlify's site settings.

## Firestore schema

**`bills`** — doc id `{type}{number}-{congress}` lowercase, e.g. `hr1234-119`
```
bill_id, congress (number), type ("HR"), number ("1234"), bill_number ("HR 1234"),
title, chamber, policy_area (CRS name or null),
category ("Economy" | "Healthcare" | "Foreign Affairs" | "Other" | "Uncategorized"),
introduced_date, update_date, latestAction { actionDate, text },
latest_action_date (= latestAction.actionDate, top-level for ordering; null if none),
congress_gov_url,
ai_summary { bullet_points[], source: "crs_summary", model, generated_at } (or absent),
crs_summary_available (bool; null = enriched but never checked; absent on old docs),
crs_checked_at (ISO),
issue tracker (from fetchBillEnrichment): subjects[] (CRS legislative subjects),
subject_count, stage (introduced|committee|passed_one|passed_both|to_president|law),
passed_house, passed_senate, failed_house, failed_senate, vetoed, law_number,
sponsor { bioguideId, name, party, state }, cosponsors_count,
topics[] (topic + watchlist slugs), topic_focus { <watchlist>: bool }, enriched_at,
synced_at
```

**`votes`** — doc id `{congress}-{session}-{house|senate}-vote-{rollCall}` (roll-call numbers
restart each session), written by `ingest-votes.js`
```
vote_id, bill_id (bills doc id format, or null), legislation ("HR 9612", "PN 1129", or null),
chamber ("House" | "Senate"), congress, session, roll_call_number, date (UTC ISO), question,
vote_type, result, tallies { yea, nay, present, not_voting } (Aye/No counted as yea/nay),
individual_votes [{ bioguideId, name, state, party ("R"/"D"/"I"), position }],
source_url (House Clerk XML / senate.gov vote page), updatedAt
party_breakdown { D|R|I: { yea, nay, present, not_voting } } (from individual_votes)
Senate only: document_title (bill title or nomination text), amendment, title,
individual_votes[].lis_member_id
```
- House: Congress.gov's `house-vote` list ignores `sort` and is unordered, so the ingest
  pages through the whole congress and takes the newest by `startDate`.
- Senate: Congress.gov has no Senate vote endpoint (404 as of 2026-11-10), so votes come
  from senate.gov LIS XML (`vote_menu_{c}_{s}.xml`, newest first, then each
  `vote_{c}_{s}_{00000}.xml`). Senators are identified by LIS id and mapped to bioguideId
  via congress-legislators `id.lis` (100/100 mapped). Times are Eastern, converted to UTC
  with DST. Nominations (`PN`) get `legislation` + `document_title` but no `bill_id`.
- House and Senate syncs run in parallel and independently (`Promise.allSettled`). A full
  ingest takes ~3–15 s locally (Congress.gov's House list is the slow part); scheduled
  functions get 30 s.
- House `legislation`/`bill_id` come from Congress.gov, else from the House Clerk's vote XML
  (`<legis-num>`, `legislationFromClerk` in house-votes.js; then `legislation_source:
  "House Clerk"`). Congress.gov never fills in the bill for amendment votes and fills new
  votes in hours late; 96 of 685 House votes were unlinked until 2026-11-12, when
  `scripts/repair-house-legislation.js --write` fixed them (7 left: quorum calls,
  adjournment, Speaker election, which have no measure). Stored votes aren't re-fetched.
- Congress.gov bill action histories lag senate.gov by about a day, so a brand-new Senate
  vote may not be linked from the bill's Actions tab yet.

**`stats/overview`** — single doc (~12 KB), rebuilt by `ingest-votes.js` (only when votes,
bills or members changed, or the last run failed), `sync-bills` (when it refreshed bills)
and `scripts/build-stats.js`; read once per visit, shared by the Overview tab and header cards
```
congress, headline { senate|house|delegates: { count, parties { Republican: n, … } },
  bills, votes } (header cards; bills/votes are all-Congress counts),
first_vote_date, last_vote_date, totals { House, Senate },
weekly [{ week (Monday, ET), House, Senate }] (continuous, zeros = no votes),
monthly [{ month, House|Senate: { same, opposed, unclear } }],
alignment_totals { House|Senate: { same, opposed, unclear } },
outcomes { House|Senate: { passage|cloture|nomination|amendment|procedural|other:
  { succeeded, failed, other } } },
delegations { WA: { D, R, I, other, senators, representatives, delegate } },
votes_without_party_breakdown, generated_at
```
Built from `select()`ed small vote fields (needs `party_breakdown` on every vote).

**`stats/topic-<slug>`** — one per topic in `topics.js` (economy, healthcare,
foreign-affairs), rebuilt with stats/overview (same `writeOverviewStats` call)
```
slug, label, intro, policy_areas, explainers, counts { measures, law, passed_both,
passed_one, none, votes }, laws [compact bill + chamber_votes {House|Senate: {yea,nay}}],
key_votes [5 latest, with party_breakdown + bill], agreement {House|Senate: {same,opposed}},
overall_agreement, watchlists { <slug>: { label, intro, subjects, counts, focused [bill +
votes], broad [bill] } }, watchlist_order, congress, generated_at
```

**`member_votes`** — doc id = bioguideId, public read. One per member for the current Congress
```
bioguideId, congress, chamber, name, party, state,
totals { votes, yea, nay, present, not_voting, with_party, party_comparable },
recent [latest 50: { id, date, chamber, roll, question, result, bill_id, legislation,
  position, group (yea|nay|present|not_voting|other), party_majority }],
applied [voteKey of every vote counted, e.g. "2h323"], updated_at
```
One doc per member who voted this Congress (556: the 539 current members plus former
members). `applied` makes applying idempotent: a vote already in it is skipped, so a run
that crashed after writing member docs but before flagging votes can't double-count
(verified 2026-11-12 by re-applying a vote: totals unchanged). ~7 KB for a senator.
The member modal's Voting Record reads this one doc. Each `votes` doc has `members_applied`
(false when written by ingest/import, true once counted). Every ingest applies all
unapplied votes of the Congress to member_votes, vote_index **and** vote_summaries, then flags them, so
a failed run is retried next time. Totals reset when `congress` changes.
`scripts/build-member-votes.js --write` rebuilds all three from scratch (~1,600 full-vote reads).
Votes written by code that doesn't set `members_applied` (anything older than commit
a547327) are never applied: re-run the build script after such a run.

**`vote_summaries`** — doc id = vote id, public read. A `votes` doc without
`individual_votes`/`members_applied`/`updatedAt`, plus `member_count` (~0.6 KB vs ~36 KB).
Written with vote_index when votes are applied (`writeVoteSummaries`). The Votes tab and a
bill's Votes tab read these (a page of 10: 6 KB instead of 365 KB); the vote modal's member
list loads the full `votes` doc. Needs the (chamber ASC, date DESC) index for the chamber
filter (fallback otherwise, see Votes paging).

**`vote_index/{congress}-{session}-{house|senate}`** — server-only (no read rule)
```
congress, session, chamber, count, entries [{ id, date, roll, question, result, bill_id,
tallies, party_breakdown }] (oldest first), updated_at
```
`writeOverviewStats` reads these 4 docs instead of every vote (falls back to a `select()`
query when a Congress has no index). The ingest treats ids in the index as stored and
`getAll`s only the rest, so a vote stored but not yet applied is never re-fetched.
About 300 bytes per vote, so a session's doc stays far below the 1 MB limit.

**`stats/health`** — public read, written by both scheduled syncs (`recordRun`)
```
ingest_votes | sync_bills: { last_run, last_success, ok, scheduled, failed_steps[], counts,
  last_scheduled_run, last_scheduled_ok, last_scheduled_success }
```
Step names only, no error text. `scheduled` = a real Netlify scheduled run (body has
`next_run` and `NETLIFY_DEV` is unset); run-ingest.js and `netlify dev` runs are manual.
`npm run health` judges the scheduled fields, so a manual run can't hide a failed night.
sync-bills fails its `summaries` step when every summary attempt fails (e.g. a revoked
OpenAI key), so that shows up too. The footer shows "Data last updated"; a notice appears
when either sync's last success is more than 36 h old.

**`members`** — doc id = bioguideId, written by `ingest-votes.js`
```
bioguideId, name ("Last, First"), state ("WA"), state_name ("Washington"),
party ("Democratic" | "Republican" | "Independent"), chamber ("House" | "Senate"),
district (number, null/0 for senators and at-large), imageUrl (Congress.gov depiction or null),
fec_ids (FEC candidate ids, from the public-domain unitedstates/congress-legislators
dataset; 537/539 have one), current (bool), updatedAt
```
Synced from `/member?currentMember=true` (3 pages, ~539 incl. 6 delegates). Members no
longer in that list are set `current: false`, never deleted; the UI queries
`state ==` + `current == true` only as a fallback (see `directory`).

**`directory/members`** — single doc, rewritten by every `ingest-votes.js` run (~100 KB)
```
members [{ id, name, state, party, chamber, district, imageUrl }] (all current members,
sorted by name), count, updatedAt
```
The Legislators tab and headline counts read this one doc (1 read instead of ~540) and
search/filter client-side. If it's missing or unreadable, the tab falls back to the
per-state `members` query and says nationwide search is unavailable.

## Operations

- **Deploys:** Netlify project **congress-watcher** auto-deploys `main` from GitHub
  `Ross1309/bill_insights`; build command `npm install && npm test`. Env vars set there:
  `CONGRESS_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY` (FEC reuses the Congress key).
- **Credits:** Personal plan, 1,000 credits per period (resets on the 11th, Pacific); builds
  are skipped once it's used up. Every production deploy costs credits: batch commits and
  push together. Docs-only commits can carry `[skip netlify]`, but never as the newest
  commit of a push that includes code (Netlify builds only the newest).
- **Schedules** (`netlify.toml`): `ingest-votes` 10:00 UTC, `sync-bills` 10:30 UTC. Scheduled
  functions get 30 s, run only on the published deploy and return 403 when called by URL in
  production (nobody can trigger OpenAI/Firestore spend). Run manually with **Run now** on
  the function's page in Netlify; locally `node run-ingest.js` / `netlify dev` + curl.
  Logs: `netlify logs --function ingest-votes --since 24h`.
- **Public functions:** `member-profile`, `bill-detail` (rate limit 60/min per visitor; the
  plan allows 2 rules, both used; rate-limited functions need explicit paths, hence
  `/api/...`) and `member-finance` set durable `Netlify-CDN-Cache-Control` (404s 1 h).
  `find-district` is POST-only, uncached, unlimited.
- **Congress rollover (Jan 3):** `currentCongress()` derives it from the date; nothing
  hard-codes 119. Stats keep describing the previous Congress until the new one has
  `MIN_VOTES_TO_DISPLAY` (25) votes. member_votes reset per Congress. find-district picks
  the new district map by itself (reorder its `VINTAGES` then).
- **Tracked bills stay current:** `sync-bills` re-enriches every tracked bill Congress.gov
  changed since `sync_state/bills.last_refresh`, plus new laws (≤60/run), then rebuilds
  stats. The list comes oldest first with dates only; with a backlog the window moves to
  the start of the earliest date still pending, and a bill enriched on/after its update
  date is skipped, so every run makes progress. Steps check a 28 s budget and stop early.
- **Waiting bills** (no CRS summary yet) are re-checked oldest check first via the
  (crs_summary_available, crs_checked_at) index (fallback: first 100 by id). A failed
  check still sets `crs_checked_at` (+ `crs_check_errors`), so it can't block the queue.
- **Member sync** refuses a list under 500 members (API trouble would otherwise retire
  everyone) and runs on its own, so its failure doesn't stop the vote sync.
- Data is complete for the 119th Congress (all votes; all 140 laws as of 2026-11-12).

`sync_state` is server-only (no read rule in firestore.rules, so browsers are denied):
- `sync_state/bills`: `last_refresh` window for sync-bills.
- `sync_state/members`: a 12-char fingerprint per current member + the directory's, so the
  nightly member sync writes only what changed (1 read instead of ~545 reads + writes).
- `sync_state/tracked`: `ids` (bills with `enriched_at`), `laws` (stored with stage law),
  `complete` (set only by the build script; until then callers fall back to reading the
  bills). sync-bills checks the day's 250–750 updated bills + 140 laws against it.

**Firestore read budget (free tier: 50k/day).** A visit costs ~2 reads (stats/overview,
stats/health); Bills loads on its tab, the 100 KB directory on Legislators. Nightly runs
cost ~1,000: mostly the member_votes docs of members who voted (~540 on a voting day).

### Code review (2026-11-12)
Three parallel reviews (backend, frontend, ops/data) found no data damage (every derived
collection reconciled exactly) but fixed: non-idempotent member apply + silent BulkWriter
failures; refresh window that could stall; member-list sanity; Issues tab breaking
browser Back and leaking listeners; a malformed link crashing startup; races in Issues
Back/Forward and the state picker; health check fooled by manual runs. The smoke test
now covers Back from Issues, repeated topic switches and malformed links.

### Open work (as of 2026-11-12)
- Healthcare/Economy coverage: focused/broad watchlists like Foreign Affairs (Healthcare shows
  11 measures because health provisions ride in budget bills).
- "What Congress did this week" digest; more topics (Immigration, Defense: add to topics.js
  + a chip in index.html, after the coverage fix).
- Waiting bills are re-checked 5 per sync run; with ~1,000 waiting, run
  `summarize-bills.js --write` occasionally (or schedule it) to catch new CRS summaries.
- Senate votes: the nightly ingest maps senators with the *current* congress-legislators
  file, so a senator who leaves can show unlinked on later votes;
  `import-votes.js --write --chamber senate` (uses historical too) fixes that.

## Issues tab (frontend)

Plain-language topic pages, built from the approved mockup (`mockups/foreign-affairs.html`).
- **Topics** (`netlify/lib/topics.js`): Economy, Healthcare, Foreign Affairs by CRS policy
  area. Foreign Affairs has **watchlists** Iran, Israel, Foreign aid: CRS subject tag OR the
  topic named in the title (H.R. 5334 "…Russia and Iran Act" has no *Iran* subject tag).
  A watchlist bill is **focused** if its title names the topic or it has ≤10 CRS subjects,
  otherwise **broad** (appropriations/NDAA with ~250 subjects). Pages print these rules.
- **Measures** = bills tagged with the topic that became law or got a recorded vote.
  Bills that never reached the floor aren't counted (coverage: `import-topic-bills.js`).
- **Stage** comes from actions; only actions *starting* "Passed/agreed to in …" count as
  passing ("Failed of passage/not agreed to in …" also contains "agreed to in").
- Sections: At a glance (template sentence + funnel), Watchlists (vote timeline, focused
  vs broad), What became law, Recent key votes (plain-English meaning of each question via
  `explainQuestion`, party Yea/Nay bars, members from the chosen state), party agreement vs
  all votes, explainers + glossary, definitions & sources.
- "Members from <state>" (no district info, so it's the whole delegation); topic and state
  are remembered in localStorage (`cw-issue`, `cw-state`). Key-vote positions are loaded
  from the 5 vote docs on demand (`getVote`).
- Explainer texts (`EXPLAINERS` in issues.js) are our own words. They were approved as part
  of the mockup on 2026-11-11; edit them there, carefully (War Powers text mentions
  INS v. Chadha).
- Nightly: `ingest-votes` enriches bills that new votes refer to (no OpenAI; marks
  `crs_summary_available: null`); `sync-bills` enriches its 10 recent bills (keeps "became
  law" current) and summarizes never-checked (null) bills first within its 3-summary budget.

## Overview tab (frontend, default tab)

Four charts in `public/overview.js`, plain SVG/HTML, one Firestore read (`stats/overview`):
1. **Activity:** roll-call votes per week, House and Senate rows on a shared y scale.
2. **Party agreement:** monthly 100% columns. "Majorities opposed" = most Democrats and
   most Republicans voted opposite ways (Yea/Nay only; ties -> "unclear", excluded). The
   definition is printed under the chart.
3. **Outcomes:** each question grouped by `voteCategory()` (passage, cloture, nomination,
   amendment, procedural, other) x `voteOutcome()` (succeeded/failed/other).
4. **Delegations:** equal-size state tile grid (`TILES`), party segments + counts; tap a
   state -> Legislators filtered to it. Territories in a strip below.

Every chart has hover/tap tooltips (`data-tip`), printed values, and "View as table".
Chart colors are deeper "mark" steps (OKLCH L 0.48–0.67, C ≥ 0.10) validated with the
dataviz palette checker against `#363636`: activity/agreed `#13a5b2`, opposed `#8f68cb`,
succeeded `#6fa326`, failed `#c04637`, party D `#707ed4` R `#d15b5c` I `#3ba888`. Pastels
stay for text and badges. Party fills are allowed **only in charts that show no Yea/Nay or
outcome colors** (the delegation map). Elsewhere the outlined-chip rule still holds.
Independent is teal in charts (gray fails the chroma floor) but stays gray as a chip.

No leaderboards or member-vs-member rankings (footer promise). Phase 2 ideas: member
participation + own party-agreement trend in profiles, List/Chart toggles. Phase 3:
bill-stage funnel (needs stage data), aggregate FEC totals.

## Visual design (frontend)

Dark theme (user-chosen palette, 2026-11-10): background `#2C2C2C`, text `#E4E4E4`, accent
cyan `#A8DADC`, accent pink `#FFC1CC`, buttons/CTA lavender `#B39CD0`.

- Theme lives in `tailwind.config.js` (rebuild with `npm run build:css`). Fonts: Inter (body) and
  Source Serif 4 (`font-serif`: headings, card/modal titles, stat numbers).
- **Grays are inverted** so existing classes read correctly on dark: `gray-50` = page
  background, `gray-100/200/300` = fills and borders, `gray-400…900` = text from faint to
  brightest. `bg-surface` (`#363636`) = cards, inputs, modal; `bg-surface-deep`
  (`#232323`) = header and footer. Don't use `bg-white`; the modal backdrop is `bg-black/60`.
- Roles: `text-accent` = links, `bg-accent` = data bars, `ring-accent` = focus; vote and bill
  badges = `bg-accent/10 text-accent`. **`pink` is decorative only** (active tab
  underline, headline-card labels). Pink sits next to party red, so it must never mark
  data. Lavender `bg-cta` buttons and active chips always use **`text-ink`**, because
  white on lavender is only 2.45:1.
- **Vote colors (filled):** pastel lime-green `#b5e48c` = Yea / passed / agreed / confirmed;
  pastel coral-red `#f4a07a` = Nay / rejected / errors. Tiles use dark tinted fills
  (`bg-green-50 border-green-200 text-green-700`, red likewise); badges `*-100` fill +
  `*-800` text. All pairs ≥ 6.6:1.
- **Party colors (outlined, never filled):** `party-r` `#f59a9a`, `party-d` `#a3b4f7`,
  `party-i` `#c4c4c4` (gray: a pastel purple sat too close to Democratic periwinkle). Use
  `PARTY_BADGES` / `partyChip()` (ring + text) for chips and `PARTY_TEXT` for small "D-WA"
  labels. The outline-vs-fill difference is what keeps "Republican" from reading as "Nay"
  (same red family) and "Democratic" from reading as "Yea", so don't fill party chips
  and don't use party colors for anything else.
- Pastels were picked by OKLab distance from the accents they sit next to (Yea vs cyan
  11.7, Nay vs pink 11.4, Yea vs Nay 18.4); every color also has a text label.
- Layout: header with headline stat cards (3 columns on phones, detail lines hidden below
  `sm`), sticky tab bar (`switchTab` sets classes + `aria-selected` and scrolls back to the
  bar if you're below it), sources footer.

## Legislators tab + headline counts (frontend)

- Filters: search (accent-insensitive name, state name/code, or district like "WA-7" /
  "WY-AL"), state dropdown (default WA, or "All states and territories"), party chips,
  chamber chips (Senate / House = voting reps / Delegates). 48 cards per page + "Show more".
  Scoped search with no hits offers "Search all states instead".
- Headline cards under the page title: senators and representatives with party split and
  House vacancies (out of 435), delegates, "Bills covered" (every law and voted-on bill
  plus recent ones; not all ~20k introduced) and votes synced, all from
  `stats/overview.headline` (falls back to the directory doc + `getCountFromServer` if
  the stats doc predates it). Member cards are clickable and set the directory filters.

## Shareable links (router.js)

- Hash routes: (none) Overview, `#issues/<topic>`, `#bills`, `#votes`,
  `#legislators/<WA|all|WA-7|WY-AL>`, and details `#bill/<id>`, `#member/<bioguideId>`,
  `#vote/<vote id>`. Tab switches and opened details `pushState`; topic/state changes
  `replaceState`. Browser Back/Forward and the modal's ← go through history.
- `history.state.detailDepth` = how many open details have their own entry. A detail
  from a pasted link has none, so closing it replaces the URL with the tab (no history
  to go back through). Details from a pasted link open over the Overview.
- Modules plug in via `tabArg[tab]` (current argument) and `onTabArg[tab]` (apply one);
  the router applies the argument before showing the tab.
- **Copy link** buttons (`data-copy-link="#…"`, empty = current URL) in every detail
  header, on Issues and on the "Your representatives" panel. Clipboard API, then
  `execCommand("copy")`, then `prompt()` (some in-app browsers block the first two).

## How we count, Report an error, keyboard focus

- `#methodology` = "How we count" (`view-methodology` in index.html, a page with no tab
  button; linked from the footer, every detail window and the Issues definitions). It
  restates the rules in plain words: which bills are stored, stage, summaries policy,
  vote types/outcomes, party agreement, voting records, Issues measures/watchlists/
  focused, campaign finance, address lookup. **Changing a counting rule? Update this page
  in the same commit.** Each statement was checked against the code on 2026-11-12.
- Report an error (`data-report-error`, footer + bottom of every detail): opens a prefilled
  GitHub issue on the public repo with the page's link. Needs a GitHub account; a form or
  email would avoid that but needs a mail service.
- Detail windows trap Tab/Shift+Tab inside the dialog and pull escaped focus back; a
  re-render (data arriving) restores focus to the same control (`focusKey`).

## Find your representatives (Legislators tab)

- Address -> `POST /api/find-district` (POST keeps it out of URLs/logs; not stored, not
  logged, `Cache-Control: private, no-store`) -> U.S. Census geocoder, layer 54
  ("<nth> Congressional Districts"). The function asks for the **current Congress's**
  map: `Current_Current` already has the 120th (redistricted for the 2026 election), so
  it tries `ACS2025_Current` (119th) first, then newer vintages. From Jan 3, 2027 the
  120th is picked automatically; reorder `VINTAGES` then to save a request.
- Census sends no CORS headers, hence the function. No rate limit (the plan's 2 rules are
  used by member-profile and bill-detail); input is capped at 200 characters.
- Result: `#legislators/WA-7` view = panel with 2 senators + the district's member (at-large
  and delegates are district 0; members store at-large as `district: null`; "vacant" if
  none), then the state's full list. Picking another state clears it; it also sets
  `cw-state` so the Issues tab's "Members from <state>" uses it.
- Verified 2026-11-12: Seattle -> WA-7 (Jayapal), Cheyenne -> WY-AL, the White House ->
  DC-AL (delegate, no senators), unknown address -> message.

## Campaign finance (member modal → Campaign Finance tab)

- `member-finance` picks the member's FEC candidate id for their current chamber (H/S
  prefix), then the election period for their next election (`election_full=true`: the
  full 2-year House / 6-year Senate period). If nothing is reported for it yet, it uses
  the previous election. 4 FEC requests per member, in-memory cache 12h on warm instances +
  `Cache-Control: max-age=43200`.
- Shows: raised / spent / cash on hand / debts; receipts by source (unitemized vs
  itemized individuals, PACs, party, candidate's own money, other); individual
  contributions by FEC size bucket; itemized contributions by state (in-state share, top 5).
- The tab only calls the function when opened. Captions spell out the caveats: committee
  filings only (no super PACs), state is known only for itemized (>$200) gifts.
- No employer/"top donor" lists on purpose: they invite misreading (employers of
  individual donors aren't the companies giving) and need more FEC calls.
- Receipt sources sum to FEC `receipts`: individuals (unitemized/itemized), PACs, party,
  candidate (contribution + loans), transfers from other authorized committees (joint
  fundraising), FEC "other receipts" (dividends/interest), offsets; any remainder shows
  as "Other (loans, etc.)".
- The label says "FEC election cycle ending YYYY", not "YYYY election": retiring members
  (e.g. McConnell) still have a committee filing in the current cycle.
- Verified live 2026-11-10: House (Jayapal, 2026 cycle), Senate (Thune 2028 and Sanders
  2030, full 6-year periods), retiring senator (McConnell, 2026 cycle). The "no upcoming
  election in FEC data -> previous election" fallback hasn't been hit by a real member.
- Browsers cache responses for 12h, so format changes show up after that.

## Detail modals (frontend)

- One modal shell with a stack (Back button): anything with `data-open="member|bill|vote"
  data-id="…"` opens one, from the page or inside another modal. Escape / backdrop / ✕
  close all and return focus. Kinds are defined in `MODAL_KINDS` (load, header, tabs).
- **Member** (id = bioguideId): Overview / Voting Record / Legislation. Member doc from
  `memberById` or Firestore; details + sponsored items from `member-profile`.
- **Bill** (id = bill_id): Summary (sponsor → member modal, cosponsors, AI summary with
  source label, official CRS summary, latest action) / Actions (timeline; recorded House
  votes link to the vote modal by `{congress}-{session}-house-vote-{roll}`) / Votes
  (`vote_summaries` where `bill_id ==`). Works for bills not in `bills` via `bill-detail`.
- **Vote** (id = vote doc id): Results (tallies, party table, bill link, Clerk record) /
  How members voted (grouped by position; filter by name, a bare state code like "WA",
  or party; names open member modals). Unsynced roll calls say so.
- Functions are cached per id in the page and for 1h via `Cache-Control`. If they fail,
  modals still show Firestore data plus a Retry button.
- Voting Record = the member's `member_votes` doc: participation and party agreement over
  the whole Congress, plus the latest 50 votes. "Voted with party majority" = matches most
  of their party's Yea/Nay on that roll call (ties and Independents excluded).
- Deep links: see Shareable links. Keyboard focus: see How we count, Report an error, keyboard focus.

## Votes paging (frontend)

- `loadVotes` pages `vote_summaries` (not `votes`): `orderBy('date','desc')`, 10 per page,
  `startAfter` cursor, "Load older votes", month headings, "Showing N votes back to <date>".
- Chamber chips query `where('chamber','==')` + `orderBy('date')`, which needs the
  (chamber ASC, date DESC) index on `vote_summaries` (in `firestore.indexes.json`). If it's
  missing (`failed-precondition`), `queryVotes` pages all votes 30 at a time and filters by
  chamber in the browser, so the chips still work (pages are just uneven).
- `voteCache` (data.js) holds only full `votes` docs fetched by `getVote`; summaries never
  go in it, since they lack the member list the vote modal needs.

## Bills paging (frontend)

- `loadBills` queries `bills` with `orderBy('latest_action_date','desc')` (the date each
  card shows), 12 per page, `startAfter(lastDoc)` cursors behind "Load more bills".
  It used to order by `update_date` (when Congress.gov last edited the record), which put
  68 of the first 120 cards out of order, incl. re-touched 118th Congress bills from 2024.
- Category buttons filter in the query (`where('category','==',…)`), which needs the
  composite index (category ASC, latest_action_date DESC) in `firestore.indexes.json`.
  If it's missing, `loadBills` falls back to the older (category, update_date) index. Add new
  indexes to the JSON and create them in the Firebase console (Firestore -> Indexes) or with
  `firebase deploy --only firestore:indexes`.
- Search filters only the loaded pages (Firestore has no text search). Bill-number terms
  ("HR 1234", "H.R. 1234", "1234") also do an exact `number`/`type` lookup across the
  whole collection.
- `billCache` holds every bill seen; the Votes tab uses it to label bills.

## Product principles (from reviewing congress-watch.netlify.app, see docs/HISTORY.md)

- Sync members from Congress.gov (`currentMember=true`), never hand-picked lists.
- Only show numbers computed from stored source data, and say how (How we count).
- AI only summarizes official text, labeled with its source; it never judges members.
- No scores, leaderboards or member-vs-member rankings (footer promise).
- Keep core data in Firestore so the site degrades gracefully when a function fails.
