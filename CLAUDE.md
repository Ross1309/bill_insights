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
- **App Check** (since 2026-11-12, reCAPTCHA Enterprise, site key in `public/data.js`,
  public by design): Firestore accepts only requests from the site. firebase-admin (functions,
  scripts) is unaffected. Local dev and smoke tests use registered **debug tokens**
  (`APPCHECK_DEBUG_TOKEN` in `.env` and as a GitHub secret; on localhost the page prints one
  to register: App Check -> Apps -> Manage debug tokens). Firestore's public REST API is
  blocked once enforced, hence `/api/health` for `check-health.js`. Enforce/unenforce:
  Firebase console -> App Check -> APIs -> Cloud Firestore (takes effect within minutes).
  Status: **enforced since 2026-11-14** (before that 2 days of monitoring: 87% verified,
  13% invalid = unregistered localhost debug tokens, 0 unknown origin). Verified after
  enforcing: live smoke test (debug token) and a plain browser both load data.
  A fresh localhost browser can't read Firestore until its printed debug token is registered.
- **Security headers** (`netlify.toml` `[[headers]]`, 2026-11-16): a Content-Security-Policy
  allowing only the site's own files, the Firebase SDK + reCAPTCHA (www.gstatic.com,
  www.google.com), Firestore/App Check APIs and congress.gov member photos; frame-ancestors
  'none' + X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy. **Adding an
  outside script, image, font or API? Add its origin to the CSP** (the smoke test fails on the
  console error). Netlify doesn't add these to function responses in production, so share.js
  sends them from netlify/lib/security-headers.js (a test keeps it equal to netlify.toml). No inline event handlers (onerror="…"): use listeners (members.js photos).
