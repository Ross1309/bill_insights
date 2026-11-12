// Run the nightly ingest (members, House + Senate votes, member records, stats) once,
// locally. Writes to the real Firestore. Exits non-zero if the run failed.
import 'dotenv/config';
import { handler } from './netlify/functions/ingest-votes.js';

console.log("Starting local ingestion script...");

handler({}, {})
  .then(res => {
    console.log("Done!", res);
    if (res.statusCode >= 400 || JSON.parse(res.body || "{}").errors?.length) process.exitCode = 1;
  })
  .catch(err => { console.error("Error:", err); process.exitCode = 1; });
