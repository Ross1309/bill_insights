// Shared HTTP helpers for functions and scripts: every outside request gets a
// timeout and a couple of retries on 429 / 5xx / network errors, and API keys are
// masked in error messages.

export class HttpError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

const redact = url => String(url).replace(/(api_key=)[^&]+/, '$1***');
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchWithRetry(url, { timeoutMs = 15000, retries = 2, ...init } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt < retries) { await sleep(500 * 3 ** attempt); continue; }
      throw new HttpError(`${err.name === 'TimeoutError' ? 'Timed out' : 'Request failed'} for ${redact(url)}`);
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 5) * 1000 : 500 * 3 ** attempt);
      continue;
    }
    throw new HttpError(`HTTP ${res.status} for ${redact(url)}`, res.status);
  }
}

export async function getJson(url, opts) {
  return (await fetchWithRetry(url, opts)).json();
}

export async function getText(url, opts) {
  return (await fetchWithRetry(url, opts)).text();
}

// JSON Response for Netlify (v2) functions.
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
