import crypto from 'node:crypto';
import { connectLambda as defaultConnectLambda, getStore as defaultGetStore } from '@netlify/blobs';
import {
  STORE_NAMES,
  LIMITS,
  TTL,
  BASE_HEADERS,
  corsHeaders,
  createAssetId,
  buildAssetUrl,
  resolveSafeHostAndProtocol,
  decodeDataUrl,
  normalizeAllowedImageMime,
  sniffImageMime,
  hashImageContent,
  recompressForShare,
  generateShareSlug,
  hashSharePassword,
  verifySharePassword,
  sanitizeCustomSlug,
  isRelativeAssetPath,
  inferMimeFromPath,
  verifyPassportToken,
  extractPassportToken,
  summarizeDeckMeta
} from './utils/common.js';

const MAX_ASSETS_PER_SHARE = 60;
const MAX_PASSWORD_FAILURES = 10;
const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000;
const SHARE_CREATE_DAILY_LIMIT = Number(process.env.SHARE_DAILY_LIMIT_PER_IP) || 60;

// In-memory rate-limit maps (augmented by spend-budgets store when available)
const passwordFailureTracker = new Map();
const shareCreationTracker = new Map();

function resolveClientIp(event) {
  const h = event?.headers || {};
  return (
    h['x-nf-client-connection-ip'] ||
    h['X-Nf-Client-Connection-Ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  );
}

function checkShareRateLimit(ip, now = Date.now()) {
  if (!ip || ip === 'unknown') return true;
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `${day}:${ip}`;
  const count = (shareCreationTracker.get(key) || 0) + 1;
  shareCreationTracker.set(key, count);
  return count <= SHARE_CREATE_DAILY_LIMIT;
}

function isPasswordRateLimited(shareId, ip, now = Date.now()) {
  const key = `${shareId}:${ip}`;
  const entry = passwordFailureTracker.get(key);
  if (!entry) return false;
  if (now - entry.firstAt > PASSWORD_LOCKOUT_MS) {
    passwordFailureTracker.delete(key);
    return false;
  }
  return entry.count >= MAX_PASSWORD_FAILURES;
}

function recordPasswordFailure(shareId, ip, now = Date.now()) {
  const key = `${shareId}:${ip}`;
  const entry = passwordFailureTracker.get(key);
  if (!entry || now - entry.firstAt > PASSWORD_LOCKOUT_MS) {
    passwordFailureTracker.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function clearPasswordFailures(shareId, ip) {
  passwordFailureTracker.delete(`${shareId}:${ip}`);
}

export async function handler(event, deps = {}) {
  const connectLambdaFn = deps.connectLambda || defaultConnectLambda;
  try {
    connectLambdaFn(event);
  } catch {
    // Allow running in local/unit test environments without Lambda context
  }

  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: corsHeaders(event.headers),
      };
    }

    if (event.httpMethod === 'POST') {
      return await handlePost(event, deps);
    }

    if (event.httpMethod === 'GET') {
      return await handleGet(event, deps);
    }

    return {
      statusCode: 405,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Share function failed', error);
    return {
      statusCode: 500,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Internal error creating share link' }),
    };
  }
}

async function handlePost(event, deps = {}) {
  const getStoreFn = deps.getStore || defaultGetStore;
  if (!event.body) {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  const clientIp = resolveClientIp(event);
  if (!checkShareRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Daily share creation limit reached. Try again tomorrow.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON payload' }),
    };
  }

  if (!Array.isArray(payload.slides)) {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Missing slides array' }),
    };
  }

  const rawPassportToken = extractPassportToken(event, payload);
  const passportClaims = rawPassportToken
    ? verifyPassportToken(rawPassportToken, deps.passportSecret ?? process.env.SOFTSTACK_PASSPORT_SECRET)
    : null;
  const hasPassportPrivilege = Boolean(
    passportClaims &&
    (passportClaims.tier === 'supporter' ||
      passportClaims.stamps.includes('slideomatic') ||
      passportClaims.stamps.includes('*'))
  );

  const rawSlugInput = payload.customSlug ?? payload.meta?.customSlug ?? '';
  if (rawSlugInput !== '' && typeof rawSlugInput !== 'string') {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({
        error: 'Custom link must be 3–40 letters, numbers, or single hyphens',
        invalidSlug: true,
      }),
    };
  }
  const rawCustomSlug = typeof rawSlugInput === 'string' ? rawSlugInput.trim() : '';
  let customSlug = null;
  if (rawCustomSlug) {
    customSlug = sanitizeCustomSlug(rawCustomSlug);
    if (!customSlug) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({
          error: 'Custom link must be 3–40 letters, numbers, or single hyphens',
          invalidSlug: true,
        }),
      };
    }
    if (!hasPassportPrivilege) {
      return {
        statusCode: 403,
        headers: BASE_HEADERS,
        body: JSON.stringify({
          error: 'Custom links require a SoftStack Passport',
          requiresPassport: true,
        }),
      };
    }
  }

  const store = getStoreFn(STORE_NAMES.SHARES);
  if (customSlug) {
    const existing = await store.get(customSlug);
    if (existing) {
      return {
        statusCode: 409,
        headers: BASE_HEADERS,
        body: JSON.stringify({
          error: 'That custom link is already taken',
          slugTaken: true,
        }),
      };
    }
  }

  const slidesClone = JSON.parse(JSON.stringify(payload.slides));
  const shareRecord = {
    version: 1,
    slides: slidesClone,
    theme: payload.theme ? JSON.parse(JSON.stringify(payload.theme)) : null,
    meta: {
      title: payload.meta?.title ?? 'Untitled Deck',
      createdAt: payload.meta?.createdAt ?? Date.now(),
    },
  };

  if (hasPassportPrivilege) {
    shareRecord.meta.createdBy = passportClaims.sub;
    shareRecord.meta.permanent = true;
  }

  const rawPasswordInput = payload.meta?.password ?? payload.password ?? '';
  if (rawPasswordInput !== '' && typeof rawPasswordInput !== 'string') {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Invalid passphrase format' }),
    };
  }
  const passphrase = typeof rawPasswordInput === 'string' ? rawPasswordInput.trim() : '';
  if (passphrase.length > 256) {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Passphrase must be 256 characters or fewer' }),
    };
  }
  if (passphrase) {
    const hashed = await hashSharePassword(passphrase);
    shareRecord.meta.passwordProtected = true;
    shareRecord.meta.passwordHash = hashed.hash;
    shareRecord.meta.passwordSalt = hashed.salt;
  } else {
    shareRecord.meta.passwordProtected = false;
  }

  const { assetIds, createdAssetIds, stats } = await externalizeInlineAssets(slidesClone, event, {
    ...deps,
    permanent: hasPassportPrivilege,
  });
  if (assetIds.length) {
    shareRecord.assets = assetIds;
  }

  const serialized = JSON.stringify(shareRecord);
  const bytes = Buffer.byteLength(serialized, 'utf8');

  if (bytes > LIMITS.MAX_DECK_BYTES) {
    if (Array.isArray(createdAssetIds) && createdAssetIds.length) {
      try {
        const assetStore = getStoreFn(STORE_NAMES.ASSETS);
        if (typeof assetStore.delete === 'function') {
          await Promise.all(createdAssetIds.map((aid) => assetStore.delete(aid)));
        }
      } catch (cleanupErr) {
        console.warn('Failed to roll back assets after 413:', cleanupErr);
      }
    }
    return {
      statusCode: 413,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: `Deck is too large to share (max ${Math.round(LIMITS.MAX_DECK_BYTES / 1024)}KB)` }),
    };
  }

  const shareId = customSlug || await createUniqueShareId(store);
  const now = Date.now();
  await store.set(shareId, serialized, {
    metadata: {
      bytes,
      createdAt: now,
      permanent: hasPassportPrivilege,
      createdBy: passportClaims?.sub || null,
      // Without this the daily cleanup treats the share as legacy and deletes
      // it on its next run. Viewing the share refreshes the expiry.
      // Passport-authenticated shares never expire.
      expiresAt: hasPassportPrivilege ? null : now + TTL.SHARE_MS,
    },
  });

  return {
    statusCode: 200,
    headers: BASE_HEADERS,
    body: JSON.stringify({
      id: shareId,
      bytes,
      shareUrl: buildShareUrl(event, shareId),
      permanent: hasPassportPrivilege,
      passwordProtected: Boolean(shareRecord.meta.passwordProtected),
      optimization: stats,
    }),
  };
}

