// ═══════════════════════════════════════════════════════════════════════════
// Image Search UI Module
// ═══════════════════════════════════════════════════════════════════════════
//
// The Airtable-style inline image picker: type a term, get a grid of licensed
// stock results (Pexels now, Unsplash-ready), click one and it lands in the
// slide — no leaving the app, no manual download-then-upload.
//
// Search hits the /.netlify/functions/image-search proxy (keys stay server
// side). On select, the chosen image is fetched, run through the SAME
// compressImage() pipeline a file upload uses, and applied to the slide by
// index — so a picked image is stored and behaves identically to an uploaded
// one (local-first, offline-safe), just sourced from search instead of disk.
//
// Dependencies: image-upload.js (compressImage), image-utils.js (apply),
// slide-actions.js (re-render), utils.js (helpers)
// Used by: edit-drawer.js (image manager)
// ═══════════════════════════════════════════════════════════════════════════

import { compressImage } from './image-upload.js';
import { updateSlideImageByIndex } from './image-utils.js';
import { replaceSlideAt } from './slide-actions.js';
import { showHudStatus, hideHudStatus, hideToastById } from './hud.js';
import { escapeHtml, fileToBase64, formatBytes } from './utils.js';

const SEARCH_ENDPOINT = '/.netlify/functions/image-search';

let modalEl = null;
let currentContext = null; // { slideIndex, imageIndex, onSuccess }
let isLoading = false;

function buildModal() {
  const el = document.createElement('div');
  el.className = 'image-search modal-base';
  el.id = 'image-search-modal';
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('inert', '');
  el.innerHTML = `
    <div class="image-search__backdrop modal-backdrop" data-image-search-close></div>
    <div class="image-search__dialog modal-content" role="dialog" aria-modal="true" aria-labelledby="image-search-title">
      <div class="image-search__header">
        <h2 id="image-search-title">Search images</h2>
        <button type="button" class="image-search__close" aria-label="Close image search" data-image-search-close>×</button>
      </div>
      <form class="image-search__form" id="image-search-form">
        <input
          type="text"
          class="image-search__input"
          id="image-search-input"
          placeholder="Try &quot;volcano&quot;, &quot;retro terminal&quot;, &quot;pastel&quot;..."
          autocomplete="off"
          aria-label="Image search term"
        />
        <button type="submit" class="image-search__submit">Search</button>
      </form>
      <div class="image-search__results" id="image-search-results" aria-live="polite"></div>
      <p class="image-search__attribution">Photos from Pexels. Free to use, credit appreciated.</p>
    </div>
  `;
  document.body.appendChild(el);

  el.querySelectorAll('[data-image-search-close]').forEach((btn) => {
    btn.addEventListener('click', closeImageSearch);
  });

  const form = el.querySelector('#image-search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el.querySelector('#image-search-input');
    runSearch(input.value.trim());
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('is-open')) {
      closeImageSearch();
    }
  });

  return el;
}

export function openImageSearch({ slideIndex, imageIndex, onSuccess, seedQuery = '' } = {}) {
  if (!modalEl) modalEl = buildModal();
  currentContext = { slideIndex, imageIndex, onSuccess };

  modalEl.removeAttribute('inert');
  modalEl.setAttribute('aria-hidden', 'false');
  modalEl.classList.add('is-open');

  const input = modalEl.querySelector('#image-search-input');
  const results = modalEl.querySelector('#image-search-results');
  results.innerHTML = '';
  input.value = seedQuery;
  input.focus();

  if (seedQuery) runSearch(seedQuery);
}

export function closeImageSearch() {
  if (!modalEl) return;
  modalEl.setAttribute('aria-hidden', 'true');
  modalEl.setAttribute('inert', '');
  modalEl.classList.remove('is-open');
  currentContext = null;
}

async function runSearch(query) {
  if (!query || isLoading) return;
  const results = modalEl.querySelector('#image-search-results');
  results.innerHTML = '<p class="image-search__status">Searching...</p>';
  isLoading = true;

  try {
    const res = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, page: 1 }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data) {
      const msg = data?.error?.message || data?.error || `Search failed (${res.status})`;
      results.innerHTML = `<p class="image-search__status image-search__status--error">${escapeHtml(String(msg))}</p>`;
      return;
    }

    if (!data.results.length) {
      results.innerHTML = `<p class="image-search__status">No images found for "${escapeHtml(query)}".</p>`;
      return;
    }

    renderResults(data.results);
  } catch (err) {
    results.innerHTML = `<p class="image-search__status image-search__status--error">${escapeHtml(err.message || 'Search failed')}</p>`;
  } finally {
    isLoading = false;
  }
}

function renderResults(items) {
  const results = modalEl.querySelector('#image-search-results');
  const grid = document.createElement('div');
  grid.className = 'image-search__grid';

  items.forEach((item) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'image-search__result';
    cell.title = `${item.alt}\n${item.credit} / ${item.source}`;
    cell.innerHTML = `
      <img src="${escapeHtml(item.thumb)}" alt="${escapeHtml(item.alt)}" loading="lazy" />
      <span class="image-search__credit">${escapeHtml(item.credit || item.source)}</span>
    `;
    cell.addEventListener('click', () => selectImage(item, cell));
    grid.appendChild(cell);
  });

  results.innerHTML = '';
  results.appendChild(grid);
}

async function selectImage(item, cell) {
  if (!currentContext) return;
  if (cell) cell.classList.add('is-loading');
  const toastId = showHudStatus('🖼️ Adding image...', 'processing');

  try {
    // Fetch the full-res image and run it through the exact same compression
    // pipeline an uploaded file uses, so a searched image is stored (and
    // behaves) identically to an uploaded one.
    const resp = await fetch(item.full);
    if (!resp.ok) throw new Error(`Could not fetch image (${resp.status})`);
    const blob = await resp.blob();
    const file = new File([blob], `${item.source.toLowerCase()}-${item.id}.jpg`, {
      type: blob.type || 'image/jpeg',
    });

    const { file: compressed, format } = await compressImage(file);
    const dataUrl = await fileToBase64(compressed);

    const imageData = {
      src: dataUrl,
      alt: item.alt,
      originalFilename: file.name,
      compressedSize: compressed.size,
      compressedFormat: compressed.type || format,
      credit: item.credit,
      creditUrl: item.creditUrl,
      source: item.source,
      addedAt: Date.now(),
      storage: 'inline',
    };

    const applied = updateSlideImageByIndex(
      currentContext.slideIndex,
      currentContext.imageIndex,
      imageData
    );
    if (!applied) throw new Error('Could not apply image to slide');

    replaceSlideAt(currentContext.slideIndex, { focus: false });

    const onSuccess = currentContext.onSuccess;
    closeImageSearch();
    if (onSuccess) onSuccess();

    hideToastById(toastId);
    showHudStatus(`Image added (${formatBytes(compressed.size)})`, 'success');
    setTimeout(hideHudStatus, 2000);
  } catch (err) {
    if (cell) cell.classList.remove('is-loading');
    hideToastById(toastId);
    showHudStatus(`❌ ${err.message || 'Failed to add image'}`, 'error');
    setTimeout(hideHudStatus, 4000);
  }
}
