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
netlify/functions/sync-bills.js    Syncs recent bills + AI summaries (was sync-votes.js)
netlify/functions/ingest-votes.js  Syncs all current members (+ directory doc) + 5 latest House
                                   and 5 latest Senate roll-call votes
netlify/lib/senate-votes.js        senate.gov LIS XML -> `votes` docs (menu, vote parse, ET->UTC)
netlify/lib/house-votes.js         Congress.gov House votes -> `votes` docs (list + build doc)
scripts/import-votes.js            Backfill all House + Senate votes of a congress (resumable)
scripts/import-bills.js            Backfill the N most recently updated bills (resumable)
netlify/functions/member-profile.js  GET ?id={bioguideId}: Congress.gov member detail +
                                   10 latest sponsored bills/amendments (key stays server-side)
netlify/functions/member-finance.js GET ?id={bioguideId}: OpenFEC totals, receipt sources,
                                   donation-size buckets, itemized by state (api.data.gov key)
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
curl localhost:8888/.netlify/functions/sync-bills   # bill sync (10 bills, ≤3 summaries/run)
node scripts/backfill-bills.js                      # dry run
node scripts/backfill-bills.js --write [--summaries]
node scripts/import-votes.js [--write] [--chamber house|senate] [--congress 118] [--limit N]
node scripts/import-bills.js [--write] [--limit 2000]
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
ai_summary { bullet_points[], source: "crs_summary"|"title_only", model, generated_at },
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
  A full ingest took ~5s locally; watch Netlify's 10s function limit.
- Congress.gov bill action histories lag senate.gov by about a day, so a brand-new Senate
  vote may not be linked from the bill's Actions tab yet.

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
- `sync-bills.js` must stay under Netlify's function timeout: detail fetches run in
  parallel and AI summaries are capped at 3 per run.
- Votes link to bills that usually aren't in `bills` (bill sync only takes the 10 most
  recently updated). Consider syncing bills referenced by votes.

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
- Voting Record = latest 50 `votes` (shared `getRecentVotes`) filtered to the member;
  "voted with party majority" = matches most of their party's Yea/Nay on that roll call
  (ties and Independents excluded). Only votes from the member's own chamber count.
- Scaling note: once many votes accumulate, filtering the latest 50 client-side will
  miss older votes. Then add a `voter_ids` array to vote docs and query
  `array-contains` + `orderBy('date')` (needs a composite index).
- Not done: Tab-key focus trap inside the modal; deep links (e.g. `#bill/hr9612-119`).

## Votes paging (frontend)

- `loadVotes` mirrors bills: `orderBy('date','desc')`, 10 per page, `startAfter` cursor,
  "Load older votes", month headings, "Showing N votes back to <date>".
- Chamber chips query `where('chamber','==')` + `orderBy('date')`, which needs the
  (chamber ASC, date DESC) index in `firestore.indexes.json`. If it's missing
  (`failed-precondition`), `queryVotes` switches to paging all votes 30 at a time and
  filtering by chamber in the browser, so the chips still work (pages are just uneven).
  The index was created in the Firebase console on 2026-11-10; the fallback is a safety net.
- Member Voting Record uses `getRecentVotes(chamber)`: the member's own chamber's latest
  50 votes. `voteCache` holds every vote seen; the vote modal checks it before Firestore.

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
  Backfilled bills have no AI summary ("Summary pending") until something generates one;
  `sync-bills` only summarizes new bills (≤3/run). Extend with `--limit` (19,863 bills in
  the 119th; >20k Firestore writes/day can exceed the free tier).

### Proposed next
- Deploy and verify on Netlify: env vars, every function, and `ingest-votes` runtime vs the
  10s limit (split members / House / Senate into separate functions if needed).
- Schedule the syncs (Netlify scheduled functions) for `sync-bills` and `ingest-votes`.
- Voting Record scaling: `voter_ids` array + `array-contains` query (see Detail modals).
- Title-only AI summaries still speculate (see Pending).
