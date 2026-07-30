// ═══════════════════════════════════════════════════════════════════════════
// Image search proxy function
// ═══════════════════════════════════════════════════════════════════════════
//
// Searches licensed stock-image providers server-side so their API keys
// (process.env.PEXELS_API_KEY, and later UNSPLASH_ACCESS_KEY) never ship in
// the client bundle. The client posts { query, page? } and gets back a merged,
// normalized list of results:
//   { id, thumb, full, alt, width, height, credit, creditUrl, source }
//
// Providers are queried in parallel and interleaved so no single source
// dominates the grid. A provider with no key configured is silently skipped,
// so this works with just Pexels today and gains Unsplash the moment a key is
// added — no client change needed.
// ═══════════════════════════════════════════════════════════════════════════

import { allowlistCorsHeaders } from './utils/common.js';
import { guardSpend } from './utils/spendGuard.js';

const PER_PAGE = 24;

// Interleave provider result lists round-robin so the grid alternates sources
// (a, b, a, b, ...) rather than showing one provider's whole page first.
function interleave(lists) {
  const merged = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (list[i]) merged.push(list[i]);
    }
  }
  return merged;
}

async function searchPexels(query, page) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    throw new Error(`Pexels ${res.status}`);
  }
  const data = await res.json();
  return (data.photos || []).map((p) => ({
    id: `pexels-${p.id}`,
    thumb: p.src?.medium || p.src?.small || p.src?.tiny,
    full: p.src?.large2x || p.src?.large || p.src?.original,
    alt: p.alt || query,
    width: p.width,
    height: p.height,
    credit: p.photographer,
    creditUrl: p.photographer_url,
    source: 'Pexels',
  }));
}

// Unsplash slot — dormant until UNSPLASH_ACCESS_KEY is set. Same normalized
// shape as Pexels so the client never has to branch on source.
async function searchUnsplash(query, page) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
  });
  if (!res.ok) {
    throw new Error(`Unsplash ${res.status}`);
  }
  const data = await res.json();
  return (data.results || []).map((p) => ({
    id: `unsplash-${p.id}`,
    thumb: p.urls?.small,
    full: p.urls?.regular,
    alt: p.alt_description || query,
    width: p.width,
    height: p.height,
    credit: p.user?.name,
    creditUrl: p.user?.links?.html,
    source: 'Unsplash',
  }));
}

export async function handler(event) {
  const headers = allowlistCorsHeaders(event.headers || {});

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

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing search query' }) };
  }
  const page = Number.isInteger(body.page) && body.page > 0 ? body.page : 1;

  // Same door as the Gemini proxy: this one holds PEXELS_API_KEY. There is no
  // bring-your-own variant here, so the house always pays.
  const blocked = await guardSpend(event, headers, true);
  if (blocked) return blocked;

  const providers = [searchPexels, searchUnsplash];
  const settled = await Promise.allSettled(providers.map((fn) => fn(query, page)));

  const lists = [];
  const providerErrors = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      lists.push(result.value);
    } else {
      providerErrors.push(String(result.reason?.message || result.reason));
    }
  }

  const results = interleave(lists);

  // Every provider failing (or none configured) is the only real error; a
  // partial failure still returns whatever succeeded.
  if (results.length === 0 && lists.length === 0) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: { message: `Image search unavailable: ${providerErrors.join('; ') || 'no providers configured'}` },
      }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ query, page, results, warnings: providerErrors }),
  };
}
