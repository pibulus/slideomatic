// ═══════════════════════════════════════════════════════════════════════════
// Gemini proxy function
// ═══════════════════════════════════════════════════════════════════════════
//
// Proxies generateContent calls to Google's Gemini API so the SHARED app key
// (process.env.GEMINI_API_KEY) lives server-side and never ships in the client
// bundle. The client posts { model, payload, userKey? }:
//   - userKey present  → use the visitor's own pasted key (their quota, their risk)
//   - userKey absent   → fall back to the app's server-side key (works out of box)
//
// Mirrors the request shape the client used to send directly to Google, so the
// model output is returned verbatim for the existing parsers to consume.
// ═══════════════════════════════════════════════════════════════════════════

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ALLOWED_MODELS = new Set([
  'gemini-flash-latest',      // text: voice, decisions, edit, theme
  'gemini-3.1-flash-image',   // image generation (responseModalities:['Image'])
  // legacy/fallback names kept allowed in case an older client or pasted config uses them
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
]);

// The app only ever calls this proxy same-origin (relative /.netlify/... paths),
// so cross-origin browser access is never legitimate. Echoing arbitrary Origins
// here would let any other website use this endpoint — and the server-side app
// key — as a free Gemini proxy from their visitors' browsers. Only the app's
// own origins (plus local dev) get CORS headers; everyone else gets none, so
// their browsers refuse the response.
const ALLOWED_ORIGINS = new Set([
  'https://slideomatic.app',
  'https://www.slideomatic.app',
]);
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function cors(headers = {}) {
  const origin = headers.origin || headers.Origin || '';
  const allowed = ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin);
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

// transient 503/429 backoff so a busy model degrades to a slight delay
async function withRetry(fn, tries = 3, baseMs = 600) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fn();
      if (res.status === 503 || res.status === 429) {
        if (i === tries - 1) return res;
        await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}

export async function handler(event) {
  const headers = cors(event.headers || {});

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { model, payload, userKey } = body;
  if (!model || !ALLOWED_MODELS.has(model)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unsupported or missing model' }) };
  }
  if (!payload || typeof payload !== 'object') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing payload' }) };
  }

  // visitor key wins; otherwise the app's server-side key
  const apiKey = (typeof userKey === 'string' && userKey.trim()) || process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'No API key available — add your own Gemini key in Settings.' }),
    };
  }

  try {
    const res = await withRetry(() =>
      fetch(`${GEMINI_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(payload),
      })
    );
    const text = await res.text();

    // On success, pass Gemini's native JSON straight through to the client parser.
    if (res.ok) {
      return { statusCode: res.status, headers, body: text };
    }

    // On failure Google sometimes returns an HTML error page. The client does
    // response.json().catch(() => null), so raw HTML becomes a silent null and
    // masks the real error. Guarantee a consistent JSON error shape instead.
    let message = text;
    try {
      const parsed = JSON.parse(text);
      const detail = parsed?.error?.message || parsed?.error || text;
      message = typeof detail === 'string' ? detail : JSON.stringify(detail);
    } catch {
      // non-JSON (e.g. HTML) — keep the raw text
      message = text;
    }
    message = String(message).slice(0, 500);
    // Nest under error.message so existing clients that read
    // `error.error?.message` surface the real reason instead of a generic fallback.
    return {
      statusCode: res.status,
      headers,
      body: JSON.stringify({
        error: { message: `Gemini request failed (${res.status}): ${message}` },
      }),
    };
  } catch (err) {
    // Same nested shape as the failure path above so clients reading
    // error.error?.message get a real reason on a 502 too.
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: { message: 'Proxy failed: ' + String(err?.message || err) } }),
    };
  }
}
