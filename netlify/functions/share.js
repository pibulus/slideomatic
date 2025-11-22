import { connectLambda, getStore } from '@netlify/blobs';
import {
  STORE_NAMES,
  LIMITS,
  BASE_HEADERS,
  corsHeaders,
  createAssetId,
  buildAssetUrl,
  decodeDataUrl
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

  const assetIds = await externalizeInlineAssets(slidesClone, event);
  if (assetIds.length) {
    shareRecord.assets = assetIds;
  }

  const serialized = JSON.stringify(shareRecord);
  const bytes = Buffer.byteLength(serialized, 'utf8');

  if (bytes > LIMITS.MAX_DECK_BYTES) {
    return {
      statusCode: 413,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Deck is too large to share (max 400KB)' }),
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
    return [];
  }

  const assetStore = getStore(STORE_NAMES.ASSETS);
  const collected = [];
  const imageRefs = gatherImageRefs(slides);

  for (const image of imageRefs) {
    if (!image || typeof image !== 'object') continue;

    if (image.storage === 'netlify-asset' && typeof image.assetId === 'string') {
      collected.push(image.assetId);
      continue;
    }

    if (typeof image.src === 'string' && image.src.startsWith('data:')) {
      try {
        const { buffer, mimeType } = decodeDataUrl(image.src);
        if (buffer.byteLength > LIMITS.MAX_ASSET_BYTES) {
          throw new Error('One of the images is too large (>512KB) to share. Compress it and try again.');
        }
        const assetId = createAssetId(image.originalFilename || 'shared-image');
        await assetStore.set(assetId, buffer, {
          metadata: {
            bytes: buffer.byteLength,
            mimeType,
            source: 'share-inline',
            createdAt: Date.now(),
          },
        });
        image.src = buildAssetUrl(event, assetId);
        image.assetId = assetId;
        image.storage = 'netlify-asset';
        collected.push(assetId);
      } catch (e) {
        console.warn('Failed to externalize asset', e);
        // Keep inline if it fails? Or throw?
        // For now, we throw to stop the share if an asset is invalid/too large
        throw e;
      }
      continue;
    }
  }

  return collected;
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
