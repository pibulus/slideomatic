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
        headers: corsHeaders(event.headers, 'POST,OPTIONS'),
      };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Missing body' }),
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

    const { dataUrl, filename = 'upload', mimeType, size } = payload || {};
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Missing data URL' }),
      };
    }

    const { buffer, detectedMime } = decodeDataUrl(dataUrl, mimeType);
    const bytes = buffer.byteLength;

    if (!detectedMime.startsWith('image/')) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Only image uploads are supported' }),
      };
    }

    if (bytes > LIMITS.MAX_ASSET_BYTES) {
      return {
        statusCode: 413,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Image exceeds 512KB limit' }),
      };
    }

    const store = getStore(STORE_NAMES.ASSETS);
    const assetId = createAssetId(filename);

    await store.set(assetId, buffer, {
      metadata: {
        bytes,
        filename,
        mimeType: detectedMime,
        uploadedAt: Date.now(),
        sourceSize: size ?? bytes,
      },
    });

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify({
        assetId,
        url: buildAssetUrl(event, assetId),
        bytes,
        mimeType: detectedMime,
      }),
    };
  } catch (error) {
    console.error('Asset upload failed', error);
    return {
      statusCode: 500,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Failed to store asset' }),
    };
  }
}
