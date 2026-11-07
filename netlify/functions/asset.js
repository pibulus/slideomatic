import { connectLambda as defaultConnectLambda, getStore as defaultGetStore } from '@netlify/blobs';
import {
  STORE_NAMES,
  CACHE_HEADERS,
  BASE_HEADERS,
  corsHeaders,
  normalizeAllowedImageMime,
  sniffImageMime,
} from './utils/common.js';

const ASSET_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

export async function handler(event, deps = {}) {
  const connectLambdaFn = deps.connectLambda || defaultConnectLambda;
  const getStoreFn = deps.getStore || defaultGetStore;
  try {
    connectLambdaFn(event);
  } catch {
    // Allow running in local/unit test environments without Lambda context
  }

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
      return await handleHead(assetId, getStoreFn);
    }

    if (event.httpMethod !== 'GET') {
      return {
        statusCode: 405,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const store = getStoreFn(STORE_NAMES.ASSETS);
    const result = await store.getWithMetadata(assetId, { type: 'arrayBuffer' });

    if (!result) {
      return {
        statusCode: 404,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Asset not found' }),
      };
    }

    const { data, metadata = {}, etag } = result;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const safeMime = sniffImageMime(buffer) || normalizeAllowedImageMime(metadata.mimeType);
    if (!safeMime) {
      return {
        statusCode: 415,
        headers: {
          ...BASE_HEADERS,
          ...ASSET_SECURITY_HEADERS,
        },
        body: JSON.stringify({ error: 'Unsupported asset media type' }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': safeMime,
        'Cache-Control': CACHE_HEADERS.IMMUTABLE,
        'Content-Length': String(buffer.length),
        ...(etag ? { ETag: etag } : {}),
        'Access-Control-Allow-Origin': '*',
        ...ASSET_SECURITY_HEADERS,
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

async function handleHead(assetId, getStoreFn = defaultGetStore) {
  const store = getStoreFn(STORE_NAMES.ASSETS);
  const metadata = await store.getMetadata(assetId);
  if (!metadata) {
    return {
      statusCode: 404,
      headers: BASE_HEADERS,
      body: JSON.stringify({ error: 'Asset not found' }),
    };
  }
  const { metadata: meta = {}, etag } = metadata;
  const safeMime = normalizeAllowedImageMime(meta.mimeType);
  if (!safeMime) {
    return {
      statusCode: 415,
      headers: {
        ...BASE_HEADERS,
        ...ASSET_SECURITY_HEADERS,
      },
      body: '',
    };
  }
  const bytes = meta.bytes ? Number(meta.bytes) : undefined;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': safeMime,
      'Cache-Control': CACHE_HEADERS.IMMUTABLE,
      ...(bytes ? { 'Content-Length': String(bytes) } : {}),
      ...(etag ? { ETag: etag } : {}),
      'Access-Control-Allow-Origin': '*',
      ...ASSET_SECURITY_HEADERS,
    },
    body: '',
  };
}
