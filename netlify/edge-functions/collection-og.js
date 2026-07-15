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
  const pageUrl = `https://slideomatic.app/collections?collection=${slug}`;

  html = html
    .replace(/<title>.*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta name="description" content=").*?(")/, `$1${escapeHtml(description)}$2`)
    .replace(/(<link rel="canonical" href=").*?(")/, `$1${pageUrl}$2`)
    .replace(/(<meta property="og:url" content=").*?(")/, `$1${pageUrl}$2`)
    .replace(/(<meta property="og:title" content=").*?(")/, `$1${escapeHtml(title)}$2`)
    .replace(/(<meta property="og:description" content=").*?(")/, `$1${escapeHtml(description)}$2`)
    .replace(/(<meta name="twitter:url" content=").*?(")/, `$1${pageUrl}$2`)
    .replace(/(<meta name="twitter:title" content=").*?(")/, `$1${escapeHtml(title)}$2`)
    .replace(/(<meta name="twitter:description" content=").*?(")/, `$1${escapeHtml(description)}$2`);

  return new Response(html, response);
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const config = {
  path: '/collections',
};
