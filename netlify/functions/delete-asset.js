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

    for (const id of ids) {
      try {
        await store.delete(id);
        deleted += 1;
      } catch (error) {
        console.warn('Failed to delete asset', id, error);
      }
    }

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify({ deleted }),
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
