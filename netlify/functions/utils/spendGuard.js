// ═══════════════════════════════════════════════════════════════════════════
// Spend guard for the key-holding proxies (gemini, image-search)
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS
//
// The CORS allowlist in common.js only binds BROWSERS. Verified live on
// 2026-07-31: a plain `curl` with no Origin header reached the Gemini proxy and
// came back 400 "Unsupported or missing model" — meaning the request had been
// accepted and was merely missing a field. With a valid model and payload it
// would have spent the shared GEMINI_API_KEY, and nothing bounded how often.
//
// TWO LAYERS, because neither is sufficient alone:
//
// 1. ORIGIN ENFORCEMENT — refuse, don't just withhold headers. Every real call
//    is a browser fetch from the app to a relative /.netlify/functions/... path
//    (modules/image-ai.js, voice-modes.js, theme-drawer.js), so a genuine
//    request always carries an allowed Origin. Free, instant, and it stops all
//    casual abuse. It is not sufficient because an Origin header is trivially
//    forged by the same script it blocks.
//
// 2. DAILY BUDGETS in Netlify Blobs, so they survive between invocations —
//    functions are ephemeral, so an in-memory counter would reset constantly
//    (the exact bug that made ProMapper's ceilings decorative). A per-IP
//    allowance, plus one absolute house ceiling because per-IP budgets multiply
//    across a botnet's addresses.
//
// Bring-your-own-key callers skip the budgets entirely — their quota, their
// spend — but still face the origin check.
//
// KNOWN LIMIT, accepted on purpose: Netlify Blobs has no atomic increment, so
// two simultaneous requests can read the same count and both write count+1,
// losing a tick. That undercounts under heavy concurrency. It is still the
// difference between a bounded day and an unbounded one, and the alternative is
// running a Redis for a slideshow app. If this ever needs to be exact, that is
// the upgrade — not more code here.

import { connectLambda, getStore } from '@netlify/blobs';
import { isAllowedOrigin } from './common.js';

const BUDGET_STORE = 'spend-budgets';

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// Generous by design — a single deck build is a handful of calls, so honest use
// never comes near these. Both are env-tunable without a code change; 0 disables.
const perIpDailyLimit = () => num(process.env.AI_DAILY_LIMIT_PER_IP, 60);
const globalDailyLimit = () => num(process.env.AI_DAILY_LIMIT_GLOBAL, 2000);

/** UTC day, so the key rolls over on its own and yesterday stops mattering. */
function dayBucket(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function clientIp(event) {
  const h = event.headers || {};
  return (
    h['x-nf-client-connection-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

async function bump(store, key, limit) {
  const current = num(await store.get(key), 0);
  const next = current + 1;
  await store.set(key, String(next));
  return next <= limit;
}

/**
 * Refuse anything that isn't the app itself, then charge the request against
 * the daily budgets. Returns null when the request may proceed, or a ready-made
 * Netlify response when it must not.
 *
 * @param {object} event    the Lambda event
 * @param {object} headers  CORS headers already computed by the caller
 * @param {boolean} usesHouseKey  false when the visitor brought their own key
 */
export async function guardSpend(event, headers, usesHouseKey = true) {
  if (!isAllowedOrigin(event.headers || {})) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Not available from this origin.' }),
    };
  }

  // Their key, their bill.
  if (!usesHouseKey) return null;

  const perIp = perIpDailyLimit();
  const global = globalDailyLimit();
  if (perIp <= 0 && global <= 0) return null;

  try {
    connectLambda(event);
    const store = getStore(BUDGET_STORE);
    const day = dayBucket();

    if (global > 0) {
      const ok = await bump(store, `global-${day}`, global);
      if (!ok) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: 'Slideomatic is unusually busy today. Add your own Gemini key in Settings to keep going.',
          }),
        };
      }
    }

    if (perIp > 0) {
      const ok = await bump(store, `ip-${day}-${clientIp(event)}`, perIp);
      if (!ok) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: "That's today's free allowance used up. Add your own Gemini key in Settings for unlimited use.",
          }),
        };
      }
    }

    return null;
  } catch (err) {
    // Fail OPEN and say so. A blob store hiccup should not take the app down;
    // the origin check above still stands, and a silent failure would be worse
    // than a noisy one. If this line appears in the logs, the budget is off.
    console.error('[spendGuard] budget unavailable, allowing request:', err?.message || err);
    return null;
  }
}
