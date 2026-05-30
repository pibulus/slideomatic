import { slides } from './state.js';
import { getCurrentTheme } from './theme-manager.js';
import { deriveDeckName, trapFocus, focusFirstElement } from './utils.js';

let previousFocus = null;
let keydownHandler = null;

export function initShareModal() {
  const shareBtn = document.getElementById('share-deck-btn');
  const shareModal = document.getElementById('share-modal');
  const closeBtn = document.getElementById('share-modal-close');
  const backdrop = shareModal?.querySelector('.share-modal__backdrop');
  const copyBtn = document.getElementById('share-copy-btn');
  const urlInput = /** @type {HTMLInputElement} */ (document.getElementById('share-url-input'));
  const statusDiv = document.getElementById('share-status');
  const generateBtn = document.getElementById('share-generate-btn');

  if (!shareBtn || !shareModal) return;

  shareBtn.addEventListener('click', async () => {
    await openShareModal();
  });

  closeBtn?.addEventListener('click', closeShareModal);
  backdrop?.addEventListener('click', closeShareModal);

  generateBtn?.addEventListener('click', async () => {
    await generateLink();
  });

  copyBtn?.addEventListener('click', () => {
    if (urlInput?.value) {
      navigator.clipboard.writeText(urlInput.value).then(() => {
        showShareStatus('\u2713 Link copied to clipboard!', 'success');
        setTimeout(() => hideShareStatus(), 2000);
      }).catch(() => {
        showShareStatus('\u26a0\ufe0f Failed to copy. Try selecting and copying manually.', 'error');
      });
    }
  });

  function showShareStatus(message, type) {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = `share-modal__status is-visible is-${type}`;
  }

  function hideShareStatus() {
    if (!statusDiv) return;
    statusDiv.className = 'share-modal__status';
  }

  async function openShareModal() {
    previousFocus = document.activeElement;
    shareModal.classList.add('is-open');
    shareModal.setAttribute('aria-hidden', 'false');

    resetShareModalState();
    hideShareStatus();
    showShareStatus('Hit Generate link to create a shareable URL.', 'loading');

    focusFirstElement(shareModal);

    if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
    keydownHandler = (e) => {
      if (e.key === 'Escape') {
        closeShareModal();
      } else if (e.key === 'Tab') {
        trapFocus(e, shareModal);
      }
    };
    document.addEventListener('keydown', keydownHandler);
  }

  function closeShareModal() {
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
      previousFocus = null;
    }

    shareModal.classList.remove('is-open');
    shareModal.setAttribute('aria-hidden', 'true');
    hideShareStatus();

    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    generateBtn?.removeAttribute('data-loading');
  }

  function resetShareModalState() {
    if (urlInput) urlInput.value = '';
  }

  async function generateLink() {
    if (generateBtn?.getAttribute('data-loading') === 'true') return;
    generateBtn?.setAttribute('data-loading', 'true');
    showShareStatus('\ud83d\udd17 Generating share link\u2026', 'loading');
    try {
      const shareUrl = await buildShareUrl();
      if (urlInput) urlInput.value = shareUrl;
      showShareStatus('\u2713 Ready to share!', 'success');
      setTimeout(() => hideShareStatus(), 3000);
    } catch (error) {
      console.error('Share failed:', error);
      showShareStatus(`\u274c ${error.message}`, 'error');
    } finally {
      generateBtn?.removeAttribute('data-loading');
    }
  }

  async function buildShareUrl() {
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new Error('No slides to share.');
    }

    // Strip inline images to keep the URL manageable.
    // Slides with data-URL images would bloat the payload beyond URL limits.
    const cleanSlides = stripDataUrls(slides);

    const payload = {
      slides: cleanSlides,
      theme: getCurrentTheme() || undefined,
      meta: {
        title: deriveDeckName(slides),
        createdAt: Date.now(),
      },
    };

    const json = JSON.stringify(payload);
    const encoded = await compressAndEncode(json);

    const url = new URL(window.location.href);
    // Clear existing params to get a clean share link
    url.search = '';
    url.hash = '';
    url.searchParams.set('data', encoded);

    // Check URL length — most browsers support ~2MB but proxies/servers cap at ~8KB
    if (url.toString().length > 100_000) {
      throw new Error(
        'Deck is too large to share via URL. Try removing some images or slides, then export as JSON instead (press D).'
      );
    }

    return url.toString();
  }

  /**
   * Strip large data-URL images from slides so the share payload stays small.
   * Replaces `image.src` values that start with `data:` with an empty string
   * while preserving the `alt` text so the recipient sees what was there.
   */
  function stripDataUrls(slideArray) {
    return JSON.parse(JSON.stringify(slideArray, (key, value) => {
      if (key === 'src' && typeof value === 'string' && value.startsWith('data:')) {
        return '';
      }
      return value;
    }));
  }

  /**
   * Compress JSON string with gzip via CompressionStream, then base64url-encode.
   * Falls back to plain base64 if CompressionStream is unavailable.
   */
  async function compressAndEncode(jsonString) {
    if (typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Blob([jsonString])
          .stream()
          .pipeThrough(new CompressionStream('gzip'));
        const compressed = await new Response(stream).arrayBuffer();
        return 'gz.' + arrayBufferToBase64Url(compressed);
      } catch (err) {
        console.warn('CompressionStream failed, falling back to plain base64', err);
      }
    }

    // Fallback: plain base64 (no compression prefix)
    return btoa(unescape(encodeURIComponent(jsonString)));
  }

  function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    // Use URL-safe base64 (no +/= characters that break URL params)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
