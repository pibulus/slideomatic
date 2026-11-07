
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
    'Access-Control-Allow-Headers': 'content-type, authorization, x-passport-token, x-share-passphrase',
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Passport-Token',
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

const PROD_SAFE_HOST_PATTERN =
  /^(?:slideomatic\.app|www\.slideomatic\.app|(?:[a-z0-9-]+--)?slideomatic\.netlify\.app)$/i;
const LOCAL_SAFE_HOST_PATTERN =
  /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

export const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export function normalizeAllowedImageMime(rawMime = '') {
  if (typeof rawMime !== 'string') return null;
  const cleaned = rawMime.split(';')[0].trim().toLowerCase();
  const normalized = cleaned === 'image/jpg' ? 'image/jpeg' : cleaned;
  return ALLOWED_IMAGE_MIMES.has(normalized) ? normalized : null;
}

export function sniffImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 8) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.byteLength >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // AVIF: ....ftyp(avif|avis|mif1)
  if (
    buffer.byteLength >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp'
  ) {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') {
      return 'image/avif';
    }
  }
  return null;
}

export function resolveSafeHostAndProtocol(event) {
  // Prefer the platform-populated Host header over caller-spoofable X-Forwarded-Host
  const rawHost =
    event?.headers?.host ||
    event?.headers?.Host ||
    event?.headers?.['x-forwarded-host'] ||
    '';
  const firstHop = String(rawHost).split(',')[0].trim();
  if (!firstHop) {
    return { host: null, protocol: 'https' };
  }
  const isLocal = LOCAL_SAFE_HOST_PATTERN.test(firstHop);
  if (isLocal) {
    if (process.env.NETLIFY_DEV !== 'true') {
      return { host: null, protocol: 'https' };
    }
    const rawProto = String(event?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const protocol = rawProto === 'http' ? 'http' : 'https';
    return { host: firstHop, protocol };
  }
  if (!PROD_SAFE_HOST_PATTERN.test(firstHop)) {
    return { host: null, protocol: 'https' };
  }
  return { host: firstHop, protocol: 'https' };
}

export function buildAssetUrl(event, assetId, options = {}) {
  const { host, protocol } = resolveSafeHostAndProtocol(event);

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
  const [, declaredMime = '', base64Data] = match;
  const allowedDeclared = normalizeAllowedImageMime(declaredMime);
  const allowedOverride = normalizeAllowedImageMime(overrideMime);
  const candidateMime = allowedOverride || allowedDeclared;
  if (!candidateMime) {
    throw new Error(`Unsupported image MIME type: ${declaredMime || 'unknown'}`);
  }
  const buffer = Buffer.from(base64Data, 'base64');
  const sniffedMime = sniffImageMime(buffer);
  if (!sniffedMime) {
    throw new Error('Invalid or non-raster image payload');
  }
  return { buffer, detectedMime: sniffedMime, mimeType: sniffedMime };
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
  const safeMime = sniffImageMime(buffer) || normalizeAllowedImageMime(mimeType);
  if (!safeMime) {
    throw new Error('Refusing to store non-raster asset');
  }

  // Skip if already small enough
  if (buffer.byteLength <= LIMITS.SHARE_ASSET_BYTES) {
    return { buffer, mimeType: safeMime, recompressed: false };
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

    return { buffer, mimeType: safeMime, recompressed: false };
  } catch (error) {
    console.warn('Re-compression failed, using original:', error.message);
    if (buffer.byteLength > LIMITS.MAX_ASSET_BYTES) {
      throw error; // Re-throw if too large
    }
    return { buffer, mimeType: safeMime, recompressed: false };
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
  if (typeof password !== 'string' || !password || password.length > 256) {
    throw new Error('Invalid password length');
  }
  const normalized = password.normalize('NFC');
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(normalized, salt, 32);
  return {
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
  };
}

export async function verifySharePassword(password, saltHex, hashHex) {
  if (typeof password !== 'string' || !password || password.length > 256) return false;
  if (!saltHex || !hashHex) return false;
  const normalized = password.normalize('NFC');
  const salt = Buffer.from(saltHex, 'hex');
  const stored = Buffer.from(hashHex, 'hex');
  // Corrupt hex decodes to a short/empty buffer; comparing zero-length keys
  // would make every password "valid", so refuse instead.
  if (salt.length < 8 || stored.length < 16) return false;
  // scrypt always returns exactly `stored.length` bytes, so timingSafeEqual
  // (which throws on length mismatch) is safe here.
  const derived = await scryptAsync(normalized, salt, stored.length);
  return crypto.timingSafeEqual(derived, stored);
}

/**
 * Validate and normalize a custom share slug ([a-z0-9-]{3,40}, no leading/trailing/double hyphens).
 * Returns normalized slug or null if invalid.
 */
export function sanitizeCustomSlug(rawSlug) {
  if (typeof rawSlug !== 'string') return null;
  const stripped = rawSlug
    .trim()
    .replace(/^(?:https?:\/\/[^/]+)?\/?(?:s\/)?/i, '');
  const cleaned = stripped
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/(^-|-$)/g, '');
  if (cleaned.length < 3 || cleaned.length > 40) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Validate a relative same-origin image path (e.g. "images/risograph.webp" or "/images/foo.png").
 * Rejects URLs with schemes, protocol-relative paths, parent traversal (..), backslashes, or non-image extensions.
 * Returns normalized path without leading slash, or null if not a safe relative image path.
 */
export function isRelativeAssetPath(src) {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (/^(?:data:|blob:|https?:|javascript:|file:|mailto:|\/\/)/i.test(trimmed)) return null;
  if (trimmed.startsWith('/.netlify/') || trimmed.startsWith('.netlify/')) return null;
  if (trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('\0') || trimmed.includes('?') || trimmed.includes('#')) {
    return null;
  }
  const normalized = trimmed.replace(/^\/+/, '');
  if (!/^[a-zA-Z0-9._/-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(normalized)) {
    return null;
  }
  return normalized;
}

export function inferMimeFromPath(relPath = '') {
  const lower = String(relPath).toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.avif')) return 'image/avif';
  return 'application/octet-stream';
}

/**
 * Verify a SoftStack Passport HS256 JWT token ({ sub, stamps, tier, exp }).
 * Returns claims object or null if invalid/expired/unconfigured.
 */
export function verifyPassportToken(token, secret = process.env.SOFTSTACK_PASSPORT_SECRET) {
  if (typeof token !== 'string' || !token.trim() || typeof secret !== 'string' || !secret.trim()) {
    return null;
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256') return null;

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const providedSig = Buffer.from(sigB64, 'base64url');
    if (expectedSig.length !== providedSig.length) return null;
    if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload || typeof payload.sub !== 'string' || !payload.sub.trim()) return null;

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    const expMs = payload.exp < 1e12 ? payload.exp * 1000 : payload.exp;
    if (expMs <= Date.now()) return null;

    return {
      sub: payload.sub.trim(),
      tier: typeof payload.tier === 'string' ? payload.tier : 'free',
      stamps: Array.isArray(payload.stamps) ? payload.stamps.filter((s) => typeof s === 'string') : [],
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function extractPassportToken(event, payload = null) {
  const headers = event?.headers || {};
  const authHeader = headers.authorization || headers.Authorization || '';
  if (typeof authHeader === 'string' && /^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }
  const customHeader = headers['x-passport-token'] || headers['X-Passport-Token'] || '';
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  if (payload && typeof payload.passportToken === 'string' && payload.passportToken.trim()) {
    return payload.passportToken.trim();
  }
  return '';
}

function stripMarkdownInline(text = '') {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract safe public OpenGraph metadata for a shared deck.
 * Never leaks title, description, image, or slide count when passwordProtected is true.
 */
export function summarizeDeckMeta(id, record) {
  const passwordProtected = Boolean(record?.meta?.passwordProtected && record?.meta?.passwordHash);
  if (passwordProtected) {
    return {
      id,
      passwordProtected: true,
      title: 'Locked Deck',
      description: 'Passphrase required to view this deck on Slide-o-Matic.',
      image: null,
      imageAlt: 'Locked Slide-o-Matic deck',
      slideCount: null,
      themeAccent: null,
      passportStamped: false,
    };
  }

  const slides = Array.isArray(record?.slides) ? record.slides : [];
  const firstSlide = slides[0] || {};
  const rawTitle =
    firstSlide.title ||
    firstSlide.headline ||
    firstSlide.quote ||
    record?.meta?.title ||
    'Slide-o-Matic Deck';
  const cleanTitle = stripMarkdownInline(rawTitle).slice(0, 90) || 'Slide-o-Matic Deck';

  const rawDesc =
    firstSlide.subtitle ||
    firstSlide.subhead ||
    firstSlide.tagline ||
    firstSlide.text ||
    firstSlide.caption ||
    (Array.isArray(firstSlide.bullets) && firstSlide.bullets[0]) ||
    '';
  const cleanDesc = stripMarkdownInline(rawDesc).slice(0, 160);
  const slideCount = slides.length;
  const fallbackDesc = slideCount > 0
    ? `${slideCount}-slide deck built with Slide-o-Matic.`
    : 'A presentation deck built with Slide-o-Matic.';

  let previewImage = null;
  let previewAlt = `${cleanTitle} — Slide-o-Matic deck preview`;
  for (const slide of slides) {
    if (!slide || typeof slide !== 'object') continue;
    const candidate =
      slide.image ||
      (Array.isArray(slide.media) && slide.media.find((m) => m?.image?.src)?.image) ||
      (Array.isArray(slide.items) && slide.items.find((i) => i?.image?.src)?.image) ||
      slide.left?.image ||
      slide.right?.image ||
      (Array.isArray(slide.pillars) && slide.pillars.find((p) => p?.image?.src)?.image);
    if (candidate && typeof candidate.src === 'string' && candidate.src && !candidate.src.startsWith('data:')) {
      previewImage = candidate.src;
      if (candidate.alt && typeof candidate.alt === 'string') {
        previewAlt = stripMarkdownInline(candidate.alt).slice(0, 120) || previewAlt;
      }
      break;
    }
  }

  const themeAccent =
    record?.theme?.accentColor ||
    record?.theme?.bgColor ||
    null;

  return {
    id,
    passwordProtected: false,
    title: cleanTitle,
    description: cleanDesc || fallbackDesc,
    image: previewImage,
    imageAlt: previewAlt,
    slideCount,
    themeAccent,
    passportStamped: Boolean(record?.meta?.createdBy),
  };
}
