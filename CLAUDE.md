# Congress Watcher (bill_insights)

Non-partisan web app that tracks what the US Congress is actually doing: bills with
plain-language AI summaries, House roll-call votes, and a member directory by state.

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
  `bills`, `votes`, `members`, `directory`, `stats`, `member_votes`; no browser writes anywhere. Before
  that the project was `allow read, write: if true`, so anyone could change or delete data.
  The site only reads; all writes go through firebase-admin (functions/scripts), which
  bypasses rules. **Adding a new collection the site reads? Add a read rule** and
  republish (Firebase console → Firestore → Rules, or the Rules API).
- The Firebase *web* config in `public/app.js` (`apiKey: "AIza…"`) is public by design.
  Netlify's secret scanner flags it, so `netlify.toml` exempts that one value via
  `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES`. Never exempt or disable scanning for
  anything else.

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
tests/rules.test.js                Unit tests for rule functions (`npm test`; gates Netlify builds)
netlify/lib/senate-votes.js        senate.gov LIS XML -> `votes` docs (menu, vote parse, ET->UTC)
netlify/lib/house-votes.js         Congress.gov House votes -> `votes` docs (list + build doc)
netlify/lib/vote-stats.js          party_breakdown, alignment/category/outcome rules, computeOverview
netlify/lib/overview.js            writeOverviewStats(): rebuild stats/overview (ingest + script)
netlify/lib/member-votes.js        member_votes docs: per-member totals + latest 50 (applyNewMemberVotes)
netlify/lib/vote-index.js          vote_index docs: compact fields of every vote (stats + ingest read these)
netlify/lib/health.js              recordRun(): stats/health, latest run of each scheduled sync
netlify/lib/http.js                fetchWithRetry/getJson/getText (timeouts, retries, key masking), json()
scripts/build-member-votes.js      Rebuild member_votes + vote_index from full votes [--write] [--congress N]
scripts/build-stats.js             Rebuild stats/overview [--backfill party_breakdown]
scripts/import-votes.js            Backfill all House + Senate votes of a congress (resumable)
scripts/import-bills.js            Backfill the N most recently updated bills (resumable)
scripts/summarize-bills.js         CRS-based AI summaries for stored bills (resumable)
netlify/functions/member-profile.js  GET /api/member-profile?id={bioguideId}: Congress.gov member detail +
                                   10 latest sponsored bills/amendments (key stays server-side)
netlify/functions/member-finance.js GET ?id={bioguideId}: OpenFEC totals, receipt sources,
                                   donation-size buckets, itemized by state (api.data.gov key)
netlify/functions/bill-detail.js   GET /api/bill-detail?id={bill_id}: sponsor, cosponsor count, latest CRS
                                   summary, action history (works for bills not in `bills`)
netlify/lib/bills.js               Congress.gov fetch helpers, bill doc shaping,
                                   policy-area -> category map, summary generation
netlify/lib/firebase.js            firebase-admin init (raw or base64 service account)
run-ingest.js                      Runs ingest-votes handler locally
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
```

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
- House and Senate syncs run in parallel and independently (`Promise.allSettled`).
  A full ingest (members + votes + stats rebuild) took ~6.6s locally; watch Netlify's 10s
  limit. If it gets close, move the stats rebuild into its own scheduled function.
- Congress.gov bill action histories lag senate.gov by about a day, so a brand-new Senate
  vote may not be linked from the bill's Actions tab yet.

**`stats/overview`** — single doc (~12 KB), rebuilt by every `ingest-votes.js` run and by
`scripts/build-stats.js`; read once by the Overview tab
```
congress, first_vote_date, last_vote_date, totals { House, Senate },
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
  position, group (yea|nay|present|not_voting|other), party_majority }], updated_at
```
The member modal's Voting Record reads this one doc. Each `votes` doc has `members_applied`
(false when written by ingest/import, true once counted). Every ingest applies all
unapplied votes of the Congress to member_votes **and** vote_index, then flags them, so
a failed run is retried next time. Totals reset when `congress` changes.
`scripts/build-member-votes.js --write` rebuilds both from scratch (~1,600 full-vote reads).
Votes written by code that doesn't set `members_applied` (anything older than commit
a547327) are never applied: re-run the build script after such a run.

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
ingest_votes | sync_bills: { last_run, last_success, ok, failed_steps[], counts }
```
Step names only, no error text. The footer shows "Data last updated"; a notice appears
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

## Current state (as of 2026-11-11)

Live at https://congress-watcher.netlify.app: Overview, Issues, Bills, Votes, Legislators
tabs, detail modals, campaign finance. Data is complete for the 119th Congress (votes
1,600/1,600, laws 140/140 as of 2026-11-11) and kept current by the two scheduled syncs.

