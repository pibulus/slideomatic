
// ═══════════════════════════════════════════════════════════════════════════
// Netlify Functions Shared Utilities
// ═══════════════════════════════════════════════════════════════════════════

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

/**
 * Generate stable hash for image deduplication
 * Uses first 16 bytes of content for quick comparison
 */
export function hashImageContent(buffer) {
  const crypto = require('crypto');
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
