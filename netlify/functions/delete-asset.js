import { connectLambda, getStore } from '@netlify/blobs';
import {
  STORE_NAMES,
  BASE_HEADERS
} from './utils/common.js';

export async function handler(event) {
  connectLambda(event);

  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: BASE_HEADERS,
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

    const ids = Array.isArray(payload.ids)
      ? payload.ids.map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (!ids.length) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'No asset ids provided' }),
      };
    }

    const store = getStore(STORE_NAMES.ASSETS);
    let deleted = 0;
    let skipped = 0;

    for (const id of ids) {
      try {
        // Share-externalized assets are referenced by hosted share records —
        // possibly several, via global dedup — and this endpoint has no auth,
        // so honoring a delete here would let any recipient silently break
        // other people's share links. Their lifecycle is expiry-based; only
        // user-uploaded assets are deletable.
        const wrapper = await store.getMetadata(id);
        if (wrapper?.metadata?.source === 'share-inline') {
          skipped += 1;
          continue;
        }
        await store.delete(id);
        deleted += 1;
      } catch (error) {
        console.warn('Failed to delete asset', id, error);
      }
    }

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify({ deleted, skipped }),
    };
  } catch (error) {
    console.error('Asset delete failed', error);
    return {
      statusCode: 500,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Failed to delete assets' }),
    };
  }
}
