const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

let lazyImageObserver = null;

function getLazyImageObserver() {
  if (lazyImageObserver) return lazyImageObserver;
  lazyImageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      loadLazyImage(img);
    });
  }, { rootMargin: '200px 0px' });
  return lazyImageObserver;
}

export function registerLazyImage(img, src) {
  if (!img || !src) return;
  img.dataset.src = src;
  img.src = TRANSPARENT_PIXEL;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.classList.add('is-loading');
  img.addEventListener('load', () => {
    img.classList.remove('is-loading');
  }, { once: true });
  getLazyImageObserver().observe(img);
}

export function loadLazyImage(img) {
  if (!img || !img.dataset || !img.dataset.src) return;
  const actualSrc = img.dataset.src;
  delete img.dataset.src;
  img.src = actualSrc;
  img.classList.remove('is-loading');
  if (lazyImageObserver) {
    lazyImageObserver.unobserve(img);
  }
}
