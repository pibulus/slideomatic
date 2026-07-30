
// ═══════════════════════════════════════════════════════════════════════════
// Netlify Functions Shared Utilities
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';

export const STORE_NAMES = {
  ASSETS: 'deck-assets',
  SHARES: 'shared-decks',
};

export const LIMITS = {
  MAX_DECK_BYTES: 500 * 1024,        // 500KB - JSON should be small
  MAX_ASSET_BYTES: 500 * 1024,       // 500KB - matches client compression
  SHARE_ASSET_BYTES: 200 * 1024,     // 200KB - aggressive for sharing
  THUMBNAIL_BYTES: 50 * 1024,        // 50KB - for overview mode
};

// Shares and their externalized assets expire together; viewing a share
// refreshes both, so actively-used links stay alive indefinitely.
export const TTL = {
  SHARE_MS: 90 * 24 * 60 * 60 * 1000,
  ASSET_MS: 90 * 24 * 60 * 60 * 1000,
};

export const CACHE_HEADERS = {
  IMMUTABLE: 'public, max-age=31536000, immutable',
  NO_STORE: 'no-store',
};

export const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': CACHE_HEADERS.NO_STORE,
  'Access-Control-Allow-Origin': '*',
  Vary: 'Origin',
};

const ADJECTIVES = [
  'lunar', 'fizzy', 'velvet', 'lilac', 'glossy', 'cosmic', 'spicy', 'sunlit',
  'midnight', 'holo', 'vivid', 'lofi', 'neon', 'turbo', 'sugar', 'chill'
];

const NOUNS = [
  'panda', 'tiger', 'echo', 'drift', 'pulsar', 'marble', 'comet', 'noodle',
  'petal', 'zeppelin', 'dawn', 'orbit', 'pixel', 'mixtape', 'seahorse', 'satchel'
];

export function corsHeaders(headers = {}, methods = 'GET,POST,OPTIONS') {
  const origin = headers.origin || headers.Origin || '*';
  return {
    ...BASE_HEADERS,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'content-type',
  };
}

// Strict allowlist variant for the key-holding proxies (gemini, image-search).
// Those endpoints are only ever called same-origin (relative /.netlify/...
// paths), so cross-origin browser access is never legitimate. Echoing
// arbitrary Origins would let any other website use them — and the app's
// server-side API keys — as a free proxy from their visitors' browsers. Only
// the app's own origins (plus local dev) get CORS headers; everyone else gets
// none, so their browsers refuse the response.
const ALLOWED_ORIGINS = new Set([
  'https://slideomatic.app',
  'https://www.slideomatic.app',
]);
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// The allowlist as a yes/no, for callers that must REFUSE rather than merely
// withhold CORS headers. Omitting the header only stops a browser; a script
// never reads it. See utils/spendGuard.js.
export function isAllowedOrigin(headers = {}) {
  const origin = headers.origin || headers.Origin || '';
  return ALLOWED_ORIGINS.has(origin) || DEV_ORIGIN.test(origin);
}

export function allowlistCorsHeaders(headers = {}) {
  const origin = headers.origin || headers.Origin || '';
  const allowed = isAllowedOrigin(headers);
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

export function createAssetId(filename = 'asset') {
  const safeName = filename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32) || 'asset';
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${safeName}-${stamp}-${random}`;
}

export function buildAssetUrl(event, assetId, options = {}) {
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host;
  const protocol = event.headers?.['x-forwarded-proto'] || 'https';

  let baseUrl;
  if (!host) {
    baseUrl = `/.netlify/functions/asset?id=${encodeURIComponent(assetId)}`;
  } else {
    baseUrl = `${protocol}://${host}/.netlify/functions/asset?id=${encodeURIComponent(assetId)}`;
  }

  // Enable Netlify Image CDN optimization
  // https://docs.netlify.com/image-cdn/overview/
  if (options.optimize && host) {
    const params = new URLSearchParams();
    if (options.width) params.set('w', options.width);
    if (options.quality) params.set('q', options.quality);
    if (options.format) params.set('fm', options.format);

    const queryString = params.toString();
    return `${protocol}://${host}/.netlify/images?url=${encodeURIComponent(baseUrl)}${queryString ? '&' + queryString : ''}`;
  }

  return baseUrl;
}

export function decodeDataUrl(dataUrl, overrideMime) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  const [, declaredMime = 'application/octet-stream', base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');
  const detectedMime = typeof overrideMime === 'string' && overrideMime.startsWith('image/')
    ? overrideMime
    : declaredMime;
  return { buffer, detectedMime, mimeType: detectedMime };
}

/**
 * Generate stable hash for image deduplication
 * Uses first 16 bytes of content for quick comparison
 */
export function hashImageContent(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 16);
}

/**
 * Re-compress image for sharing (more aggressive than upload compression)
 * Target: 200KB for shared assets
 * Falls back to original if re-compression fails
 */
export async function recompressForShare(buffer, mimeType) {
  // Skip if already small enough
  if (buffer.byteLength <= LIMITS.SHARE_ASSET_BYTES) {
    return { buffer, mimeType, recompressed: false };
  }

  try {
    // Try using sharp if available for server-side compression
    const sharp = await import('sharp').catch(() => null);

    if (sharp) {
      const image = sharp.default(buffer);
      const metadata = await image.metadata();

      // Calculate target dimensions (max 1200px)
      const maxDim = 1200;
      const scale = Math.min(maxDim / metadata.width, maxDim / metadata.height, 1);
      const targetWidth = Math.round(metadata.width * scale);
      const targetHeight = Math.round(metadata.height * scale);

      // Aggressive WebP compression for sharing
      const compressed = await image
        .resize(targetWidth, targetHeight, { fit: 'inside' })
        .webp({ quality: 60, effort: 6 })
        .toBuffer();

      if (compressed.byteLength <= LIMITS.SHARE_ASSET_BYTES) {
        return {
          buffer: compressed,
          mimeType: 'image/webp',
          recompressed: true,
          originalSize: buffer.byteLength,
          newSize: compressed.byteLength,
          savings: Math.round((1 - compressed.byteLength / buffer.byteLength) * 100)
        };
      }
    }

    // If sharp not available or compression didn't help enough, check size
    if (buffer.byteLength > LIMITS.MAX_ASSET_BYTES) {
      throw new Error(`Image too large for sharing (${Math.round(buffer.byteLength / 1024)}KB)`);
    }

    return { buffer, mimeType, recompressed: false };
  } catch (error) {
    console.warn('Re-compression failed, using original:', error.message);
    if (buffer.byteLength > LIMITS.MAX_ASSET_BYTES) {
      throw error; // Re-throw if too large
    }
    return { buffer, mimeType, recompressed: false };
  }
}

export function generateShareSlug() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const tail = crypto.randomBytes(2).toString('hex');
  return `${adjective}${noun}${tail}`;
}

// Promisified scrypt so password hashing/verification never blocks the
// single-threaded Lambda event loop (scryptSync stalls every concurrent
// request on the same instance until it returns).
function scryptAsync(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashSharePassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return {
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
  };
}

export async function verifySharePassword(password, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const stored = Buffer.from(hashHex, 'hex');
  // Corrupt hex decodes to a short/empty buffer; comparing zero-length keys
  // would make every password "valid", so refuse instead.
  if (salt.length < 8 || stored.length < 16) return false;
  // scrypt always returns exactly `stored.length` bytes, so timingSafeEqual
  // (which throws on length mismatch) is safe here.
  const derived = await scryptAsync(password, salt, stored.length);
  return crypto.timingSafeEqual(derived, stored);
}
