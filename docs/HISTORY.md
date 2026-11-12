# Congress Watcher: project history

Dated notes moved out of CLAUDE.md on 2026-11-12 (unchanged), so CLAUDE.md can describe
the project as it is now. Newest work is described in git history and CLAUDE.md.

### Second-tier deploy (2026-11-12)
Built member_votes (556), vote_index (4 docs), sync_state/tracked (611 bills + 140 laws)
and stats headline; published the member_votes read rule; then pushed. The Nov 12 10:00
UTC ingest on the *old* deploy crashed at init (`node-fetch` -> fetch-blob breaks on
Netlify's Node 24 runtime; removed in 66a1108). Both syncs then ran fine locally on the new
code (ingest 14 s first run / 2.7 s quiet run; sync-bills 8.6 s).

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

### Review: second tier (done 2026-11-11)
- Shared `netlify/lib/http.js` (timeouts + retries everywhere); `node-fetch`,
  FABRICATED_FIELDS cleanup and `scripts/backfill-bills.js` removed; firebase-admin 13.10
  (`npm audit` still shows 8 moderate in unused Google Cloud deps; the fix needs
  firebase-admin 14 / Node 22+).
- Per-member `member_votes` docs (Voting Record = 1 read, whole-Congress totals).
- Nightly reads cut: `vote_index` replaces ~3 x 1,600 vote reads per night with ~8 doc reads.
  (Firestore's free tier is 50k reads/day; it ran out on 2026-11-11 during backfills.)
- `stats/health` + "Data last updated" footer + stale-data notice.

### Review: third tier (done 2026-11-12)
- Bills tab ordered by `latest_action_date` (see Bills paging).
- ESLint gate + Playwright smoke test + GitHub Actions (CI on push, daily health check
  that emails on failure). app.js split into modules (see Layout).

- Shareable links (router.js) and "Find your representatives" by address (Census geocoder).
- "How we count" page, Report an error links, modal focus trap, "Bills covered" card.

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

## Original next steps (all done)

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
