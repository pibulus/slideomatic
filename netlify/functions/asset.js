import { connectLambda, getStore } from '@netlify/blobs';
import {
  STORE_NAMES,
  CACHE_HEADERS,
  BASE_HEADERS,
  corsHeaders
} from './utils/common.js';

export async function handler(event) {
  connectLambda(event);

  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: corsHeaders(event.headers, 'GET,HEAD,OPTIONS'),
      };
    }

    const assetId = event.queryStringParameters?.id;
    if (!assetId) {
      return {
        statusCode: 400,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Missing asset id' }),
      };
    }

    if (event.httpMethod === 'HEAD') {
      return await handleHead(assetId);
    }

    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const store = getStore(STORE_NAMES.ASSETS);
    const result = await store.getWithMetadata(assetId, { type: 'arrayBuffer' });

    if (!result) {
      return {
        statusCode: 404,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Asset not found' }),
      };
    }

    const { data, metadata = {}, etag } = result;
    const mimeType = metadata.mimeType || 'application/octet-stream';
    const buffer = Buffer.from(data);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': CACHE_HEADERS.IMMUTABLE,
        'Content-Length': String(buffer.length),
        ...(etag ? { ETag: etag } : {}),
        'Access-Control-Allow-Origin': '*',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Asset fetch failed', error);
    return {
      statusCode: 500,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Failed to load asset' }),
    };
  }
}

async function handleHead(assetId) {
  const store = getStore(STORE_NAMES.ASSETS);
  const metadata = await store.getMetadata(assetId);
  if (!metadata) {
    return {
      statusCode: 404,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Asset not found' }),
    };
  }
  const { metadata: meta = {}, etag } = metadata;
  const bytes = meta.bytes ? Number(meta.bytes) : undefined;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': meta.mimeType || 'application/octet-stream',
      'Cache-Control': CACHE_HEADERS.IMMUTABLE,
      ...(bytes ? { 'Content-Length': String(bytes) } : {}),
      ...(etag ? { ETag: etag } : {}),
      'Access-Control-Allow-Origin': '*',
    },
    body: '',
  };
}
