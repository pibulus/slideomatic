const SHARE_PATH_PATTERN = /^\/s\/([a-z0-9_-]+)\/?$/i;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveAbsoluteImageUrl(rawUrl, origin) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return `${origin}/og-image.jpg`;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:')) {
    return `${origin}/og-image.jpg`;
  }
  try {
    const parsed = new URL(trimmed, `${origin}/`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return `${origin}/og-image.jpg`;
    }
    return parsed.toString();
  } catch {
    return `${origin}/og-image.jpg`;
  }
}

function inferImageMime(imageUrl = '') {
  const lower = String(imageUrl).toLowerCase();
  if (lower.includes('fm=webp') || lower.endsWith('.webp')) return 'image/webp';
  if (lower.includes('fm=png') || lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export function rewriteShareHeadHtml(html, meta, shareUrl, origin = 'https://slideomatic.app') {
  if (!meta || typeof meta !== 'object') return html;

  const isLocked = Boolean(meta.passwordProtected);
  const rawTitle = isLocked
    ? 'Locked Deck'
    : (meta.title || 'Slide-o-Matic Deck');
  const fullTitle = `${rawTitle} — Slide-o-Matic`;
  const description = isLocked
    ? 'Passphrase required to view this deck on Slide-o-Matic.'
    : (meta.description || 'A presentation deck built with Slide-o-Matic.');
  const imageUrl = isLocked
    ? `${origin}/og-image.jpg`
    : resolveAbsoluteImageUrl(meta.image, origin);
  const imageAlt = isLocked
    ? 'Locked Slide-o-Matic deck'
    : (meta.imageAlt || `${rawTitle} — Slide-o-Matic deck preview`);
  const imageMime = inferImageMime(imageUrl);

  const safeTitle = escapeHtml(fullTitle);
  const safeDesc = escapeHtml(description);
  const safeShareUrl = escapeHtml(shareUrl);
  const safeImageUrl = escapeHtml(imageUrl);
  const safeImageAlt = escapeHtml(imageAlt);
  const safeImageMime = escapeHtml(imageMime);

  let nextHtml = html
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${safeTitle}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="description" content="${safeDesc}" />`
    )
    .replace(
      /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      () => `<link rel="canonical" href="${safeShareUrl}" />`
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:url" content="${safeShareUrl}" />`
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:image" content="${safeImageUrl}" />`
    )
    .replace(
      /<meta\s+property="og:image:secure_url"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:image:secure_url" content="${safeImageUrl}" />`
    )
    .replace(
      /<meta\s+property="og:image:type"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:image:type" content="${safeImageMime}" />`
    )
    .replace(
      /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta property="og:image:alt" content="${safeImageAlt}" />`
    )
    .replace(
      /<meta\s+name="twitter:url"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:url" content="${safeShareUrl}" />`
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:title" content="${safeTitle}" />`
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:description" content="${safeDesc}" />`
    )
    .replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:image" content="${safeImageUrl}" />`
    )
    .replace(
      /<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="twitter:image:alt" content="${safeImageAlt}" />`
    );

  if (imageUrl !== `${origin}/og-image.jpg`) {
    nextHtml = nextHtml.replace(
      /\s*<meta\s+property="og:image:(?:width|height)"\s+content="[^"]*"\s*\/?>/gi,
      () => ''
    );
  }

  if (!isLocked && typeof meta.themeAccent === 'string' && /^#[0-9a-f]{3,8}$/i.test(meta.themeAccent.trim())) {
    const safeAccent = escapeHtml(meta.themeAccent.trim());
    nextHtml = nextHtml.replace(
      /<meta\s+name="theme-color"\s+content="[^"]*"\s*\/?>/i,
      () => `<meta name="theme-color" content="${safeAccent}" />`
    );
  }

  return nextHtml;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const match = url.pathname.match(SHARE_PATH_PATTERN);
  if (!match) {
    return context.next();
  }

  const slug = decodeURIComponent(match[1]);
  const upstreamResponse = await context.next();
  const contentType = upstreamResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return upstreamResponse;
  }

  let meta = null;
  try {
    const metaEndpoint = new URL(`/.netlify/functions/share?id=${encodeURIComponent(slug)}&meta=1`, url.origin);
    const metaRes = await fetch(metaEndpoint.toString(), {
      headers: { accept: 'application/json' },
    });
    if (metaRes.ok) {
      meta = await metaRes.json();
    }
  } catch (error) {
    console.warn('Unable to load share OG metadata', error);
  }

  if (!meta) {
    return upstreamResponse;
  }

  const shareUrl = `${url.origin}/s/${encodeURIComponent(slug)}`;
  const html = await upstreamResponse.text();
  const nextHtml = rewriteShareHeadHtml(html, meta, shareUrl, url.origin);

  const headers = new Headers(upstreamResponse.headers);
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.delete('content-length');

  return new Response(nextHtml, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
};

export const config = {
  path: '/s/*',
};
