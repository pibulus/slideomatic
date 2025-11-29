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
  const dedupeMap = new Map(); // hash -> assetId
  let totalSavings = 0;
  let recompressCount = 0;
  let dedupeCount = 0;
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

        // Check deduplication first
        const hash = hashImageContent(buffer);
        if (dedupeMap.has(hash)) {
          const existingAssetId = dedupeMap.get(hash);
          image.src = buildAssetUrl(event, existingAssetId);
          image.assetId = existingAssetId;
          image.storage = 'netlify-asset';
          console.log(`Deduplicated image (hash: ${hash})`);
          dedupeCount++;
          totalSavings += buffer.byteLength; // Saved entire duplicate
          continue; // Skip upload, reuse existing
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
    recompressedCount: recompressCount,
    totalSavingsBytes: totalSavings,
    originalBytes: totalOriginalBytes,
    finalBytes: totalFinalBytes,
    savingsPercent: totalOriginalBytes > 0 ? Math.round((totalSavings / totalOriginalBytes) * 100) : 0
  };

  if (recompressCount > 0 || dedupeCount > 0) {
    console.log(`Share optimization: ${recompressCount} re-compressed, ${dedupeCount} deduplicated, saved ${Math.round(totalSavings / 1024)}KB (${stats.savingsPercent}%)`);
  }

  return { assetIds: collected, stats };
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