async function handleGet(event, deps = {}) {
  const getStoreFn = deps.getStore || defaultGetStore;
  const id = (event.queryStringParameters?.id || '').trim();
  if (!id) {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Missing share id' }),
    };
  }

  const store = getStoreFn(STORE_NAMES.SHARES);
  const result = await store.getWithMetadata(id, { type: 'json' });
  const record = result?.data;

  if (!record) {
    return {
      statusCode: 404,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Share not found' }),
    };
  }

  const wantMetaOnly =
    event.queryStringParameters?.meta === '1' ||
    event.queryStringParameters?.meta === 'true';

  if (wantMetaOnly) {
    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify(summarizeDeckMeta(id, record)),
    };
  }

  const passwordProtected = Boolean(record?.meta?.passwordProtected && record.meta.passwordHash);
  if (passwordProtected) {
    const clientIp = resolveClientIp(event);
    if (isPasswordRateLimited(id, clientIp)) {
      return {
        statusCode: 429,
        headers: BASE_HEADERS,
        body: JSON.stringify({
          error: 'Too many passphrase attempts. Try again in 15 minutes.',
          requiresPassword: true,
        }),
      };
    }

    const headerPass =
      event.headers?.['x-share-passphrase'] ||
      event.headers?.['X-Share-Passphrase'] ||
      '';
    const queryPass = event.queryStringParameters?.password || '';
    const password = String(headerPass || queryPass).trim();

    if (!password) {
      return {
        statusCode: 401,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Password required', requiresPassword: true }),
      };
    }

    const valid = await verifySharePassword(password, record.meta.passwordSalt, record.meta.passwordHash);
    if (!valid) {
      recordPasswordFailure(id, clientIp);
      return {
        statusCode: 401,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Invalid password', requiresPassword: true, invalidPassword: true }),
      };
    }
    clearPasswordFailures(id, clientIp);
  }

  await refreshShareExpiry(store, id, record, result?.metadata, getStoreFn);

  const sanitized = {
    ...record,
    meta: {
      ...record.meta,
      passwordProtected,
    },
  };

  if (sanitized.meta) {
    delete sanitized.meta.passwordHash;
    delete sanitized.meta.passwordSalt;
  }

  return {
    statusCode: 200,
    headers: BASE_HEADERS,
    body: JSON.stringify(sanitized),
  };
}

