import { connectLambda, getStore } from '@netlify/blobs';
import {
  STORE_NAMES,
  LIMITS,
  BASE_HEADERS,
  corsHeaders,
  createAssetId,
  buildAssetUrl,
  decodeDataUrl,
  hashImageContent,
  recompressForShare
} from './utils/common.js';

export async function handler(event) {
  connectLambda(event);

  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: corsHeaders(event.headers),
      };
    }

    if (event.httpMethod === 'POST') {
      return await handlePost(event);
    }

    if (event.httpMethod === 'GET') {
      return await handleGet(event);
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

async function handlePost(event) {
  if (!event.body) {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (error) {
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

  const { assetIds, stats } = await externalizeInlineAssets(slidesClone, event);
  if (assetIds.length) {
    shareRecord.assets = assetIds;
  }

  const serialized = JSON.stringify(shareRecord);
  const bytes = Buffer.byteLength(serialized, 'utf8');

  if (bytes > LIMITS.MAX_DECK_BYTES) {
    return {
      statusCode: 413,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: `Deck is too large to share (max ${Math.round(LIMITS.MAX_DECK_BYTES / 1024)}KB)` }),
    };
  }

  const shareId = createShareId();
  const store = getStore(STORE_NAMES.SHARES);
  await store.set(shareId, serialized, {
    metadata: {
      bytes,
      createdAt: Date.now(),
    },
  });

  return {
    statusCode: 200,
    headers: BASE_HEADERS,
    body: JSON.stringify({
      id: shareId,
      bytes,
      shareUrl: buildShareUrl(event, shareId),
      optimization: stats,
    }),
  };
}

async function handleGet(event) {
  const id = (event.queryStringParameters?.id || '').trim();
  if (!id) {
    return {
      statusCode: 400,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Missing share id' }),
    };
  }

  const store = getStore(STORE_NAMES.SHARES);
  const record = await store.get(id, { type: 'json' });

  if (!record) {
    return {
      statusCode: 404,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Share not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: BASE_HEADERS,
    body: JSON.stringify(record),
  };
}

function createShareId() {
  const random = Math.random().toString(36).slice(2, 8);
  const timestamp = Date.now().toString(36);
  return `${timestamp}-${random}`;
}

function buildShareUrl(event, shareId) {
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host;
  const protocol = event.headers?.['x-forwarded-proto'] || 'https';

  if (!host) return null;

  return `${protocol}://${host}/deck.html?share=${shareId}`;
}

async function externalizeInlineAssets(slides, event) {
  if (!Array.isArray(slides) || slides.length === 0) {
    return { assetIds: [], stats: null };
  }

  const assetStore = getStore(STORE_NAMES.ASSETS);
  const collected = [];
  const imageRefs = gatherImageRefs(slides);
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

    // Process inline data URLs
    if (typeof image.src === 'string' && image.src.startsWith('data:')) {
      try {
        const { buffer, mimeType } = decodeDataUrl(image.src);

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

          // Extend expiry to keep popular assets alive longer
          await extendAssetExpiry(assetStore, existingAsset.assetId);

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
          console.log(`Re-compressed ${image.originalFilename}: ${originalSize}B → ${newSize}B (${savings}% savings)`);
          totalSavings += (originalSize - newSize);
          recompressCount++;
        }

        totalFinalBytes += finalBuffer.byteLength;

        // Final size check
        if (finalBuffer.byteLength > LIMITS.MAX_ASSET_BYTES) {
          console.warn(`Image ${image.originalFilename} still too large (${Math.round(finalBuffer.byteLength / 1024)}KB) after compression`);
          image.src = '';
          image.alt = `(Image too large to share: ${Math.round(finalBuffer.byteLength / 1024)}KB) ${image.alt || ''}`;
          continue;
        }

        const assetId = createAssetId(image.originalFilename || 'shared-image');

        // Convert Node Buffer to ArrayBuffer for @netlify/blobs
        const arrayBuffer = finalBuffer.buffer.slice(
          finalBuffer.byteOffset,
          finalBuffer.byteOffset + finalBuffer.byteLength
        );

        await assetStore.set(assetId, arrayBuffer, {
          metadata: {
            bytes: finalBuffer.byteLength,
            mimeType: finalMimeType,
            source: 'share-inline',
            recompressed,
            originalBytes: recompressed ? originalSize : finalBuffer.byteLength,
            hash,
            createdAt: Date.now(),
            expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
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
        dedupeMap.set(hash, assetId);

      } catch (e) {
        console.warn('Failed to externalize asset', e);
        image.src = '';
        image.alt = `(Image failed to share) ${image.alt || ''}`;
      }
      continue;
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

  return { assetIds: collected, stats };
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
async function extendAssetExpiry(assetStore, assetId) {
  try {
    const asset = await assetStore.get(assetId, { type: 'arrayBuffer' });
    if (!asset) return;

    const metadata = await assetStore.getMetadata(assetId);
    if (!metadata) return;

    // Extend expiry by 30 days from now
    const newExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000);

    await assetStore.set(assetId, asset, {
      metadata: {
        ...metadata,
        expiresAt: newExpiry,
        lastReused: Date.now(),
        reuseCount: (metadata.reuseCount || 0) + 1
      }
    });

    console.log(`Extended expiry for ${assetId} (reuse count: ${metadata.reuseCount || 0})`);
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
