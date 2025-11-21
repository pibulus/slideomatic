import { connectLambda, getStore } from '@netlify/blobs';

const STORE_NAME = 'shared-decks';
const MAX_DECK_BYTES = 400 * 1024; // 400KB ceiling for payloads

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

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
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Share function failed', error);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Internal error creating share link' }),
    };
  }
}

async function handlePost(event) {
  if (!event.body) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Missing request body' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (error) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Invalid JSON payload' }),
    };
  }

  if (!Array.isArray(payload.slides)) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Missing slides array' }),
    };
  }

  const shareRecord = {
    version: 1,
    slides: payload.slides,
    theme: payload.theme ?? null,
    meta: {
      title: payload.meta?.title ?? 'Untitled Deck',
      createdAt: payload.meta?.createdAt ?? Date.now(),
    },
  };

  const serialized = JSON.stringify(shareRecord);
  const bytes = Buffer.byteLength(serialized, 'utf8');

  if (bytes > MAX_DECK_BYTES) {
    return {
      statusCode: 413,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Deck is too large to share (max 400KB)' }),
    };
  }

  const shareId = createShareId();
  const store = getStore(STORE_NAME);
  await store.set(shareId, serialized, {
    metadata: {
      bytes,
      createdAt: Date.now(),
    },
  });

  return {
    statusCode: 200,
    headers: jsonHeaders,
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
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Missing share id' }),
    };
  }

  const store = getStore(STORE_NAME);
  const record = await store.get(id, { type: 'json' });

  if (!record) {
    return {
      statusCode: 404,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Share not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: jsonHeaders,
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

function corsHeaders(headers = {}) {
  const origin = headers.origin || headers.Origin || '*';
  return {
    ...jsonHeaders,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}
