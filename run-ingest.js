import 'dotenv/config';
import { handler } from './netlify/functions/ingest-votes.js';

console.log("Starting local ingestion script...");

handler({}, {})
  .then(res => console.log("Done!", res))
  .catch(err => console.error("Error:", err));