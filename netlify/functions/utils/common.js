
// ═══════════════════════════════════════════════════════════════════════════
// Netlify Functions Shared Utilities
// ═══════════════════════════════════════════════════════════════════════════

export const STORE_NAMES = {
  ASSETS: 'deck-assets',
  SHARES: 'shared-decks',
};

export const LIMITS = {
  MAX_DECK_BYTES: 400 * 1024,    // 400KB ceiling for payloads
  MAX_ASSET_BYTES: 512 * 1024,   // 512KB hard stop per asset
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

export function corsHeaders(headers = {}, methods = 'GET,POST,OPTIONS') {
  const origin = headers.origin || headers.Origin || '*';
  return {
    ...BASE_HEADERS,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'content-type',
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

export function buildAssetUrl(event, assetId) {
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host;
  const protocol = event.headers?.['x-forwarded-proto'] || 'https';
  if (!host) return `/.netlify/functions/asset?id=${encodeURIComponent(assetId)}`;
  return `${protocol}://${host}/.netlify/functions/asset?id=${encodeURIComponent(assetId)}`;
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
