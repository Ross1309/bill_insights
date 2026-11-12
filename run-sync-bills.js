// Run the nightly bill sync (recent bills, tracked-bill refresh, CRS summary backlog,
// stats) once, locally, with the keys in .env. Writes to the real Firestore and calls
// OpenAI. Use this rather than `netlify dev` + curl: Netlify hands `netlify dev` a
// masked placeholder for secret variables (OPENAI_API_KEY), so summaries fail there.
import 'dotenv/config';
import handler from './netlify/functions/sync-bills.js';

console.log("Starting local bill sync...");
const res = await handler(new Request("http://localhost/", { method: "POST", body: "{}" }));
const body = await res.json();
console.log("Done!", res.status, body);
if (res.status >= 400) process.exitCode = 1;