// Keep actively-viewed shares (and their externalized images) alive: once the
// remaining lifetime dips below half the TTL, push expiry back out. Guarded so
// each view costs at most one blob rewrite per half-TTL, not one per view.
async function refreshShareExpiry(store, id, record, metadata = {}, getStoreFn = defaultGetStore) {
  try {
    if (metadata?.permanent) return;
    const now = Date.now();
    const expiresAt = Number(metadata?.expiresAt) || 0;
    if (expiresAt && expiresAt - now > TTL.SHARE_MS / 2) return;

    await store.set(id, JSON.stringify(record), {
      metadata: {
        ...metadata,
        createdAt: Number(metadata?.createdAt) || now,
        expiresAt: now + TTL.SHARE_MS,
      },
    });

    if (Array.isArray(record.assets) && record.assets.length) {
      const assetStore = getStoreFn(STORE_NAMES.ASSETS);
      await Promise.all(record.assets.map((assetId) => extendAssetExpiry(assetStore, assetId)));
    }
  } catch (error) {
    // Expiry refresh is best-effort; never block loading the deck over it.
    console.warn(`Failed to refresh expiry for share ${id}:`, error);
  }
}

async function createUniqueShareId(store, attempt = 0) {
  const slug = generateShareSlug();
  const existing = await store.get(slug);
  if (!existing) return slug;
  if (attempt >= 5) {
    const fallback = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    const fallbackExisting = await store.get(fallback);
    if (!fallbackExisting) return fallback;
    for (let i = 0; i < 5; i += 1) {
      const lastResort = `${slug}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      if (!(await store.get(lastResort))) return lastResort;
    }
    throw new Error('Could not allocate unique share slug');
  }
  return createUniqueShareId(store, attempt + 1);
}

function buildShareUrl(event, shareId) {
  const { host, protocol } = resolveSafeHostAndProtocol(event);

  if (!host) return `/s/${shareId}`;

  return `${protocol}://${host}/s/${shareId}`;
}

async function resolveRelativeAsset(relPath, event, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') return null;
  const { host, protocol } = resolveSafeHostAndProtocol(event);
  if (!host) return null;

  const url = `${protocol}://${host}/${relPath}`;
  const response = await fetchFn(url, { redirect: 'error' });
  if (!response || !response.ok) {
    return null;
  }

  const rawContentType = (response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (rawContentType && rawContentType !== 'application/octet-stream' && !normalizeAllowedImageMime(rawContentType)) {
    return null;
  }

  const arrayBuf = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (!buffer.byteLength || buffer.byteLength > LIMITS.MAX_ASSET_BYTES) {
    return null;
  }

  const sniffedMime = sniffImageMime(buffer);
  const declaredMime = normalizeAllowedImageMime(rawContentType) || normalizeAllowedImageMime(inferMimeFromPath(relPath));
  const mimeType = sniffedMime || declaredMime;
  if (!mimeType) {
    return null;
  }

  return {
    buffer,
    mimeType,
    filename: relPath.split('/').pop() || 'relative-image',
    source: 'share-relative',
  };
}

async function externalizeInlineAssets(slides, event, deps = {}) {
  if (!Array.isArray(slides) || slides.length === 0) {
    return { assetIds: [], createdAssetIds: [], stats: null };
  }

  const getStoreFn = deps.getStore || defaultGetStore;
  const fetchFn = deps.fetch || globalThis.fetch;
  const isPermanent = Boolean(deps.permanent);
  const assetStore = getStoreFn(STORE_NAMES.ASSETS);
  const collected = [];
  const createdAssetIds = [];
  const imageRefs = gatherImageRefs(slides).slice(0, MAX_ASSETS_PER_SHARE);
  const dedupeMap = new Map(); // hash -> assetId (local to this share)
  const globalAssetMap = await buildGlobalAssetHashMap(assetStore);
  let totalSavings = 0;
  let recompressCount = 0;
  let dedupeCount = 0;
  let globalDedupeCount = 0;
  let totalOriginalBytes = 0;
  let totalFinalBytes = 0;

  for (const image of imageRefs) {
    if (!image || typeof image !== 'object') continue;

    // Already externalized - just track it
    if (image.storage === 'netlify-asset' && typeof image.assetId === 'string') {
      collected.push(image.assetId);
      continue;
    }

    if (typeof image.src !== 'string' || !image.src.trim()) continue;

    let resolved = null;
    const isDataUrl = image.src.startsWith('data:');
    const relPath = !isDataUrl ? isRelativeAssetPath(image.src) : null;

    if (isDataUrl) {
      try {
        const { buffer, mimeType } = decodeDataUrl(image.src);
        resolved = {
          buffer,
          mimeType,
          filename: image.originalFilename || 'shared-image',
          source: 'share-inline',
        };
      } catch (e) {
        console.warn('Failed to decode inline data URL asset', e);
        image.src = '';
        image.alt = `(Image failed to share) ${image.alt || ''}`;
        continue;
      }
    } else if (relPath) {
      try {
        resolved = await resolveRelativeAsset(relPath, event, fetchFn);
      } catch (e) {
        console.warn(`Failed to fetch relative asset ${relPath}, leaving path untouched:`, e?.message || e);
        resolved = null;
      }
      // On 404 or fetch failure, leave relative image.src untouched rather than blanking it
      if (!resolved) continue;
    } else {
      continue;
    }

    try {
      const { buffer, mimeType, filename, source } = resolved;

      // Check deduplication: local first (this share)
      const hash = hashImageContent(buffer);
      if (dedupeMap.has(hash)) {
        const existingAssetId = dedupeMap.get(hash);
        image.src = buildAssetUrl(event, existingAssetId, {
          optimize: true,
          width: 1600,
          quality: 75,
          format: 'webp'
        });
        image.assetId = existingAssetId;
        image.storage = 'netlify-asset';
        collected.push(existingAssetId);
        console.log(`Local dedup: ${hash}`);
        dedupeCount++;
        totalSavings += buffer.byteLength;
        continue;
      }

      // Check global deduplication (across all shares)
      if (globalAssetMap.has(hash)) {
        const existingAsset = globalAssetMap.get(hash);
        image.src = buildAssetUrl(event, existingAsset.assetId, {
          optimize: true,
          width: 1600,
          quality: 75,
          format: 'webp'
        });
        image.assetId = existingAsset.assetId;
        image.storage = 'netlify-asset';
        collected.push(existingAsset.assetId);

        // Extend expiry to keep popular assets alive longer
        await extendAssetExpiry(assetStore, existingAsset.assetId, { permanent: isPermanent });

        console.log(`Global dedup: reused ${existingAsset.assetId} (hash: ${hash}, saved ${Math.round(buffer.byteLength / 1024)}KB)`);
        globalDedupeCount++;
        dedupeCount++; // Also count in total dedup
        totalSavings += buffer.byteLength;
        dedupeMap.set(hash, existingAsset.assetId); // Cache for this share
        continue;
      }

      totalOriginalBytes += buffer.byteLength;

      // Re-compress for sharing (more aggressive)
      const {
        buffer: finalBuffer,
        mimeType: finalMimeType,
        recompressed,
        originalSize,
        newSize,
        savings
      } = await recompressForShare(buffer, mimeType);

      if (recompressed) {
        console.log(`Re-compressed ${filename}: ${originalSize}B → ${newSize}B (${savings}% savings)`);
        totalSavings += (originalSize - newSize);
        recompressCount++;
      }

      totalFinalBytes += finalBuffer.byteLength;

      // Final size check
      if (finalBuffer.byteLength > LIMITS.MAX_ASSET_BYTES) {
        console.warn(`Image ${filename} still too large (${Math.round(finalBuffer.byteLength / 1024)}KB) after compression`);
        if (isDataUrl) {
          image.src = '';
          image.alt = `(Image too large to share: ${Math.round(finalBuffer.byteLength / 1024)}KB) ${image.alt || ''}`;
        }
        continue;
      }

      const assetId = createAssetId(filename);

      // Convert Node Buffer to ArrayBuffer for @netlify/blobs
      const arrayBuffer = finalBuffer.buffer.slice(
        finalBuffer.byteOffset,
        finalBuffer.byteOffset + finalBuffer.byteLength
      );

      const now = Date.now();
      await assetStore.set(assetId, arrayBuffer, {
        metadata: {
          bytes: finalBuffer.byteLength,
          mimeType: finalMimeType,
          source,
          recompressed,
          originalBytes: recompressed ? originalSize : finalBuffer.byteLength,
          hash,
          permanent: isPermanent,
          createdAt: now,
          expiresAt: isPermanent ? null : now + TTL.ASSET_MS,
        },
      });

      // Use Netlify Image CDN for automatic optimization on delivery
      image.src = buildAssetUrl(event, assetId, {
        optimize: true,
        width: 1600,
        quality: 75,
        format: 'webp'
      });
      image.assetId = assetId;
      image.storage = 'netlify-asset';
      collected.push(assetId);
      createdAssetIds.push(assetId);
      dedupeMap.set(hash, assetId);
    } catch (e) {
      console.warn('Failed to externalize asset', e);
      if (isDataUrl) {
        image.src = '';
        image.alt = `(Image failed to share) ${image.alt || ''}`;
      }
    }
  }

  const stats = {
    imageCount: imageRefs.length,
    deduplicatedCount: dedupeCount,
    globalDeduplicatedCount: globalDedupeCount,
    recompressedCount: recompressCount,
    totalSavingsBytes: totalSavings,
    originalBytes: totalOriginalBytes,
    finalBytes: totalFinalBytes,
    savingsPercent: totalOriginalBytes > 0 ? Math.round((totalSavings / totalOriginalBytes) * 100) : 0
  };

  if (recompressCount > 0 || dedupeCount > 0) {
    console.log(
      `Share optimization: ${recompressCount} re-compressed, ` +
      `${dedupeCount} deduplicated (${globalDedupeCount} global), ` +
      `saved ${Math.round(totalSavings / 1024)}KB (${stats.savingsPercent}%)`
    );
  }

  return { assetIds: collected, createdAssetIds, stats };
}

/**
 * Build a hash map of existing assets for global deduplication
 * Returns Map<hash, {assetId, bytes}>
 */
async function buildGlobalAssetHashMap(assetStore) {
  const map = new Map();

  try {
    const assets = await assetStore.list();

    for (const asset of (assets.blobs || [])) {
      const hash = asset.metadata?.hash;
      if (hash && !map.has(hash)) {
        map.set(hash, {
          assetId: asset.key,
          bytes: asset.metadata?.bytes || 0,
          createdAt: asset.metadata?.createdAt || 0
        });
      }
    }

    console.log(`Built global asset map: ${map.size} unique hashes`);
  } catch (error) {
    console.warn('Failed to build global asset map, continuing without global dedup:', error);
  }

  return map;
}

/**
 * Extend expiry of reused asset to keep it alive longer
 * Popular assets (reused frequently) stay alive indefinitely
 */
async function extendAssetExpiry(assetStore, assetId, options = {}) {
  try {
    const asset = await assetStore.get(assetId, { type: 'arrayBuffer' });
    if (!asset) return;

    // getMetadata returns { etag, metadata } — spreading the wrapper used to
    // nest the real metadata one level down, wiping mimeType/hash/bytes and
    // breaking dedup + content-type on every reuse.
    const wrapper = await assetStore.getMetadata(assetId);
    if (!wrapper) return;
    const meta = wrapper.metadata || {};

    const permanent = Boolean(meta.permanent || options.permanent);
    const newExpiry = Date.now() + TTL.ASSET_MS;

    await assetStore.set(assetId, asset, {
      metadata: {
        ...meta,
        permanent,
        expiresAt: permanent ? null : newExpiry,
        lastReused: Date.now(),
        reuseCount: (meta.reuseCount || 0) + 1
      }
    });

    console.log(`Extended expiry for ${assetId} (reuse count: ${meta.reuseCount || 0})`);
  } catch (error) {
    console.warn(`Failed to extend expiry for ${assetId}:`, error);
  }
}

function gatherImageRefs(slides) {
  const refs = [];
  slides.forEach((slide) => {
    if (!slide || typeof slide !== 'object') return;
    if (slide.image && typeof slide.image === 'object') {
      refs.push(slide.image);
    }
    if (Array.isArray(slide.media)) {
      slide.media.forEach((item) => {
        if (item?.image && typeof item.image === 'object') {
          refs.push(item.image);
        }
      });
    }
    if (Array.isArray(slide.items)) {
      slide.items.forEach((item) => {
        if (item?.image && typeof item.image === 'object') {
          refs.push(item.image);
        }
      });
    }
    if (slide.left?.image && typeof slide.left.image === 'object') {
      refs.push(slide.left.image);
    }
    if (slide.right?.image && typeof slide.right.image === 'object') {
      refs.push(slide.right.image);
    }
    if (Array.isArray(slide.pillars)) {
      slide.pillars.forEach((pillar) => {
        if (pillar?.image && typeof pillar.image === 'object') {
          refs.push(pillar.image);
        }
      });
    }
  });
  return refs;
}
