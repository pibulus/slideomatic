// Rewrites collections.html's OG/Twitter meta tags per ?collection= slug so
// link previews (Facebook, Slack, iMessage...) show the real collection's
// title/tagline instead of the generic site-wide text. Crawlers don't run
// JS, so this has to happen server-side before the HTML is served.
export default async (request, context) => {
  const url = new URL(request.url);
  const slug = url.searchParams.get('collection');
  const response = await context.next();

  if (!slug) return response;

  const dataUrl = new URL('/deck-collections.json', request.url);
  const list = await fetch(dataUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const collection = Array.isArray(list) ? list.find((c) => c.id === slug) : null;

  if (!collection) return response;

  let html = await response.text();
  const title = `${collection.title} — Slide-o-Matic`;
  const description = collection.description || collection.tagline || '';
  const pageUrl = `https://slideomatic.app/collections?collection=${encodeURIComponent(slug)}`;

  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safePageUrl = escapeHtml(pageUrl);

  html = html
    .replace(/<title>.*?<\/title>/, () => `<title>${safeTitle}</title>`)
    .replace(/(<meta name="description" content=").*?(")/, (_, p1, p2) => `${p1}${safeDesc}${p2}`)
    .replace(/(<link rel="canonical" href=").*?(")/, (_, p1, p2) => `${p1}${safePageUrl}${p2}`)
    .replace(/(<meta property="og:url" content=").*?(")/, (_, p1, p2) => `${p1}${safePageUrl}${p2}`)
    .replace(/(<meta property="og:title" content=").*?(")/, (_, p1, p2) => `${p1}${safeTitle}${p2}`)
    .replace(/(<meta property="og:description" content=").*?(")/, (_, p1, p2) => `${p1}${safeDesc}${p2}`)
    .replace(/(<meta name="twitter:url" content=").*?(")/, (_, p1, p2) => `${p1}${safePageUrl}${p2}`)
    .replace(/(<meta name="twitter:title" content=").*?(")/, (_, p1, p2) => `${p1}${safeTitle}${p2}`)
    .replace(/(<meta name="twitter:description" content=").*?(")/, (_, p1, p2) => `${p1}${safeDesc}${p2}`);

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.delete('content-length');

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const config = {
  path: ['/collections', '/collections.html', '/collections/*'],
};