### Pending deploy (do first on 2026-11-12)
Commits a547327..HEAD (member_votes, vote_index, stats/health) are committed but **not
pushed**. Firestore's free 50k reads/day ran out on 2026-11-11 (resets midnight Pacific).
Do these in order:
1. After the 10:00 UTC scheduled ingest (still old code, which writes votes without
   `members_applied`): `node scripts/build-member-votes.js --write`. It builds
   member_votes + vote_index and flags every vote applied.
2. Publish `firestore.rules` (adds the `member_votes` read rule), with the user's OK,
   **before** the deploy, or the Voting Record tab gets permission errors.
3. Verify locally (Voting Record, Overview numbers ≈1,600 votes, footer), then push all
   commits at once. The newest commit must not say `[skip netlify]`, or the deploy is skipped.
4. Next scheduled runs write stats/health; check the logs and the footer.
Why this order: deployed before the backfill, the ingest would create a partial
vote_index and the stats rebuild would trust it. Remove this section once done.

### Project review fixes (2026-11-11)
A full review found four must-fix problems; all fixed:
1. **Vote ingest dropped votes.** It took the 5 newest per chamber; 76 chamber-days had
   more (up to 24), so 22% of votes would have been missed. Now: every vote not yet
   stored (compared against stored ids), newest first, ≤40/chamber/run, in parallel.
2. **Congress rollover (Jan 3, 2027).** `currentCongress()` derives it from the date;
   nothing hard-codes 119. Stats keep describing the previous Congress until the new
   one has `MIN_VOTES_TO_DISPLAY` (25) votes, and label which Congress they cover.
3. **Stale bill stages.** `sync-bills` now re-enriches every *tracked* bill updated since
   `sync_state/bills.last_refresh`, plus any bill on the official laws list not stored as
   a law (≤60/run), then rebuilds stats. Full run ~12 s.
4. **Public function abuse.** Durable `Netlify-CDN-Cache-Control` on member-profile,
   bill-detail, member-finance (404s cached 1h); rate limit 60/min per visitor on
   member-profile and bill-detail (plan allows 2 rules). Rate-limited functions must
   have an explicit path, so they live at `/api/member-profile` and `/api/bill-detail`
   (`FUNCTION_PATHS` in app.js); the old `/.netlify/functions/` paths 404.
Plus: `npm test` (tests/rules.test.js, node:test) runs in the Netlify build command, so a
broken rule fails the deploy.

`sync_state` is server-only (no read rule in firestore.rules, so browsers are denied).

### Review: second tier (done 2026-11-11)
- Shared `netlify/lib/http.js` (timeouts + retries everywhere); `node-fetch`,
  FABRICATED_FIELDS cleanup and `scripts/backfill-bills.js` removed; firebase-admin 13.10
  (`npm audit` still shows 8 moderate in unused Google Cloud deps; the fix needs
  firebase-admin 14 / Node 22+).
