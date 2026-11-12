# Congress Watcher

**https://congress-watcher.netlify.app**

A non-partisan site that shows what the U.S. Congress is actually doing, straight from
official records:

- **Overview:** how busy each chamber has been, how often the parties' majorities voted
  together or apart, what kinds of votes succeeded or failed, and every state's delegation.
- **Issues:** plain-language topic pages (Economy, Healthcare, Foreign Affairs, with
  watchlists for Iran, Israel and foreign aid): what reached a vote, what became law, and
  how each party voted.
- **Bills & Summaries:** bills ordered by their latest action, each with a plain-language
  summary written only from the official Congressional Research Service (CRS) summary.
- **Roll-Call Votes:** every recorded House and Senate vote this Congress, with the party
  breakdown and how each member voted.
- **Legislators:** every current member, with their voting record, sponsored legislation
  and campaign finance (FEC). Enter an address to find your two senators and representative.

Every page has a shareable link, and [How we count](https://congress-watcher.netlify.app/#methodology)
explains every rule behind the numbers. No scores, rankings or AI judgments of members.

## Where the data comes from

| Data | Source |
|---|---|
| Bills, actions, laws, CRS summaries and subjects, members | [Congress.gov API](https://api.congress.gov/) (Library of Congress) |
| House roll-call votes | Office of the Clerk of the U.S. House, via Congress.gov |
| Senate roll-call votes | [senate.gov](https://www.senate.gov/legislative/votes_new.htm) vote records |
| Campaign finance | [FEC (OpenFEC)](https://api.open.fec.gov/developers/) |
| Congressional district for an address | [U.S. Census Bureau geocoder](https://geocoding.geo.census.gov/) |
| Member ID mappings (FEC, Senate) | [congress-legislators](https://github.com/unitedstates/congress-legislators) |
| Plain-language summaries | OpenAI `gpt-4o-mini`, from the CRS summary only, labeled as AI-written |

Two scheduled jobs update the data every night (10:00 and 10:30 UTC). The site footer
shows when each last finished.

## How it works

```
Congress.gov, senate.gov, OpenAI ──> Netlify scheduled functions ──> Firestore
                                        (ingest-votes, sync-bills)     │
                                                                       ▼
  Browser (public/: plain ES modules) ── reads Firestore directly ─── site
        │
        └── Netlify functions on demand: member profile, bill detail,
            campaign finance (FEC), find your district (Census)
```

- **Frontend:** `public/` is static HTML and ES modules with no bundler. Styles are
  Tailwind, built into a committed `public/styles.css`. The browser reads Firestore
  directly; security rules allow public reads of the published collections and no writes.
- **Backend:** Netlify Functions (Node 22+) using `firebase-admin`. The nightly jobs store
  votes, members and bills, then precompute small documents (overview stats, topic pages,
  per-member voting records), so each page view costs only a few reads.
- **Scripts** in `scripts/` backfill history and rebuild the precomputed documents.

`CLAUDE.md` is the detailed working reference (schema, rules, operations), and
`docs/HISTORY.md` has dated notes.

## Running it locally

Requirements: Node 22+, the [Netlify CLI](https://docs.netlify.com/cli/get-started/),
and a Firebase project.

1. `npm install`
2. Create `.env` (never commit it):
   ```
   CONGRESS_API_KEY=...          # free api.data.gov key; also used for OpenFEC
   FIREBASE_SERVICE_ACCOUNT=...  # service account JSON, raw or base64
   OPENAI_API_KEY=...            # only needed for summaries (sync-bills)
   ```
3. `netlify dev`, then open http://localhost:8888

Useful commands:

```
npm test                 # ESLint + styles.css up to date + unit tests (also run by Netlify builds)
npm run build:css        # rebuild public/styles.css after changing classes
npm run smoke            # headless-browser test of every tab (first: npx playwright install chromium)
npm run health           # did last night's scheduled syncs succeed?
node run-ingest.js       # run the nightly vote + member sync once, locally
```

## Checks and monitoring

- `npm test` runs on every Netlify build, so a lint error, stale CSS or failing test blocks
  the deploy.
- GitHub Actions run the tests and a browser smoke test on every push, and once a day check
  that the nightly syncs succeeded and the live site works. A failed run sends an email.

## Found a mistake?

Use **Report an error** in the site's footer or at the bottom of any detail window, or
[open an issue](https://github.com/Ross1309/bill_insights/issues/new).