- **Fonts are self-hosted** (public/fonts + @font-face in src/styles.css, OFL licenses
  alongside): Google Fonts' latin subsets trimmed with fontTools' instancer (Inter wght
  400-700, Source Serif 4 wght 600-700 / opsz 16-40): 110 KB instead of 170, preloaded, no
  render-blocking Google CSS. Cached a year (`/fonts/*`): a changed font needs a new file name.
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
public/congress-page.js            This Congress tab (#congress): so far vs the last two Congresses
netlify/lib/congress-stats.js      stats/congress-<n> daily series: GovInfo parsing, passage dates, builder
netlify/functions/sync-congress-stats.js  Nightly 11:00 UTC: new bills + passage for the current Congress
scripts/build-congress-stats.js    Backfill stats/congress-<n> (GovInfo bulk + votes; seeds upkeep state)
public/week.js                     Weekly digest: #week/<Monday> page (rendering only)
public/mine.js                     My members (#my-members): your three members' records, contacts, what to say
public/follow.js                   Follow bills/members/topics on the device; what changed since
public/home.js                     Home tab: your members, this week, issues, key votes, laws, numbers
public/plain.js                    Plain-language vote headlines (rules, confirmed/passed/adopted), party words
public/search.js                   Header search: members, bill numbers, topics, Bills-tab fallback
public/story.js                    A bill's story: milestones of its official actions (bill window)
public/glossary.js                 Plain definitions of official terms + tap-to-explain (termize)
netlify/lib/bill-index.js          stats/bill-titles: all stored bills' numbers + titles (Bills word search)
public/participation.js            Missed-vote wording (cards, member window, Home); loadParticipation in data.js
netlify/lib/participation.js       stats/participation: missed votes per member + chamber medians
netlify/lib/digest.js              computeWeeks(): stats/week-<Monday> docs, stats/weeks, this_week
public/issues.js                   Issues tab topic pages from stats/topic-<slug> (+ explainers, glossary)
netlify/lib/topics.js              Topic + watchlist definitions (CRS policy areas / subjects)
netlify/lib/topic-stats.js         computeTopicStats(): one stats/topic-<slug> doc per topic
scripts/import-topic-bills.js      Store + enrich every law and voted-on bill (resumable)
scripts/retag-topics.js            Recompute bills' topic/watchlist tags after editing topics.js [--write]
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
netlify/lib/run-lock.js            acquireRunLock(): one working copy of a nightly job at a time
netlify/lib/tracked-bills.js       sync_state/tracked: enriched bill ids + stored laws (markTracked)
scripts/build-tracked-bills.js     Rebuild sync_state/tracked from `bills` [--write]
scripts/rehearse.js                Dry run of a nightly job as of any date (writes recorded, not sent)
public/congress.js                 currentCongress/outgoingCongress/today, shared by page and server
netlify/lib/http.js                fetchWithRetry/getJson/getText (timeouts, retries, key masking), json()
netlify/lib/pool.js                pool(items, concurrency, fn), shared by functions and scripts
scripts/build-member-votes.js      Rebuild member_votes + vote_index from full votes [--write] [--congress N]
scripts/build-stats.js             Rebuild stats/overview [--backfill party_breakdown]
scripts/import-votes.js            Backfill all House + Senate votes of a congress (resumable)
scripts/repair-house-legislation.js Link House votes without a measure via the Clerk XML [--write]
scripts/backfill-short-titles.js   short_title on stored bills [--write] [--recheck] (then rebuilds)
scripts/import-bills.js            Backfill the N most recently updated bills (resumable)
scripts/summarize-bills.js         CRS-based AI summaries for stored bills (resumable)
netlify/functions/member-profile.js  GET /api/member-profile?id={bioguideId}: Congress.gov member detail +
                                   10 latest sponsored bills/amendments (key stays server-side)
netlify/functions/member-finance.js GET ?id={bioguideId}: OpenFEC totals, receipt sources,
                                   donation-size buckets, itemized by state (api.data.gov key)
netlify/functions/find-district.js POST /api/find-district {address, lat?, lon?}: Census geocoder, ZIP tables,
                                   Geoapify fallback -> { state, district|null, how, districts? }
netlify/functions/address-suggest.js POST /api/address-suggest {text}: Geoapify suggestions (key server-side)
netlify/lib/zip-districts.js       ZIP -> district(s) from zip-districts-<119|120>.js (generated)
netlify/lib/geoapify.js            Geoapify autocomplete + building lookup (agrees(): ZIP or city+state match)
scripts/build-zip-districts.js     Rebuild the ZIP tables from Census ZCTA-block + district block files
public/address.js                  Address box markup + suggestion list (combobox); lookup = findAndRemember (members.js)
netlify/functions/home.js          GET /api/home: stats overview/health/floor/participation via admin (CDN 5 min)
netlify/functions/health.js        GET /api/health: stats/health via admin (CDN 5 min), for check-health.js
netlify/functions/share.js         /bill/<id>, /member/<id>, /vote/<id>: the page with that item's title + preview tags
netlify/functions/sitemap.js       /sitemap.xml: every stored bill + current member (CDN 1 day)
netlify/functions/bill-detail.js   GET /api/bill-detail?id={bill_id}: sponsor, cosponsor count, latest CRS
                                   summary, action history (works for bills not in `bills`)
netlify/lib/bills.js               Congress.gov fetch helpers, bill doc shaping,
                                   policy-area -> category map, summary generation
netlify/lib/firebase.js            firebase-admin init (raw or base64 service account)
run-ingest.js                      Runs ingest-votes once locally (exit 1 on failure)
run-sync-bills.js                  Runs sync-bills once locally with .env keys (incl. OpenAI)
docs/HISTORY.md                    Dated notes: reviews, backfills, first deploys, reference site
```

`netlify/lib/` sits outside the functions dir on purpose so Netlify doesn't deploy it
as a function; esbuild bundles it via imports.

## Commands

```
netlify dev                                         # app + functions on :8888
node run-ingest.js                                  # nightly ingest once: members, House + Senate votes, member records, stats
node run-sync-bills.js                              # bill sync once, with .env keys (see note below)
node scripts/import-votes.js [--write] [--chamber house|senate] [--congress 118] [--limit N]
node scripts/import-bills.js [--write] [--limit 2000]
node scripts/summarize-bills.js [--write] [--limit N] [--recheck-days 3]
node scripts/build-stats.js [--backfill]          # stats/overview + stats/topic-*
node scripts/import-topic-bills.js [--write] [--force]
npm test                                          # ESLint + styles.css up to date + unit tests
npm run build:css                                 # rebuild public/styles.css after changing classes
npm run smoke                                     # browser smoke test on ./public (needs: npx playwright install chromium)
SMOKE_URL=https://congress-watcher.netlify.app npm run smoke   # same, against the live site
npm run health                                    # did last night's syncs succeed? (reads /api/health)
```

**Before every push: run `npm test`** (not just eslint/smoke). Tailwind scans every word
in `public/` (comments too) for class names, so even a JS comment can make
`public/styles.css` stale ("invisible" in a comment did, 2026-11-12); the stale-CSS check
then fails the Netlify build and nothing deploys. Fix: `npm run build:css` and commit.
CI and Netlify run **Node 24**; this Mac runs 26. Date formatting (Intl/ICU) differs between
them ("Mar 25" vs "Mar ’25" broke a deploy on 2026-11-15), so for date-related changes also
run `npx -y node@24 --test tests/*.test.js`, and don't let tests or UI depend on Intl's
short forms (build labels by hand).

**Checks and alerts.** ESLint runs in `npm test` (Netlify build) and catches undefined
names; it would have blocked the Nov 12 regression (a refactor deleted `renderFinanceTab`).
The smoke test fails on any page/console error. Locally it serves `public/` without
Netlify functions (their 404s are ignored; Campaign Finance is only checked live); both
modes read the real Firestore (~30 reads). GitHub Actions emails the repo owner when a
workflow fails, including the daily health check: that's the alert for failed nightly runs
(the site's stale notice only appears after 36 h).

**`netlify dev` and secrets:** `OPENAI_API_KEY` is a *secret* variable in Netlify, and
`netlify dev` injects it as a masked placeholder (`****…`) instead of the `.env` value, so
OpenAI calls 401 there (and `netlify env:get` shows the mask too). Run the bill sync with
`node run-sync-bills.js` (uses `.env`) to test summaries locally. Production is unaffected.

Env vars (`.env`): `CONGRESS_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY`,
optional `FEC_API_KEY`, `GEOAPIFY_KEY` (address suggestions + fallback; set in Netlify for all
contexts, so `netlify dev` injects it; without it the address box works with no suggestions). `CONGRESS_API_KEY` is an api.data.gov key, which OpenFEC also
accepts, so `member-finance` uses `FEC_API_KEY` if set, else `CONGRESS_API_KEY` (else
`DEMO_KEY` under `netlify dev` only). Set the same vars in Netlify's site settings.

## Firestore schema

**`bills`** — doc id `{type}{number}-{congress}` lowercase, e.g. `hr1234-119`
```
bill_id, congress (number), type ("HR"), number ("1234"), bill_number ("HR 1234"),
title, short_title (common name when Congress.gov's display title is a sentence, e.g. H.R. 1
"One Big Beautiful Bill Act"; null = none; `pickShortTitle`, `billName(b)` in util.js; stats,
vote_summaries.bill_title and the search index use billName; billName also turns CRA
resolutions into `Overturning the <agency> rule "<rule>"` (plainDisapproval, anchored at the
start so House rules naming them keep their title)), chamber, policy_area (CRS name or null),
category ("Economy" | "Healthcare" | "Foreign Affairs" | "Other" | "Uncategorized"),
introduced_date, update_date, latestAction { actionDate, text },
latest_action_date (= latestAction.actionDate, top-level for ordering; null if none),
congress_gov_url,
ai_summary { bullet_points[], source: "crs_summary", model, generated_at } (or absent),
crs_summary_available (bool; null = enriched but never checked; absent on old docs),
crs_checked_at (ISO),
issue tracker (from fetchBillEnrichment): subjects[] (CRS legislative subjects),
subject_count, stage (introduced|committee|passed_one|passed_both|to_president|law),
law_date (date of the "Became Public/Private Law" action; null if not law),
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
  `vote_{c}_{s}_{00000}.xml`). A vote whose record is still incomplete (no members or
  date yet; senate.gov lists new votes early) isn't stored until a later run.
  Senators are identified by LIS id and mapped to bioguideId
  via congress-legislators `id.lis` (100/100 mapped). Senators the *current* file lacks
  (left office, or appointed days ago) are mapped by the historical file (loaded only then)
  and, failing that, by unique last name + state in `directory/members`
  (`fillUnmappedSenators`). Times are Eastern, converted to UTC
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

**`stats/floor`** — public, the House weekly floor schedule (netlify/lib/house-floor.js; fetched by
ingest-votes alongside the votes, a failed fetch keeps the stored doc and isn't a failed run)
```
week (Monday), congress, updated, status ("published" | "none" = 404, usually recess),
categories [{ kind (suspension|rule|other), label, items [{ label, bill_id|null, text, amended }] }],
source_url, fetched_at
```
Home's "Coming up in the House" (`upcomingHtml` in home.js) shows it only for the current week
(next week's on weekends, `floorWeek`), plus your representative's contact links.

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

**`stats/week-<Monday>`** — weekly digest (digest.js), Monday-Sunday Eastern
```
week, week_end, congress, counts { votes { House, Senate }, passed, failed, laws,
confirmed, nominations, same, opposed }, laws [{ id, label, title, law_number, signed,
summary (CRS-based AI bullets or null), sponsor }], passage [vote items], closest [3 vote
items + margin], nominations [vote items], generated_at
vote item: { id, chamber, date, question, result, outcome, yea, nay, parties { D|R|I:
{ yea, nay } }, alignment, bill { id, label, title } | null, legislation, document_title }
```
stats/overview also carries `this_week.key_votes` / `final_votes`, `recent_laws` (4 latest:
id, label, title, law_number, signed, first summary bullet), `laws_total` and
`topics_summary` [{ slug, label, law, measures, watchlists }] for the home page.
**`stats/weeks`**: `{ congress, weeks: [weekSummary per active week], generated_at }` (for
the page's Earlier/Later links). `stats/overview.this_week` = the latest active week's
summary + up to 3 laws and 3 passed bills (the Overview card; no extra read). Rules: laws by
the "Became Public Law" action date (`lawSigning`); passed/failed = voteCategory 'passage'
by result, House rules (`isRuleVote`) kept apart in `rules` + `counts.rules` ("Debate rules";
vote cards say "Agreed to"); closest = 3 smallest margins among passage/cloture/nomination/amendment. Nightly
rebuilds recompute the last 3 weeks (merging into stats/weeks); `build-stats.js` does all.
Vote index entries carry `legislation` + `document_title` for this (nominee names).

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
dataset; 537/539 have one), contact { phone, url, form, office } (same dataset, current
term; `form` for 88/539; memberContact in netlify/lib/member-contact.js),
committees [{ id ("HSJU"), name, title (Chair/Ranking Member/… or null), subcommittees [{ name,
title }] }] (congress-legislators committee files, netlify/lib/committees.js; titled seats first;
member window Overview), term { start, end, class } (current term, same dataset;
public/terms.js `termFacts` -> term end + election date, "held" between Election Day and the
term end; never who won; appointed senators' terms end on the special election's date, shown
as "special election; appointed until then"), current (bool), updatedAt
```
Synced from `/member?currentMember=true` (3 pages, ~539 incl. 6 delegates). Members no
longer in that list are set `current: false`, never deleted; the UI queries
`state ==` + `current == true` only as a fallback (see `directory`).

**`directory/members`** — single doc, rewritten by every `ingest-votes.js` run (~100 KB)
```
members [{ id, name, state, party, chamber, district, imageUrl, contact }] (all current members,
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
- **Repeat invocations (proven 2026-11-19 from the `run start` lines):** Netlify starts another
  copy of a scheduled function when one hasn't answered within ~15 s, up to 3 copies, and they
  ran AT THE SAME TIME (sync-congress-stats: copies at +0, +15, +30 s, 24 s each), overwriting each
  other's progress windows; two sync-bills copies could summarize the same bill. ingest-votes
  (~8 s) ran once. Fix: `acquireRunLock` (netlify/lib/run-lock.js, `sync_state/locks.<job>`): copies
  take turns, each working with the time left of its own 30 s, so the repeats still add capacity
  (sync-bills refreshed 7 of 52, then the rest) without overlapping. The lock expires at its
  holder's 30 s, so a crash can't block the next copy or night. A Firestore error on the lock
  itself runs the job without it (fail open). Later copies start only with enough time left
  (`minWorkMs`: ingest 20 s, sync-bills 15 s, others 8 s). Verified with two real
  run-ingest.js copies 3 s apart: the second waited 16 s, then ran. Rehearsals capture lock writes.
- **Public functions:** `member-profile`, `bill-detail` (rate limit 60/min per visitor; the
  plan allows 2 rules, both used; rate-limited functions need explicit paths, hence
  `/api/...`) and `member-finance` set durable `Netlify-CDN-Cache-Control` (404s 1 h).
  `find-district` and `address-suggest` are POST-only, uncached, unlimited (Geoapify free tier: 3,000 requests a day; suggestions ask only after a house number + 2 letters, debounced).
- **Congress rollover (Jan 3):** `currentCongress()` (public/congress.js, shared with the
  page) derives it from the date per run; nothing hard-codes 119. Stats keep describing
  the previous Congress until the new one has `MIN_VOTES_TO_DISPLAY` (25) votes; when they
  switch, the week list is rebuilt for the new Congress. For `TAIL_DAYS` (45) after Jan 3,
  `outgoingCongress()` makes ingest-votes also fetch + apply the old Congress's last votes
  and sync-bills check its laws (signed after it ended). `mergeMemberDoc` never applies an
  older Congress's vote to a newer member record. Senate votes with a senator we can't map
  yet (newly sworn in) wait up to 7 days. Home asks for the address again when the saved
  lookup is from an earlier Congress (`cw-reps.congress`); header search uses the date's
  Congress. find-district: ACS2026_Current already has the 120th layer (checked 2026-11-14);
  reorder `VINTAGES` after Jan 3 to save a request.
- **Rehearsed 2026-11-14** with `node scripts/rehearse.js --date 2027-01-04T10:00:00Z
  ingest|sync-bills|stats`: the real jobs, real reads, writes recorded not sent (a canary
  write aborts if anything would reach Firestore), OpenAI blocked. All three ran cleanly;
  the switch-over cases with 120th votes are in tests/rollover.test.js. Re-run it before
  any risky change to a nightly job.
- **Tracked bills stay current:** `sync-bills` re-enriches every tracked bill Congress.gov
  changed since `sync_state/bills.last_refresh`, plus new laws (≤60/run), then rebuilds
  stats. The list comes oldest first with dates only; with a backlog the window moves to
  the start of the earliest date still pending, and a bill enriched on/after its update
  date is skipped, so every run makes progress. Steps check a 28 s budget and stop early.
- **Waiting bills** (~1,090 with no CRS summary yet): 25 re-checked per night, CRS checks 5
  at a time, then OpenAI only for those that now have one (≤6/run, within the time budget;
  leftovers stay first in line). Order: tracked bills the refresh just re-enriched (most
  likely to have a new summary), never-checked bills, then oldest check first via the
  (crs_summary_available, crs_checked_at) index (fallback: first 100 by id); each at most
  every 3 days, so the whole backlog cycles in ~6 weeks. A failed check still sets
  `crs_checked_at` (+ `crs_check_errors`), so it can't block the queue.
- **Member sync** refuses a list under 500 members (API trouble would otherwise retire
  everyone) and runs on its own, so its failure doesn't stop the vote sync.
- Data is complete for the 119th Congress (all votes; all 140 laws as of 2026-11-12).

### Backups and restore (set up 2026-11-12)
- **Point-in-time recovery (PITR):** on; any minute of the last 7 days can be recovered
  (`versionRetentionPeriod` 604800s). Best for undoing a bad script run.
- **Scheduled backups:** weekly, Sunday (UTC), kept 98 days (the max), in `us-central1`.
  Firestore console -> (default) -> Disaster recovery.
- Restores always go into a **new** database; the live `(default)` is never overwritten:
  ```
  gcloud firestore backups list --location=us-central1 --project=congress-watcher-b0dd3
  gcloud firestore databases restore --project=congress-watcher-b0dd3 \
    --source-backup=projects/congress-watcher-b0dd3/locations/us-central1/backups/<BACKUP_ID> \
    --destination-database=restore-YYYYMMDD
  ```
  PITR: clone or export the database at a past `--snapshot-time` (see `gcloud firestore
  databases clone --help` / `gcloud firestore export --help`). Then read the restored database
  with firebase-admin (`getFirestore(app, 'restore-YYYYMMDD')`), copy back only what's needed
  with a script, and delete the restored database afterwards (it's billed while it exists).
- **Rebuildable without a backup** (scripts, from official sources): votes, members, bills
  and their enrichment, member_votes / vote_index / vote_summaries
  (`build-member-votes.js`), all stats incl. the digest (`build-stats.js`), tracked list,
  topic tags, House bill links (`repair-house-legislation.js`). **Mainly in backups:** the
  AI summaries (regenerating ~1,500 costs little but takes hours), `crs_checked_at` history,
  `sync_state` windows. Verified read-only 2026-11-12 (database + backupSchedules REST).

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

### Review round 4 (2026-11-19): whole app, new angles
Unused exports (only `forgetMyReps`: nothing let a visitor remove their saved members, so Home and
My members now have **Forget**), How we count vs the code (every number matched; fixed "two
nightly updates" -> three, "25 a night" -> at least, appointed senators), dates and the January
switch in the new features (fine), a live click-through of 23 pages/windows + every member tab
at 360 px and 1366 px (no errors, nothing too wide), and tests for the digest's closest vote and
the vote cards' summary line + Ceremonial flag.

### Review round 3 (2026-11-19): everything since round 2 (31 commits, ~2,450 lines)
Data reconciled: all 1,616 vote summaries match their bills (title, summary line, ceremonial),
all votes applied, member_votes monthly = totals, 539/539 members with contact/term/committees.
Fixed: run lock fails open on a Firestore error and needs per-job working time; /api/home's
5 s limit covers only the server's first answer (not a slow download); My members caches its
bill query; appointed senators (Husted, Moody: terms ending at the Nov 3 special election) no
longer get an election date a year early; a misplaced comment in bills.js.
Second pass (whole app): every template value from outside data is escaped (scanned all 314
interpolations); functions validate ids/addresses; rules cover exactly what the page reads;
nightly steps re-run safely. Fixed: Home's second draw (members' positions arriving) redrew the
whole page, closing opened key-vote Details and wiping a half-typed address (now `keyVotesOnly`,
opened Details kept); /api/health ignores query strings like /api/home.

### Review round 2 (2026-11-16): a fresh reviewer on the round-1 diff + the product review
- sync-congress-stats window redesigned again: lists `/bill/{congress}` (this Congress only),
  pages while time allows (stops at 60 candidates or < 16 s), a bill counts as checked only
  if checked on a LATER day than its update (dates are day-only: a same-day passage must be
  re-checked), 3 failures -> given up (counted), window = start of the earliest open date,
  page position kept only while that date is unchanged (50-row overlap). Budget 25 s; listing
  pages get a 15 s deadline (Netlify is slow).
- Ingest enrichment queue bounded: <= 25 bills per run within 20 s, bills tracked as they're
  enriched (and ones a cut-off run enriched), 5 failed runs -> dropped (logged).
- Senate "On the Motion to Table" is always bare: what was tabled is in the vote `title`
  (point of order, appeal, reconsider); the House bare form on a resolution tables the
  resolution itself. Quorum calls read "Quorum call".
- Share links with a query string (fbclid) looped after a 301 (Netlify keeps the query):
  never redirect; `Netlify-Vary: query=cw-no-param` instead. Live smoke checks it.
- Product: Home items lost their question (headline regression); cloture on a nomination
  needs a simple majority (not 60); vote times in ET; member vote list uses headlines and
  Yea/Nay; counts add up (votes by name); watchlists leave out House rules and impeachment
  resolutions and say why each bill is listed; AI summary prompt covers big bills' main
  subjects (H.R. 1 read as a SNAP bill; `summarize-bills.js --redo-long`).
- Netlify's "Powered by Netlify" badge is injected by Netlify (owner setting), not our code.
- **Bills word search** (`stats/bill-titles`, netlify/lib/bill-index.js): every stored bill's
  [id, number, title (140 chars), stage, date] in one ~330 KB doc, rebuilt nightly by
  sync-bills and by build-stats; the Bills tab searches it on any word (one cached read),
  lists matches newest first and links matching Issues topics. Firestore has no text search.

### Review round 1 (2026-11-15): four parallel reviewers (backend, frontend, data, product)
Data reconciled exactly everywhere (all 556 member records, 85 weeks, 5 topics, congress-
117/118/119 vs Congress.gov). Fixed:
- **sync-congress-stats ran 28-59 s in production** (killed at 30 s, retried 3x, window
  stuck at Nov 10, health "ok"): one listing page per run (`list_offset` paging, 25 overlap),
  per-request deadlines, passage first, `state.checked` skip, "passage" fails when work was
  waiting and nothing got done. Production is far slower than local: budget for it.
- Headlines: "table" before discharge/recommit (a tabled discharge read as "took it out of
  committee"); suspension short of 2/3 says so; Speaker election; joint resolutions "pass";
  rules on joint resolutions; "An executive resolution" titles; unknown procedural votes
  "Agreed to"/"Rejected", never Passed/Failed. Veto Sustained = override failed.
- Senate parser: Vice President tie-breaks (`tie_breaker`, shown on cards) and amendment
  votes linked to their bill (`amendment_to_document_number`). Stored 119th votes repaired
  2026-11-16 (`repair-senate-votes.js --write` + rebuilds): 177 updated, every non-nomination
  Senate vote now has its bill, 8 tie-breaks (e.g. vote 15, Hegseth). senate.gov 403s this
  machine for about a day after a backfill; the script caches records, so re-runs are free.
- law_type (Private Law 119-1/119-2 were shown as Public Law) + law_date on all 144 laws
  (`scripts/backfill-law-fields.js`).
- 592 bills that passed a chamber (mostly without a roll call) weren't stored/enriched, so
  "Moving or passed" missed them: import-topic-bills covers sync_state/congress-<n> bills;
  nightly, newly passed bills go to `sync_state/ingest.pending_enrich`.
- Ingest keeps owed work in `sync_state/ingest` (pending_enrich, stats_dirty) so a run cut off
  between steps doesn't lose it. sync-bills: a failed detail fetch no longer nulls a bill's
  fields; never-checked CRS bills that fail 3x become `false` (stop blocking the queue).
- Cost: share/sitemap redirect query strings to the clean URL; id functions send
  `Netlify-Vary: query=id`. Optional owner step: a separate FEC_API_KEY.
- Home "your members" positions now come from each key vote's own record (member_votes.recent
  holds only 50: older key votes read "none of your members voted"); stale reps after Jan 3;
  search race; member cards valid markup; Key-votes loop capped; detail caches; focus
  restore; tabs pattern (modal) / aria-current (nav); reduced motion.

### Code review (2026-11-12)
Three parallel reviews (backend, frontend, ops/data) found no data damage (every derived
collection reconciled exactly) but fixed: non-idempotent member apply + silent BulkWriter
failures; refresh window that could stall; member-list sanity; Issues tab breaking
browser Back and leaking listeners; a malformed link crashing startup; races in Issues
Back/Forward and the state picker; health check fooled by manual runs. The smoke test
now covers Back from Issues, repeated topic switches and malformed links.

### Weekly digest (2026-11-12)
Live: Overview card + `#week/<Monday>` pages; all 85 active weeks built (all 140 laws, all
1,606 votes accounted for). Building it on real data found: two *private* laws and one
law whose latest action came after signing (fixed: `law_date` from the action history at
enrichment, "Became Private Law" recognized), and a Senate vote stored as an empty shell
because senate.gov listed it before its record was complete (fixed: the ingest now skips
incomplete Senate records like House ones; vote 262 re-fetched).

**Firestore: Blaze plan since 2026-11-12** (free daily allowances still apply; budget alert
set). The free tier ran out on Nov 11 and Nov 12 from dev scripts. After upgrading,
requests failed intermittently with RESOURCE_EXHAUSTED for ~15 minutes while it applied.

### Adding a topic
topics.js (policy areas + watchlists chosen from the CRS subjects on floor/law bills), a
chip in index.html (#issue-topics and #category-filters) + ISSUE_TOPICS in app.js, then
`node scripts/retag-topics.js --write` (tags and the Bills `category`, which now derives
from the topics' policy areas) and `node scripts/build-stats.js`. Keep slugs unique, <= 30.

## Issues tab (frontend)

Plain-language topic pages, built from the approved mockup (`mockups/foreign-affairs.html`).
- **Topics** (`netlify/lib/topics.js`): Economy, Healthcare, Foreign Affairs by CRS policy
  area. **Watchlists** (CRS subject tag OR the topic named in the title; H.R. 5334 "…Russia
  and Iran Act" has no *Iran* subject tag):
  - Economy: Tariffs & trade, Taxes, Budget & debt
  - Healthcare: Coverage & costs (incl. Medicare, Medicaid, prescription drugs), Veterans'
    health, Mental health & substance use
  - Foreign Affairs: Iran, Israel, Foreign aid
  - Immigration (policy area Immigration; added 2026-11-15): Border security, Legal status,
    visas & citizenship, Asylum & refugees
  - Defense (Armed Forces and National Security; added 2026-11-15): Troops & military
    families, Veterans' benefits (veterans' *health* stays in Healthcare), Defense budget &
    weapons, Intelligence & surveillance
  Healthcare/Economy ones were chosen 2026-11-12 from the CRS subjects on floor/law bills:
  health provisions mostly ride in bills from other policy areas (Healthcare's own area has
  11 measures; its watchlists add 39). Prescription drugs (only 3 focused) was merged into
  Coverage & costs; "jobs & cost of living" was dropped (noisy; Labor is already an Economy
  area). Title patterns use word boundaries ("Trademark" isn't trade).
- **Changing topics.js?** Run `node scripts/retag-topics.js --write` then
  `node scripts/build-stats.js` (no API calls; stored subjects are retagged), update the How
  we count page, and keep watchlist slugs unique across topics (≤30 slugs total: the stats
  query uses array-contains-any). New bills are tagged at enrichment automatically.
- `counts.beyond_policy_area` = watchlist measures outside the topic's own policy areas;
  "At a glance" mentions them so the headline number isn't read as the whole topic.
- The watchlist vote timeline prints Yea–Nay labels only where they fit (two heights, 7%
  apart); crowded dots keep their tooltip.
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

## Home (default tab) and Charts (#charts)

Redesigned 2026-11-12 from the approved mockup (`mockups/home.html`, real data snapshot):
- Header: logo + **search** (search.js). Tabs: Home, Issues, Bills, Votes, Members. The old
  header count cards are gone (their numbers are in "by the numbers").
- **The week in plain English** (`weekBrief` in plain.js; Home `#home-brief`): template
  sentences from the counts, no AI. `this_week.closest` = the week's closest vote.
- Home order (UI review 2026-11-16): hero cards -> Follow tip / Since you last looked -> Key
  votes -> Coming up in the House -> Issues (phones only, compact list; desktop keeps the third
  hero card) -> Recently became law -> by the numbers. All six tabs fit a 360 px phone.
- Home (home.js), one read of `stats/overview`: three cards: **Who represents me?** (address
  -> `lookupDistrict` + `repsFor` -> remembered in localStorage `cw-reps`, with each member's
  `contact`: Call / Contact form / Website links, `contactLinks` in util.js; older saves get
  contacts once from the directory, `withContacts`), **This week**
  (`this_week`), **Issues** (`topics_summary`); **Key votes** (`this_week.key_votes`: latest 4
  final votes on bills/resolutions + nominations, House rules left out) with plain headlines
  (plain.js), what the vote type means (`explainQuestion`), D/R Yea/Nay bars and, once an
  address is known, **your members' positions** (their `member_votes` docs: 3 reads);
  **Recently became law** (`recent_laws`); **by the numbers** (totals, `laws_total`,
  party-split %). Official terms Yea/Nay are kept (user's choice).
- Charts page `#charts` (no tab button): the four charts below, rendered on first open.

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
- (The header count cards were removed in the 2026-11-12 home redesign; `stats/overview.headline`
  is still written.) Member cards are clickable and set the directory filters.

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

## Find your representatives (address box: Home, My members, Members tab)

Rebuilt 2026-11-20: the Census geocoder alone rejected ZIP codes, city + state, apartment
numbers, new buildings and typos (27 typical inputs: 13 failed).
- **find-district** (POST, address never logged/stored, `no-store`), steps within 8.5 s:
  1. Bare ZIP -> `zipDistricts` (no request). 2. Census `onelineaddress` on the text, then
  `withoutUnit` (Apt/Unit/Suite/#/Floor, never "FL" = Florida or a 5-digit ZIP). 3. A picked
  suggestion's lat/lon, else Geoapify `locateAddress` (house-number match, confidence >= 0.8,
  and `agrees()`: same ZIP, or city + state typed; "1600 Pennsylvania" alone matched a house
  in Georgia) -> Census `coordinates` for the district. 4. The ZIP in the text, else the state
  at its end (`stateAtEnd`; codes only in capitals). `how`: address | location | zip | state.
- **ZIP tables** (`zip-districts-119.js` / `-120.js`, ~530 KB each, plain modules so any
  bundler takes them): `node scripts/build-zip-districts.js` from the Census 2020 ZCTA-to-block
  file (1 GB) + the Redistricting Data Office block equivalency files (cd119.zip, cd120.zip have
  national files). Blocks build both ZCTAs and districts, so the districts are exact; shares are
  by **land area** (no population in the files). 119th: 33,774 ZIP areas, 5,829 in more than one
  district. ZIPs without an area (PO boxes: 30301) use neighbors with the same first three
  digits: one district (20500 -> DC) or just the state. VI/GU/MP/AS by prefix. A new Congress
  needs its table (block file under rdo/mapping-files/<year>/); without one, ZIP-only lookups
  answer "We don't have that ZIP code".
- **UI** (`findAndRemember` in members.js, one flow for all three forms): exact -> saved as
  before. Split ZIP -> buttons per district (member name, share of the ZIP's area) + "enter
  your street address to be sure". State only -> senators (member links), asks for street/ZIP.
  The Members tab's message lives in `#find-reps-status` (renderYourReps redraws
  `#find-reps-result` when the directory loads).
- **Suggestions** (`public/address.js`): debounced 300 ms, only after a house number + 2
  letters, stale requests aborted, cached per text; ARIA combobox (arrows, Enter picks and
  submits, Escape closes); Geoapify / OSM attribution under the list (required). Geoapify
  answers in 0.4-7 s.
- Census sends no CORS headers, hence the function. No rate limit (the plan's 2 rules are
  used by member-profile and bill-detail); input is capped at 200 characters.
- The function asks for the **current Congress's** layer: ACS2025_Current has the 119th,
  Current_Current the 120th; from Jan 3, 2027 the 120th is picked automatically; reorder
  `VINTAGES` then to save a request.
- Verified 2026-11-20 (netlify dev + Playwright, debug token): 98052 -> WA-1/WA-8 choice,
  "Seattle, WA" -> senators, Apple Park suggestion -> CA-17, 98109 on My members -> WA-7,
  keyboard, phone width; smoke test passes.

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
  (`vote_summaries` where `bill_id ==`). With no roll calls, the Votes tab says what
  happened from the official actions (`noRollCallHtml`): each chamber's "Passed/agreed to
  in …" result (voice vote, unanimous consent), "no floor vote yet", or "recorded votes not
  in our records" (other Congresses). 12 of the 31 laws on the Issues pages passed with no
  roll call, so this is common. Works for bills not in `bills` via `bill-detail`.
- **Vote** (id = vote doc id): Results (tallies, party table, bill link, Clerk record) /
  How members voted (grouped by position; filter by name, a bare state code like "WA",
  or party; names open member modals). Unsynced roll calls say so.
- **Your members on this bill** (bill Summary, needs `cw-reps`): sponsor/cosponsor from
  bill-detail's `cosponsors` [{ id, original, withdrawn }] (+ `cosponsorsComplete`; 2 pages of
  250 max) and their positions on the bill's final roll calls (`FINAL_KINDS` passage/concur/
  override via questionKind, <= 4 full vote docs, cached), plus contact links.
- **The story so far** (bill Summary; `billStory` in story.js): milestones recognized in the
  official actions (introduced, committee, floor results, settling differences, President, law);
  anything unrecognized stays on the Actions tab only.
- Dates in bills/actions are written by hand with `formatDay` (util.js): "May 20, 2025". The
  vote window also reads the bill (cached) for its name; labels go through officialLabel.
- Functions are cached per id in the page and for 1h via `Cache-Control`. If they fail,
  modals still show Firestore data plus a Retry button.
- Voting Record = the member's `member_votes` doc: participation and party agreement over
  the whole Congress, plus the latest 50 votes. "Voted with party majority" = matches most
  of their party's Yea/Nay on that roll call (ties and Independents excluded).
- Deep links: see Shareable links. Keyboard focus: see How we count, Report an error, keyboard focus.

## Vote cards, Key votes, official labels (2026-11-12)

- `public/vote-card.js` `voteCardHtml()` is the one vote card used by Home key votes, the
  Votes tab, week pages and a bill's Votes tab (plain headline from plain.js, result badge,
  official label, question + `explainQuestion`, D/R Yea/Nay bars, member list + official
  record links). It accepts a vote_summaries doc or a digest vote item (`asVote`).
- **What the bill does** on vote cards: first point of the bill's CRS-based AI summary, labeled
  with its source (`billSummaryLine`; `vote_summaries.bill_summary`, digest `bill.summary`).
  sync-bills copies a new summary onto stored cards (`refreshVoteSummaryLines`); not on House rules.
- **How divided** tags (`voteDivision` in plain.js, `divisionTags` in vote-card.js, rules in the
  glossary and How we count): close vote (margin <= 5%), party lines (90% of each party on
  opposite sides), broad agreement (two-thirds of each on the same side), mixed support.
- **Short cards on Home** (`compact`): headline, what it does, tags and your members; party bars,
  procedure and record links fold behind "Details".
- **Everyday words (2026-11-19):** visitors read "recorded votes" and "bills and resolutions", not
  "roll-call votes" and "measures". Official labels ("House roll call #323") and the glossary keep the term.
- **Ceremonial** (`isCeremonial` in stage.js; `vote_summaries.bill_ceremonial`, digest `bill.ceremonial`):
  naming post offices, VA facilities, courthouses and federal buildings; Gold Medals and commemorative
  coins; resolutions marking a day, week or month. Deliberately narrow: "recognizing" and "honoring"
  resolutions aren't tagged. Bills and Votes tabs can hide them (`cw-hide-ceremonial`, off by default).
- `vote_summaries.kind` (`voteKind` in vote-index.js: `rule` for House rules, else
  `voteCategory`) and `bill_title` (read from `bills` when summaries are written).
  **Key votes** = kind passage | nomination; the Votes tab defaults to them (filtered in
  the browser from pages of 25, no extra index) with "All roll calls" one click away.
- `officialLabel()` (util.js) turns "HR 2102"/"hres1247-119"/"PN 1181" into "H.R. 2102",
  "H.Res. 1247", "Nomination PN 1181"; use it wherever a bill number is shown.

## Bill stage tracker + "Moving or passed" (2026-11-14)

- `public/stage.js`: `stageFromActions` (shared with the server; `netlify/lib/bills.js`
  re-exports it), `stageSteps(bill)` (steps by type: bills/joint res. to the President and
  Law; H.Res./S.Res. one chamber; concurrent both; constitutional amendments end after both
  chambers), `stageTrackerHtml` (compact on cards, labeled in the bill window). The window
  uses the stored stage, else `stageFromDetail` (bill-detail actions, only when all came back).
  Bills without stage data (~1,900 never enriched) show no tracker.
- Bills tab defaults to **Moving or passed**: `where('stage','in',MOVING_STAGES)` + House
  rules (`isRuleBill`) dropped in the browser. Needs indexes (stage ASC, latest_action_date
  DESC) and (category ASC, stage ASC, latest_action_date DESC); without them it filters
  pages in the browser (console warning with Firestore's create link). The service
  account can't create indexes (403), so they're created in the Firebase console.
- Exact bill-number search ignores the scope.
- **What happens next** (`nextStep` in stage.js): the process's general rules for the current
  stage, never a prediction; bills of an ended Congress read as expired (except one awaiting
  the President during the outgoing Congress's tail).

## This Congress (#congress) (2026-11-15)

Tab "This Congress" (internal tab name `charts`; old `#charts` links work): the Congress so
far next to the last two at the same day of their terms (congress-page.js), then the four
older charts under "More charts". Reads stats/congress-<cur, cur-1, cur-2> (~17 KB each) +
stats/overview (monthly party split).
- **stats/congress-<n>** (public, under stats/): daily counts (index = day from Jan 3):
  `introduced, passed_one, passed_both, laws, floor_voted, votes{House,Senate},
  split{House|Senate:{same,opposed}}`, plus `totals`, `days`, `final`, `as_of`. Bills =
  H.R./S./H.J.Res./S.J.Res.; passage = first "Passed/agreed to in House|Senate" action
  (`passageDates`, same rule as the bill stage). Laws run past day 730 (signed after the term).
- **Finished Congresses** (117th, 118th): `node scripts/build-congress-stats.js --congress
  118 --write`. GovInfo BILLSTATUS zips (hr ~35 MB; cached in the OS temp dir), Congress.gov
  House vote list, House Clerk XML party totals, senate.gov vote XML. The Clerk and senate.gov
  throttle bursts (403): the script caches every record on disk, spaces requests, retries
  throttled ones and stops (writes nothing) if a record can't be read. Speaker elections /
  quorum calls have no party totals: "unclear", correctly. Verified 118th: 16,565 bills,
  274 laws, 1,241 + 691 votes = Congress.gov's counts.
- **Current Congress**: the same script without --congress seeds `sync_state/congress-<n>`
  ({ introduced[], max{type: highest bill number}, bills{hr1234:{h,s}}, last_check }) from
  GovInfo (which lags: its newest 119th files were ~Nov 9 on Nov 15) + Congress.gov for gaps
  (GovInfo lacked 6 H.R. bills; H.R. 2/3/5/8/10 are reserved, no actions). Bill numbers have
  gaps (S. 5718 existed with 5,702 bills), so new bills are found by `probeNewBills`
  (walk past the highest known until 8 misses), never by count.
- **Nightly** `sync-congress-stats` (11:00 UTC, health key `congress_stats`): new bills,
  then bills Congress.gov updated that `maybePassed` (not a referral in their own chamber)
  get their actions read; resumable window like sync-bills; votes from vote_index, laws from
  `bills`. Rehearse with `node scripts/rehearse.js --date … congress-stats`.
- After Jan 3 the page shows the displayed Congress (stats/overview.congress), so it stays on
  the 119th until the 120th has 25 votes. The nightly job starts a new Congress's state by
  itself (first 60 days). Once the 119th's tail is over (mid-February 2027), run
  `build-congress-stats.js --congress 119 --write` to freeze its final figures.

## Phone detail windows + How a bill becomes law (2026-11-15)

- Detail windows on phones: full height (`100dvh`), Back / Copy link / Close on their own
  row and the title full width below (flex `order`, so each control exists once and focus
  handling is unchanged), 44 px close/back targets, short tab names (`SHORT_TAB`: Votes,
  Bills, Finance, Members; full names from `sm` up). Header + tabs stay fixed above the
  scrolling panel. Vote window title = plain headline, official question below.
- `#how-laws-are-made` (index.html `view-process`, tab key `process`, no tab button): the
  seven steps (matching the stage tracker), kinds of measures, how votes are taken, with
  "On this site" notes and tap-to-explain terms; 118th figures (16,565 / 962 / 290 / 274)
  are its verified final totals. Linked from the stage tracker, Bills lead, This Congress
  funnel, the glossary and the footer.

## Link previews and search (2026-11-15)

Nothing after "#" reaches a server, so previews and search engines only saw the home page.
- **Path links** `/bill/<id>`, `/member/<bioguideId>`, `/vote/<vote id>` (share.js, Netlify
  function with `config.path`): index.html with the item's `<title>`, description, canonical,
  Open Graph + Twitter tags (from Firestore; the home page's own tags in index.html are
  replaced, never duplicated: `withMeta`). CDN-cached 1 day (404s 1 h). Bill: stage status
  + first summary bullet; member: role + missed votes vs typical; vote: plain headline,
  result, party tallies.
- In the browser, router.js turns the path into its `#route` (replaceState), so everything
  else is unchanged. index.html loads `/app.js` and `/styles.css` by **absolute** path (the
  page is served at /bill/...): keep them absolute. **Copy link** (`shareUrl`) gives path
  links for details; tabs stay `#routes`.
- `public/og.png` (1200x630) from `mockups/og.html`; regenerate with Playwright:
  `page.setViewportSize(1200x630)`, goto the file, screenshot to public/og.png.
- `/sitemap.xml` (sitemap.js, ~2,600 reads per CDN miss, cached a day) + `public/robots.txt`.
  Optional: submit the sitemap in Google Search Console (owner step).

## Trends (2026-11-15)

- **member_votes.monthly** `{ "2025-03": [roll calls, missed, with party, comparable] }`
  (Eastern month), kept by `mergeMemberDoc` with the same `applied` idempotency as totals;
  backfilled with `build-member-votes.js --write` (556 docs, all reconcile with totals).
  Member window, Voting Record: "Month by month" (member-trends.js): share missed + share
  with party (months with < 5 comparable votes left out), one sentence each, table view.
  Shown only when the monthly counts add up to the totals (older docs wouldn't).
- **stats/topic-<slug>.monthly** `{ "2025-03": { votes, laws } }` (topic-stats.js; laws by
  `lawSigning`). Issues "At a glance": busiest month, last three calendar months, bars.
- Bars: `bars()` in member-trends.js, a stretchable SVG with HTML axis labels (readable at
  any width); labeled scales so small values aren't exaggerated.

## Missed votes (2026-11-15)

Shown on every member card (Members tab, "Your representatives"), at the top of the member
window ("Votes this Congress") and on Home's "your members": "Missed 48 of 685 votes
(7.0%)", with the chamber's typical (median) share in the window and on Home. User's
decisions: show it everywhere members appear, with the median for context. Never sorted,
filtered or listed as a ranking (footer promise); neutral gray text, no warning colors.
- **stats/participation** (public, ~12 KB): `{ congress, members: { id: [roll calls,
  missed] }, medians: { House|Senate: { missed_share, members } } }`, from member_votes
  totals (Not Voting = missed; Present isn't). Rebuilt by ingest-votes when votes were
  applied or members changed (`writeParticipation`), and by build-stats.js.
- Medians leave out delegates (they may vote only on some amendments: they get an
  explanation, not a share) and members with < 20 roll calls. 119th at launch: House 1.9%
  (433 members), Senate 2.5%.
- Every statement notes the record doesn't say why a vote was missed; we never suggest one.

## Clarity pass (2026-11-15)

- **Tap-to-explain** (`public/glossary.js`): `TERMS` (our own neutral definitions),
  `termize(escapedText)` marks the first mention of each term in official text as a
  `<button data-term>`; one capture-phase listener opens a popover (Escape / tap elsewhere
  closes, focus returns, `aria-describedby`). Used on vote questions (cards, Issues key
  votes, vote window title + "Majority required"), bill latest action / Actions timeline /
  "no roll call" text, stage tracker labels; the Issues glossary chips use the same terms;
  How we count lists them all (`#glossary`). Only pass *escaped* text to termize.
- **Headlines by vote type** (`questionKind` in plain.js): only final votes say a measure
  passed. Before 2026-11-15, cloture, amendment, recommit, table, motion-to-proceed votes on a
  bill read "passed/rejected the bill" (All roll calls, a bill's Votes tab, week pages'
  closest votes). "concurrent resolution" is not "concur". Generic Senate "On the Motion"
  (79 votes) stays generic: the record doesn't say more. Vote window: "What this vote was".
- Page leads say what each page is for; headings match the tab names.

## My members (#my-members, 2026-11-19)

- `public/mine.js` (view `view-mine`, tab key `mine`, no tab button; linked from Home's members card
  and Your representatives): per member, on their own record (never compared or ranked): missed
  votes + typical, with-party share, latest final votes and votes against their party
  (`finalVotes`/`againstParty` in plain.js, from member_votes.recent = latest 50), bills they
  sponsored that passed a chamber (bills `where sponsor.bioguideId ==`, current Congress), newest
  bills (member-profile), committees, term, contacts. Address form when none is saved.
- **What to say** (`callScriptHtml` in util.js): neutral call/write script, same for support or
  oppose; on My members, Home's members card and the bill window's "Your members" (with the bill).

## Follow + "Since you last looked" (2026-11-15)

- `public/follow.js`: follow bills/members/Issues topics on the device (localStorage
  `cw-follow`, limits 20/10/10; nothing leaves the browser). Following stores a baseline
  (bill: stage + latest action date; member: member_votes totals + latest vote date + congress;
  topic: law/measure counts from `stats/overview.topics_summary`). Pure change functions
  (`billChange`, `memberChange`, `topicChange`; tests/follow.test.js) compare with current data.
- Buttons (`followButtonHtml`, `data-follow`/`data-id`, aria-pressed) in the bill and member
  window headers and on Issues topic pages; one click handler (`setupFollow` in app.js).
- Home `#home-follows`: a tip when nothing is followed, else what changed (1 read per bill /
  member, cached; topics free), "Everything you follow" with unfollow, "Mark all as seen".
  A new Congress counts every member vote as new. Explained on How we count.

## Speed and accessibility (2026-11-16)

Audited at phone size (Lighthouse + axe-core on 11 views, debug token). Page weight ~920 KB
over the wire: reCAPTCHA (App Check) ~415 KB, Firestore SDK 183 KB, fonts 167 KB, our code +
CSS ~100 KB, Netlify badge script 11 KB. Fixed: layout shift 0.27-0.43 -> 0 (`main` and
`#congress-container` are `min-h-screen`, so the footer / More charts start below the fold),
inline text links underlined (src/styles.css; accent vs gray text was 1.4:1), Issues timeline
dots have 24 px targets, the site name is the page's h1 on every page but Home (tabs.js),
Firebase SDK `modulepreload`, plain load errors (`loadErrorHtml`: a failed App Check reads
as "a blocker or strict privacy setting stopped reCAPTCHA", not "insufficient permissions").
Known: headless browsers without a debug token fail App Check (Lighthouse sees the error
page); dots in crowded timeline stretches overlap (each vote is also listed below them).

## Home without Firebase on first load (2026-11-19)

- Home's four docs (stats/overview, health, floor, participation) come from `/api/home`
  (netlify/functions/home.js: firebase-admin, Timestamps -> ISO, CDN 5 min + stale 1 h).
  `getHome()` in data.js gives the endpoint 5 s, then reads them from Firestore (the local smoke
  test has no functions); a failed overview read passes its own error on, so blocked visitors get
  the reCAPTCHA explanation. Query strings don't vary the cache (`Netlify-Vary`).
  `getOverviewDoc()` returns a snapshot-like `{ exists(), data() }`. Verified 2026-11-19: Home
  shows with App Check failing; endpoint hanging -> Firestore after ~6 s; both down -> message.
- **App Check starts on the first Firestore read** (`firestore()` in data.js, used instead of a
  shared `db`), so a Home-only visit never loads reCAPTCHA. Use `firestore()` for every query.
- Measured (phone profile, 4x CPU): Home 4,010 KB -> 1,392 KB uncompressed, no reCAPTCHA.
  The Firestore SDK (183 KB over the wire) still loads at startup: moving it behind a dynamic
  import would be the next step.

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