- Per-member `member_votes` docs (Voting Record = 1 read, whole-Congress totals).
- Nightly reads cut: `vote_index` replaces ~3 x 1,600 vote reads per night with ~8 doc reads.
  (Firestore's free tier is 50k reads/day; it ran out on 2026-11-11 during backfills.)
- `stats/health` + "Data last updated" footer + stale-data notice.

### Review: remaining recommendations (not done yet)
- Alert on failed scheduled runs (email/webhook); today the site notice is the signal.
- Frontend: split the 1,700-line app.js into modules; Tailwind build step (CDN warns in
  production); URL routing for shareable links; modal focus trap.
- Product: find-your-representative by address (Census geocoder); shareable links;
  "what Congress did this week" digest; focused/broad split for every topic (Healthcare
  shows only 11 measures because health provisions ride in budget bills); reframe the
  "bills tracked" headline; a "How we count" methodology page; "report an error".
- Docs: real README; trim this file (it's part changelog).

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
  law" current) and summarizes never-checked (null) bills first within its 3-summary
  budget. `ingest-votes` ran ~7s locally after this change.

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

- Theme lives in the inline `tailwind.config` in `index.html`. Fonts: Inter (body) and
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
  House vacancies (out of 435), delegates, bills tracked and votes synced (via
  `getCountFromServer`). Member cards are clickable and set the directory filters.

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
  (synced `votes` where `bill_id ==`). Works for bills not in `bills` via `bill-detail`.
- **Vote** (id = vote doc id): Results (tallies, party table, bill link, Clerk record) /
  How members voted (grouped by position; filter by name, a bare state code like "WA",
  or party; names open member modals). Unsynced roll calls say so.
- Functions are cached per id in the page and for 1h via `Cache-Control`. If they fail,
  modals still show Firestore data plus a Retry button.
- Voting Record = the member's `member_votes` doc: participation and party agreement over
  the whole Congress, plus the latest 50 votes. "Voted with party majority" = matches most
  of their party's Yea/Nay on that roll call (ties and Independents excluded).
- Not done: Tab-key focus trap inside the modal; deep links (e.g. `#bill/hr9612-119`).

## Votes paging (frontend)

- `loadVotes` mirrors bills: `orderBy('date','desc')`, 10 per page, `startAfter` cursor,
  "Load older votes", month headings, "Showing N votes back to <date>".
- Chamber chips query `where('chamber','==')` + `orderBy('date')`, which needs the
  (chamber ASC, date DESC) index in `firestore.indexes.json`. If it's missing
  (`failed-precondition`), `queryVotes` switches to paging all votes 30 at a time and
  filtering by chamber in the browser, so the chips still work (pages are just uneven).
  The index was created in the Firebase console on 2026-11-10; the fallback is a safety net.
- `voteCache` holds every vote seen; the vote modal checks it before Firestore.

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
5. ~~Directory filters and headline counts~~ Done (see Legislators tab above).
6. ~~Money & donors via OpenFEC~~ Done as the member Campaign Finance tab.
7. ~~Visual refresh~~ Done (see Visual design above).
8. ~~Rename `sync-votes.js` → `sync-bills.js`~~ Done 2026-11-10 (no schedules or callers in
   the repo; any external cron hitting `/.netlify/functions/sync-votes` must be updated).
   Senate roll-call votes added at the same time (see `votes` schema).

### History backfill (2026-11-10)
- `import-votes.js --write` loaded every 119th-Congress roll call (House 681, Senate 917),
  Jan 3 2025 onward. It maps Senate LIS ids with current **and historical**
  congress-legislators (13.5 MB, script only), then remaps stored Senate votes. That fixed
  1,583 entries for senators who've since left (Graham, Mullin, Rubio, Vance). The nightly
  `ingest-votes` uses only the current file, so a senator who leaves later can show
  unlinked on new votes. Re-run `import-votes.js --write --chamber senate` to fix.
- `import-bills.js --write` loaded the 2,000 most recently updated bills (metadata only).
  Extend with `--limit` (19,863 bills in the 119th; >20k Firestore writes/day can exceed
  the free tier). Then run `scripts/summarize-bills.js --write`.
- `summarize-bills.js --write` checked all 1,994 stored bills: 987 now have a CRS-based
  AI summary (gpt-4o-mini, well under $1 total); 1,007 are marked
  `crs_summary_available: false`. `sync-bills` re-checks up to 5 waiting bills per run
  (oldest check first, at most every 3 days) within its 3-summary budget.

### Deploy & schedules (2026-11-11)
- Netlify project **congress-watcher** (https://congress-watcher.netlify.app) auto-deploys
  `main` from GitHub `Ross1309/bill_insights`. Env vars set there: `CONGRESS_API_KEY`,
  `FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY` (FEC reuses the Congress key).
- **Credits:** Personal credit plan, 1,000 credits per period (resets on the 11th, Pacific).
  Builds are blocked when usage is exceeded. That happened Nov 10–11: three deploys were
  "Skipped due to account credit usage exceeded". Every production deploy costs credits,
  so batch commits and push less often. Check usage in the Netlify UI (Billing → Usage).
- `netlify.toml` schedules: `ingest-votes` 10:00 UTC, `sync-bills` 10:30 UTC daily.
  Scheduled functions get **30 s** (not 10 s), only run on the published deploy, and
  **can't be called by URL in production**, so nobody can trigger OpenAI/Firestore
  spend from outside. Trigger manually with **Run now** on the function's page in the
  Netlify UI; locally `node run-ingest.js` / `netlify dev` + curl still work.
- First successful deploy of this session's work: `7ce0ecf` (2026-11-11). Verified live:
  every tab, `member-profile` / `bill-detail` / `member-finance` return 200; `sync-bills`
  and `ingest-votes` return 403 from outside (scheduled-only); old `sync-votes` 404.
  The first scheduled runs are 10:00/10:30 UTC on 2026-11-12. Check them in the Netlify
  UI (Functions → logs) or `netlify logs --function ingest-votes --since 24h`.
- Docs-only commits can skip a credit-costing deploy with `[skip netlify]` in the message.

### Proposed next
(See "Review: remaining recommendations" above for the prioritized list.)
- Issue tracker follow-ups: more topics (Immigration, Defense?) = add to topics.js +
  chip in index.html; "moving now" section; bills that never reached the floor would need
  the complete (~20k bill) enrichment.
- Waiting bills only get re-checked 5 per sync run; with ~1,000 waiting, run
  `summarize-bills.js --write` occasionally (or schedule it) to catch new CRS summaries.
